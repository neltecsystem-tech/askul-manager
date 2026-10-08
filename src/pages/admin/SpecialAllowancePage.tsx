import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import PageHeader from '../../components/PageHeader';
import { btn, btnDanger, btnPrimary, card, colors, input, table, td, th } from '../../lib/ui';

const TYPE_OPTIONS = ['個建+', '車建', '車建OR個建', '引継ぎ'];
// 違約金は特別日当シートに書かず、DBの penalties に入れる。
// このツールの支払計算には入らない(控除は会計の「車両リース・貸付金マスタ」で行う)。
const PENALTY = '違約金';
const NEW_TYPE_OPTIONS = [...TYPE_OPTIONS, PENALTY];
const INPUTTER_OPTIONS = ['前橋', '吉田', '小林'];

type DriverOption = { id: string; full_name: string };
type Status = { ok: true; message: string } | { ok: false; message: string } | null;
type SheetRow = {
  row: number;
  timestamp: string;
  event_date: string;
  driver_name: string;
  type: string;
  amount: string;
  reason: string;
  inputter: string;
  penaltyId?: string; // 違約金(DB)の行。シートの行は undefined
};

// 一覧の並び: 日付の新しい順(同じ日はシート行の新しい順)
function sortKey(s: string): string {
  const m = (s || '').replace(/-/g, '/').match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  return m ? `${m[1]}${m[2].padStart(2, '0')}${m[3].padStart(2, '0')}` : '';
}

function todayJST(): string {
  const d = new Date();
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return (
    jst.getUTCFullYear() +
    '-' +
    String(jst.getUTCMonth() + 1).padStart(2, '0') +
    '-' +
    String(jst.getUTCDate()).padStart(2, '0')
  );
}

// "2026/07/20" などを date input 用 "2026-07-20" に変換
function toInputDate(s: string): string {
  const m = (s || '').replace(/-/g, '/').match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (!m) return '';
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}

async function callFn(name: string, body: unknown): Promise<any> {
  const session = (await supabase.auth.getSession()).data.session;
  if (!session) throw new Error('セッション切れ。再ログインしてください。');
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

export default function SpecialAllowancePage() {
  const [drivers, setDrivers] = useState<DriverOption[]>([]);
  const [loadingDrivers, setLoadingDrivers] = useState(true);

  const [eventDate, setEventDate] = useState<string>(todayJST());
  const [driverName, setDriverName] = useState<string>('');
  const [type, setType] = useState<string>(TYPE_OPTIONS[0]);
  const [amount, setAmount] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [inputter, setInputter] = useState<string>(INPUTTER_OPTIONS[0]);

  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  // 一覧
  const [rows, setRows] = useState<SheetRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(true);
  const [rowsError, setRowsError] = useState<string>('');

  // 編集モーダル
  const [editing, setEditing] = useState<SheetRow | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const fetchRows = useCallback(async () => {
    setLoadingRows(true);
    setRowsError('');
    try {
      const [{ res, data }, pen] = await Promise.all([
        callFn('special-allowance-manage', { action: 'list' }),
        supabase.from('penalties').select('*').order('event_date', { ascending: false }),
      ]);
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      if (pen.error) throw new Error('違約金の取得に失敗: ' + pen.error.message);
      const list = (data.rows ?? []) as SheetRow[];
      const penRows: SheetRow[] = ((pen.data ?? []) as any[]).map((p) => ({
        row: 0, timestamp: p.created_at, event_date: String(p.event_date).replace(/-/g, '/'),
        driver_name: p.driver_name, type: PENALTY, amount: String(p.amount),
        reason: p.reason, inputter: p.inputter, penaltyId: p.id,
      }));
      const all = [...list, ...penRows];
      all.sort((a, b) => sortKey(b.event_date).localeCompare(sortKey(a.event_date)) || b.row - a.row);
      setRows(all);
    } catch (e) {
      setRowsError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingRows(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('active', true)
        .order('full_name');
      if (error) console.warn('profiles fetch failed:', error);
      const arr = ((data ?? []) as { id: string; full_name: string }[]).filter((d) => !!d.full_name);
      setDrivers(arr);
      setLoadingDrivers(false);
    })();
    fetchRows();
  }, [fetchRows]);

  const submit = async (force = false) => {
    setStatus(null);
    if (!eventDate || !driverName || !type || !amount.trim() || !reason.trim() || !inputter) {
      setStatus({ ok: false, message: '全ての項目を入力してください' });
      return;
    }
    const numAmount = Number(String(amount).replace(/,/g, ''));
    if (!isFinite(numAmount) || numAmount <= 0) {
      setStatus({ ok: false, message: '金額は正の数値を入力してください' });
      return;
    }

    setSubmitting(true);
    if (type === PENALTY) {
      const { error } = await supabase.from('penalties').insert({
        event_date: eventDate, driver_name: driverName, amount: Math.round(numAmount),
        reason: reason.trim(), inputter,
      });
      setSubmitting(false);
      if (error) { setStatus({ ok: false, message: '登録に失敗: ' + error.message }); return; }
      setStatus({ ok: true, message: '違約金を登録しました（会計の控除に反映されます）' });
      setAmount('');
      setReason('');
      fetchRows();
      return;
    }
    try {
      const { res, data } = await callFn('append-form-response', {
        event_date: eventDate,
        driver_name: driverName,
        type,
        amount: numAmount,
        reason: reason.trim(),
        inputter,
        force,
      });
      if (res.status === 409 && data.duplicate) {
        setSubmitting(false);
        const ok = window.confirm(
          `${eventDate} / ${driverName} は既に登録があります。\nそれでも重複して登録しますか?`,
        );
        if (ok) await submit(true);
        return;
      }
      if (!res.ok || data.error) {
        setStatus({ ok: false, message: data.error || `HTTP ${res.status}` });
      } else {
        setStatus({ ok: true, message: `登録完了 (${data.timestamp ?? ''})` });
        setAmount('');
        setReason('');
        fetchRows();
      }
    } catch (e) {
      setStatus({ ok: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setSubmitting(false);
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    if (
      !editing.event_date || !editing.driver_name || !editing.type ||
      !String(editing.amount).trim() || !editing.reason.trim() || !editing.inputter
    ) {
      window.alert('全ての項目を入力してください');
      return;
    }
    setSavingEdit(true);
    if (editing.penaltyId) {
      const amt = Number(String(editing.amount).replace(/,/g, ''));
      if (!isFinite(amt) || amt <= 0) { window.alert('金額は正の数値を入力してください'); setSavingEdit(false); return; }
      const { error } = await supabase.from('penalties').update({
        event_date: editing.event_date, driver_name: editing.driver_name, amount: Math.round(amt),
        reason: editing.reason.trim(), inputter: editing.inputter,
      }).eq('id', editing.penaltyId);
      setSavingEdit(false);
      if (error) { window.alert('保存に失敗: ' + error.message); return; }
      setEditing(null);
      fetchRows();
      return;
    }
    try {
      const { res, data } = await callFn('special-allowance-manage', {
        action: 'update',
        row: editing.row,
        timestamp: editing.timestamp,
        event_date: editing.event_date,
        driver_name: editing.driver_name,
        type: editing.type,
        amount: editing.amount,
        reason: editing.reason,
        inputter: editing.inputter,
      });
      if (!res.ok || data.error) {
        window.alert(data.error || `HTTP ${res.status}`);
      } else {
        setEditing(null);
        fetchRows();
      }
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingEdit(false);
    }
  };

  const deleteRow = async (r: SheetRow) => {
    if (!window.confirm(`削除しますか?\n${r.event_date} / ${r.driver_name} / ${r.type} / ${r.amount}円`)) return;
    if (r.penaltyId) {
      const { error } = await supabase.from('penalties').delete().eq('id', r.penaltyId);
      if (error) window.alert('削除に失敗: ' + error.message);
      else fetchRows();
      return;
    }
    try {
      const { res, data } = await callFn('special-allowance-manage', {
        action: 'delete',
        row: r.row,
        timestamp: r.timestamp,
      });
      if (!res.ok || data.error) {
        window.alert(data.error || `HTTP ${res.status}`);
      } else {
        fetchRows();
      }
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div>
      <PageHeader title="特別日当 登録" />

      <div style={{ ...card, padding: 16, maxWidth: 560 }}>
        <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 12 }}>
          Googleフォーム同等の入力で「フォームの回答 1」シートに直接書き込みます。
          <br />
          同じ日付・氏名の重複登録はブロックされます。
          <br />
          種別「違約金」はシートに書かず、このツールの支払には入りません。会計の控除（車両リース・貸付金マスタ）に反映されます。
        </div>

        <Field label="日付">
          <input type="date" style={input} value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
        </Field>

        <Field label="氏名">
          <select
            style={input}
            value={driverName}
            onChange={(e) => setDriverName(e.target.value)}
            disabled={loadingDrivers}
          >
            <option value="">{loadingDrivers ? '読込中...' : '選択してください'}</option>
            {drivers.map((d) => (
              <option key={d.id} value={d.full_name}>
                {d.full_name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="種別">
          <select style={input} value={type} onChange={(e) => setType(e.target.value)}>
            {NEW_TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>

        <Field label="金額 (円)">
          <input
            type="number"
            inputMode="numeric"
            style={input}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="例: 22000"
          />
        </Field>

        <Field label="事由">
          <textarea
            style={{ ...input, minHeight: 80, fontFamily: 'inherit' }}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="例: 祝日出勤、引継ぎ補助 等"
          />
        </Field>

        <Field label="入力者">
          <select style={input} value={inputter} onChange={(e) => setInputter(e.target.value)}>
            {INPUTTER_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </Field>

        <div style={{ display: 'flex', gap: 8, marginTop: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <button style={btnPrimary} onClick={() => submit(false)} disabled={submitting}>
            {submitting ? '送信中...' : '登録'}
          </button>
          <button
            style={btn}
            onClick={() => {
              setEventDate(todayJST());
              setDriverName('');
              setType(TYPE_OPTIONS[0]);
              setAmount('');
              setReason('');
              setInputter(INPUTTER_OPTIONS[0]);
              setStatus(null);
            }}
            disabled={submitting}
          >
            クリア
          </button>
          {status && (
            <div style={{ fontSize: 13, color: status.ok ? '#059669' : colors.danger, fontWeight: 500 }}>
              {status.ok ? '✓ ' : '⚠ '}
              {status.message}
            </div>
          )}
        </div>
      </div>

      {/* 登録済み一覧 */}
      <div style={{ ...card, padding: 16, marginTop: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>登録済み一覧</div>
          <span style={{ fontSize: 12, color: colors.textMuted }}>{rows.length} 件</span>
          <button style={btn} onClick={fetchRows} disabled={loadingRows}>
            {loadingRows ? '読込中...' : '再読み込み'}
          </button>
        </div>

        {rowsError && (
          <div style={{ color: colors.danger, fontSize: 13, marginBottom: 8 }}>⚠ {rowsError}</div>
        )}

        <div style={{ overflowX: 'auto' }}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>日付</th>
                <th style={th}>氏名</th>
                <th style={th}>種別</th>
                <th style={{ ...th, textAlign: 'right' }}>金額</th>
                <th style={th}>事由</th>
                <th style={th}>入力者</th>
                <th style={{ ...th, textAlign: 'right' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {!loadingRows && rows.length === 0 && (
                <tr>
                  <td style={td} colSpan={7}>
                    データがありません
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.penaltyId ?? r.row}>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{r.event_date}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{r.driver_name}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap', color: r.penaltyId ? colors.danger : undefined, fontWeight: r.penaltyId ? 700 : undefined }}>{r.type}</td>
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {r.penaltyId ? '−' : ''}{Number(String(r.amount).replace(/,/g, '')).toLocaleString()}
                  </td>
                  <td style={td}>{r.reason}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{r.inputter}</td>
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button
                      style={{ ...btn, marginRight: 6 }}
                      onClick={() => setEditing({ ...r, event_date: toInputDate(r.event_date) })}
                    >
                      編集
                    </button>
                    <button style={btnDanger} onClick={() => deleteRow(r)}>
                      削除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 編集モーダル */}
      {editing && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
            padding: 24, zIndex: 1000, overflowY: 'auto',
          }}
          onClick={() => !savingEdit && setEditing(null)}
        >
          <div
            style={{ ...card, padding: 20, width: '100%', maxWidth: 480 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12 }}>{editing.penaltyId ? '違約金 編集' : '特別日当 編集'}</div>

            <Field label="日付">
              <input
                type="date"
                style={input}
                value={editing.event_date}
                onChange={(e) => setEditing({ ...editing, event_date: e.target.value })}
              />
            </Field>

            <Field label="氏名">
              <select
                style={input}
                value={editing.driver_name}
                onChange={(e) => setEditing({ ...editing, driver_name: e.target.value })}
              >
                {/* 既存値が候補に無い場合も表示できるよう先頭に確保 */}
                {!drivers.some((d) => d.full_name === editing.driver_name) && editing.driver_name && (
                  <option value={editing.driver_name}>{editing.driver_name}</option>
                )}
                {drivers.map((d) => (
                  <option key={d.id} value={d.full_name}>
                    {d.full_name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="種別">
              <select
                style={input}
                value={editing.type}
                disabled={!!editing.penaltyId}
                title={editing.penaltyId ? '違約金を特別日当に変えるときは削除して登録し直してください' : undefined}
                onChange={(e) => setEditing({ ...editing, type: e.target.value })}
              >
                {editing.penaltyId && <option value={PENALTY}>{PENALTY}</option>}
                {!TYPE_OPTIONS.includes(editing.type) && editing.type && (
                  <option value={editing.type}>{editing.type}</option>
                )}
                {TYPE_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="金額 (円)">
              <input
                type="number"
                inputMode="numeric"
                style={input}
                value={editing.amount}
                onChange={(e) => setEditing({ ...editing, amount: e.target.value })}
              />
            </Field>

            <Field label="事由">
              <textarea
                style={{ ...input, minHeight: 80, fontFamily: 'inherit' }}
                value={editing.reason}
                onChange={(e) => setEditing({ ...editing, reason: e.target.value })}
              />
            </Field>

            <Field label="入力者">
              <select
                style={input}
                value={editing.inputter}
                onChange={(e) => setEditing({ ...editing, inputter: e.target.value })}
              >
                {!INPUTTER_OPTIONS.includes(editing.inputter) && editing.inputter && (
                  <option value={editing.inputter}>{editing.inputter}</option>
                )}
                {INPUTTER_OPTIONS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </Field>

            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button style={btnPrimary} onClick={saveEdit} disabled={savingEdit}>
                {savingEdit ? '保存中...' : '保存'}
              </button>
              <button style={btn} onClick={() => setEditing(null)} disabled={savingEdit}>
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 4, fontWeight: 600 }}>{label}</div>
      {children}
    </div>
  );
}
