import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import PageHeader from '../../components/PageHeader';
import { btn, btnPrimary, card, colors, input, table, td, th } from '../../lib/ui';
import type { DeliverySwap } from '../../types/db';

interface DeliveryRecord {
  driver_code: string;
  driver_name: string;
  work_date: string;
  amount: number;
}

interface DriverOption {
  driver_code: string;
  driver_name: string;
}

// 全角/半角スペース ゆらぎ吸収
function normalizeDriverName(name: string | undefined | null): string {
  return (name ?? '').replace(/[\s　]+/g, ' ').trim();
}

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function cyclePeriod(offset = 0): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() + offset - 1, 21);
  const to = new Date(now.getFullYear(), now.getMonth() + offset, 20);
  return { from: fmtDate(from), to: fmtDate(to) };
}

export default function SwapDeliveryPage() {
  const init = cyclePeriod(0);
  const [records, setRecords] = useState<DeliveryRecord[]>([]);
  const [swaps, setSwaps] = useState<DeliverySwap[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [fromDriver, setFromDriver] = useState<string>('');
  const [toDriver, setToDriver] = useState<string>('');
  const [periodFrom, setPeriodFrom] = useState<string>(init.from);
  const [periodTo, setPeriodTo] = useState<string>(init.to);
  const [note, setNote] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    const session = (await supabase.auth.getSession()).data.session;
    if (!session) {
      setError('セッション切れ');
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fetch-delivery-records`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(`HTTP ${res.status}: ${data.error ?? '配送実績取得失敗'}`);
      } else {
        setRecords((data.records ?? []) as DeliveryRecord[]);
      }
    } catch (e) {
      setError('通信エラー: ' + (e instanceof Error ? e.message : String(e)));
    }
    const { data: swapData, error: swapErr } = await supabase
      .from('delivery_swaps')
      .select('*')
      .order('executed_at', { ascending: false });
    if (swapErr) setError(swapErr.message);
    else setSwaps((swapData ?? []) as DeliverySwap[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  // ドライバー候補 (シートに登場する driver_code + driver_name の uniq)
  const drivers = useMemo<DriverOption[]>(() => {
    const map = new Map<string, DriverOption>();
    for (const r of records) {
      if (!r.driver_code || !r.driver_name) continue;
      if (!map.has(r.driver_code)) {
        map.set(r.driver_code, { driver_code: r.driver_code, driver_name: normalizeDriverName(r.driver_name) });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.driver_code.localeCompare(b.driver_code));
  }, [records]);

  // プレビュー: 期間内の元ドライバーの対象行
  const preview = useMemo(() => {
    if (!fromDriver || !periodFrom || !periodTo) return { rows: 0, totalAmount: 0 };
    const fromOpt = drivers.find((d) => d.driver_code === fromDriver);
    if (!fromOpt) return { rows: 0, totalAmount: 0 };
    let rows = 0;
    let totalAmount = 0;
    for (const r of records) {
      if (normalizeDriverName(r.driver_name) !== fromOpt.driver_name) continue;
      if (r.work_date < periodFrom || r.work_date > periodTo) continue;
      rows += 1;
      totalAmount += r.amount || 0;
    }
    return { rows, totalAmount };
  }, [records, drivers, fromDriver, periodFrom, periodTo]);

  const submit = async () => {
    setError(null);
    if (!fromDriver || !toDriver) {
      setError('元ドライバーと先ドライバーを選択してください');
      return;
    }
    if (fromDriver === toDriver) {
      setError('元ドライバーと先ドライバーが同じです');
      return;
    }
    if (!periodFrom || !periodTo) {
      setError('期間を入力してください');
      return;
    }
    if (periodFrom > periodTo) {
      setError('期間 開始 ≦ 終了 にしてください');
      return;
    }
    if (preview.rows === 0) {
      if (!confirm('対象期間に該当行が0件です。それでも登録しますか？')) return;
    }

    const fromOpt = drivers.find((d) => d.driver_code === fromDriver);
    const toOpt = drivers.find((d) => d.driver_code === toDriver);
    if (!fromOpt || !toOpt) {
      setError('ドライバー情報の解決に失敗しました');
      return;
    }

    if (!confirm(
      `${fromOpt.driver_name} の ${periodFrom}〜${periodTo} 期間の配送実績 ${preview.rows}件 (¥${preview.totalAmount.toLocaleString()}) を` +
      `\n${toOpt.driver_name} の支払いに付け替えます。よろしいですか？` +
      `\n\n※ シート上のデータは変更されません。 支払い計算のみに反映されます。`
    )) return;

    setSubmitting(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { error: insertErr } = await supabase.from('delivery_swaps').insert({
      from_driver_name: fromOpt.driver_name,
      from_driver_code: fromOpt.driver_code,
      to_driver_name: toOpt.driver_name,
      to_driver_code: toOpt.driver_code,
      period_from: periodFrom,
      period_to: periodTo,
      note: note.trim() || null,
      executed_by: user?.id ?? null,
    });
    setSubmitting(false);
    if (insertErr) {
      setError('登録エラー: ' + insertErr.message);
      return;
    }
    setFromDriver('');
    setToDriver('');
    setNote('');
    await load();
    alert('付け替え登録完了。月次締め画面で「再集計」すると反映されます。');
  };

  const revert = async (swap: DeliverySwap) => {
    if (!confirm(
      `${swap.from_driver_name} → ${swap.to_driver_name} の付け替え (${swap.period_from}〜${swap.period_to}) を元に戻します。よろしいですか？`
    )) return;
    const { data: { user } } = await supabase.auth.getUser();
    const { error: updateErr } = await supabase
      .from('delivery_swaps')
      .update({ reverted_at: new Date().toISOString(), reverted_by: user?.id ?? null })
      .eq('id', swap.id);
    if (updateErr) {
      setError('元に戻すエラー: ' + updateErr.message);
      return;
    }
    await load();
  };

  const activeSwaps = swaps.filter((s) => !s.reverted_at);
  const revertedSwaps = swaps.filter((s) => s.reverted_at);

  return (
    <div>
      <PageHeader
        title="データ付け替え"
        actions={
          <button style={btnPrimary} onClick={load} disabled={loading}>
            {loading ? '読み込み中...' : '再読込'}
          </button>
        }
      />

      {error && (
        <div style={{ color: '#dc2626', marginBottom: 12, whiteSpace: 'pre-wrap' }}>{error}</div>
      )}

      <div style={{ ...card, marginBottom: 16, padding: 16, maxWidth: 720 }}>
        <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 12 }}>
          シートの配送実績を別ドライバーの<strong>支払い計算</strong>に振り替えます。
          <br />シート上のデータと <strong>アスクルへの請求書</strong> には影響しません (代走など、 ネルテックがドライバーへ支払う対象を変える用途)。
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="元ドライバー (シート上)">
            <select style={input} value={fromDriver} onChange={(e) => setFromDriver(e.target.value)}>
              <option value="">選択してください</option>
              {drivers.map((d) => (
                <option key={d.driver_code} value={d.driver_code}>
                  {d.driver_name} ({d.driver_code})
                </option>
              ))}
            </select>
          </Field>
          <Field label="先ドライバー (支払い先)">
            <select style={input} value={toDriver} onChange={(e) => setToDriver(e.target.value)}>
              <option value="">選択してください</option>
              {drivers.map((d) => (
                <option key={d.driver_code} value={d.driver_code}>
                  {d.driver_name} ({d.driver_code})
                </option>
              ))}
            </select>
          </Field>
          <Field label="期間 開始">
            <input type="date" style={input} value={periodFrom} onChange={(e) => setPeriodFrom(e.target.value)} />
          </Field>
          <Field label="期間 終了">
            <input type="date" style={input} value={periodTo} onChange={(e) => setPeriodTo(e.target.value)} />
          </Field>
        </div>

        <Field label="メモ (任意)">
          <textarea
            style={{ ...input, minHeight: 60, fontFamily: 'inherit' }}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="例: 4/23 体調不良で代走 等"
          />
        </Field>

        <div style={{ marginTop: 8, marginBottom: 12, padding: 10, background: '#f3f4f6', borderRadius: 4, fontSize: 13 }}>
          プレビュー: 対象行 <strong>{preview.rows.toLocaleString()}件</strong> / 合計 <strong>¥{preview.totalAmount.toLocaleString()}</strong>
        </div>

        <button style={btnPrimary} onClick={submit} disabled={submitting || loading}>
          {submitting ? '登録中...' : '付け替えを登録'}
        </button>
      </div>

      <div style={card}>
        <h2 style={sectionTitle}>有効な付け替え ({activeSwaps.length})</h2>
        {activeSwaps.length === 0 ? (
          <div style={{ color: colors.textMuted, fontSize: 13 }}>有効な付け替えはありません</div>
        ) : (
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>実行日時</th>
                <th style={th}>元ドライバー</th>
                <th style={th}>先ドライバー</th>
                <th style={th}>期間</th>
                <th style={th}>メモ</th>
                <th style={{ ...th, width: 100 }}></th>
              </tr>
            </thead>
            <tbody>
              {activeSwaps.map((s) => (
                <tr key={s.id}>
                  <td style={td}>{new Date(s.executed_at).toLocaleString('ja-JP')}</td>
                  <td style={td}>
                    {s.from_driver_name}
                    <div style={{ fontSize: 11, color: colors.textMuted }}>{s.from_driver_code}</div>
                  </td>
                  <td style={td}>
                    {s.to_driver_name}
                    <div style={{ fontSize: 11, color: colors.textMuted }}>{s.to_driver_code}</div>
                  </td>
                  <td style={td}>
                    {s.period_from}
                    <br />〜 {s.period_to}
                  </td>
                  <td style={{ ...td, fontSize: 12, color: colors.textMuted, whiteSpace: 'pre-wrap' }}>
                    {s.note ?? ''}
                  </td>
                  <td style={td}>
                    <button style={btn} onClick={() => revert(s)}>元に戻す</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {revertedSwaps.length > 0 && (
        <div style={{ ...card, marginTop: 16 }}>
          <h2 style={sectionTitle}>戻された履歴 ({revertedSwaps.length})</h2>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>実行日時</th>
                <th style={th}>戻し日時</th>
                <th style={th}>元 → 先</th>
                <th style={th}>期間</th>
                <th style={th}>メモ</th>
              </tr>
            </thead>
            <tbody>
              {revertedSwaps.map((s) => (
                <tr key={s.id} style={{ color: colors.textMuted }}>
                  <td style={td}>{new Date(s.executed_at).toLocaleString('ja-JP')}</td>
                  <td style={td}>{s.reverted_at ? new Date(s.reverted_at).toLocaleString('ja-JP') : ''}</td>
                  <td style={td}>
                    {s.from_driver_name} → {s.to_driver_name}
                  </td>
                  <td style={td}>{s.period_from} 〜 {s.period_to}</td>
                  <td style={{ ...td, fontSize: 12, whiteSpace: 'pre-wrap' }}>{s.note ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 4, fontWeight: 600 }}>
        {label}
      </div>
      {children}
    </div>
  );
}

const sectionTitle = { fontSize: 14, margin: '0 0 12px', color: '#374151' };
