// 🚫 支払停止（明細発行STOP）
//
// 重大な契約違反などで支払いを保留する方を登録し、明細の発行を止める。
//
// 🚨 会計の金額は止まらない。確定は今まで通り走り、未払いとして残る。
//    契約違反があっても報酬債務そのものは消えないため(2026-09-18 利用者判断)。
// 🚨 登録するとアスクルだけでなく全現場(新聞・ヤマト・東スポ)がまとめて止まる。
//
// 登録先は NexPort(workchat)の pay_suspensions ただ1か所。
// この画面は pay-suspension-proxy EF を経由して書く(シークレットをブラウザに置かないため)。
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';

type Row = {
  id: string;
  subject_key: string;
  name_at_reg: string | null;
  from_ym: string;
  to_ym: string | null;
  reason: string;
  reopen_past: boolean;
  tool: string | null;
  created_at: string;
  release_note: string | null;
};
type Driver = { id: string; full_name: string; active: boolean | null };

const thisYm = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export default function PaySuspensionPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [includeReleased, setIncludeReleased] = useState(false);
  const [driverId, setDriverId] = useState('');
  const [fromYm, setFromYm] = useState(thisYm());
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const call = async (payload: Record<string, unknown>) => {
    const token = (await supabase.auth.getSession()).data.session?.access_token || '';
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/pay-suspension-proxy`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    const j = await r.json().catch(() => ({ error: '応答を読めませんでした' }));
    if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  };

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const [{ rows: list }, { data: ds }] = await Promise.all([
        call({ action: 'list', include_released: includeReleased }),
        supabase.from('profiles').select('id, full_name, active').order('full_name'),
      ]);
      setRows(list as Row[]);
      setDrivers((ds ?? []) as Driver[]);
    } catch (e: any) {
      setError(e.message || String(e));
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [includeReleased]); // eslint-disable-line

  const activeDrivers = useMemo(() => drivers.filter((d) => d.active !== false), [drivers]);

  const add = async () => {
    if (!driverId) { alert('対象のドライバーを選んでください'); return; }
    if (!/^\d{4}-\d{2}$/.test(fromYm)) { alert('停止を始める月を選んでください'); return; }
    if (reason.trim().length < 2) {
      alert('理由を入力してください（後から「なぜ止めたか」を追えるようにするためです）'); return;
    }
    const name = drivers.find((d) => d.id === driverId)?.full_name || '';
    // 🚨 全現場が止まることを必ず確認させる。アスクルだけのつもりで押されると事故になる。
    if (!window.confirm([
      `${name} さんの支払いを ${fromYm} 分から停止します。`, '',
      '・明細ビューアに出なくなります',
      '・支払通知メールも送られなくなります',
      '・アスクルだけでなく【全現場】が止まります',
      '・会計の金額は残ります（未払い）', '',
      'よろしいですか？',
    ].join('\n'))) return;
    setBusy(true); setError(null);
    try {
      await call({ action: 'set', driver_id: driverId, from_ym: fromYm, reason: reason.trim() });
      setDriverId(''); setReason('');
      await load();
    } catch (e: any) { setError(e.message || String(e)); }
    finally { setBusy(false); }
  };

  const release = async (r: Row) => {
    if (!window.confirm(`${r.name_at_reg ?? r.subject_key} さんの支払停止を解除します。よろしいですか？`)) return;
    // 止めていた月ぶんを見せるかは運用が分かれるので必ず選ばせる
    const reopen = window.confirm([
      '止めていた月の明細も本人に見せますか？', '',
      '「OK」= 見せる（支払いを再開して過去分も精算する場合）',
      '「キャンセル」= 止めた月は非公開のまま（解除した月から再開）',
    ].join('\n'));
    setBusy(true); setError(null);
    try { await call({ action: 'release', id: r.id, reopen_past: reopen }); await load(); }
    catch (e: any) { setError(e.message || String(e)); }
    finally { setBusy(false); }
  };

  const card: React.CSSProperties = { background: '#fff', borderRadius: 10, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,.08)' };
  const th: React.CSSProperties = { textAlign: 'left', padding: 8, borderBottom: '1px solid #e2e8f0', fontSize: 12, color: '#64748b' };
  const td: React.CSSProperties = { padding: 8, borderBottom: '1px solid #f1f5f9', fontSize: 13 };
  const input: React.CSSProperties = { padding: 8, border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 14 };

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <h2 style={{ margin: 0, fontSize: 20 }}>🚫 支払停止（明細発行STOP）</h2>

      <div style={{ ...card, background: '#fef2f2', border: '1px solid #fca5a5', color: '#7f1d1d', fontSize: 13, lineHeight: 1.8 }}>
        重大な契約違反などで<b>支払いを保留する方</b>を登録します。登録すると、指定した月から
        <b>明細ビューアに出なくなり、支払通知メールも送られなくなります</b>。<br />
        🚨 <b>会計の金額は止まりません</b>（未払いとして残ります）。止まるのは発行だけです。<br />
        🚨 <b>アスクルだけでなく全現場がまとめて止まります。</b><br />
        本人の画面には理由を出さず「担当者にお問い合わせください」とだけ表示します。
      </div>

      {error && <div style={{ ...card, background: '#fef2f2', color: '#991b1b', fontSize: 13 }}>{error}</div>}

      <div style={{ ...card, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 12, color: '#64748b', fontWeight: 700 }}>対象のドライバー</span>
          <select value={driverId} onChange={(e) => setDriverId(e.target.value)} style={{ ...input, minWidth: 220 }}>
            <option value="">選択してください</option>
            {activeDrivers.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
          </select>
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 12, color: '#64748b', fontWeight: 700 }}>停止を始める月</span>
          <input type="month" value={fromYm} onChange={(e) => setFromYm(e.target.value)} style={input} />
        </label>
        <label style={{ display: 'grid', gap: 4, flex: 1, minWidth: 240 }}>
          <span style={{ fontSize: 12, color: '#64748b', fontWeight: 700 }}>理由（社内用・本人には出ません）</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="例: 重大な契約違反のため支払保留" style={input} />
        </label>
        <button onClick={add} disabled={busy}
          style={{ background: '#dc2626', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 8, cursor: 'pointer', fontWeight: 700, opacity: busy ? 0.6 : 1 }}>
          🚫 停止を登録
        </button>
      </div>

      <div style={card}>
        <label style={{ fontSize: 13, color: '#475569' }}>
          <input type="checkbox" checked={includeReleased} onChange={(e) => setIncludeReleased(e.target.checked)} /> 解除済みも表示
        </label>
        {loading ? <p style={{ color: '#64748b' }}>読み込み中…</p> : rows.length === 0 ? (
          <p style={{ color: '#64748b' }}>停止中の方はいません。</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 10 }}>
            <thead><tr><th style={th}>氏名</th><th style={th}>停止期間</th><th style={th}>理由</th><th style={th}>起票</th><th style={th} /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={td}>{r.name_at_reg ?? r.subject_key}</td>
                  <td style={td}>
                    {r.to_ym
                      ? `${r.from_ym} 〜 ${r.to_ym} 分で解除${r.reopen_past ? '（過去分も公開）' : '（止めた月は非公開のまま）'}`
                      : <>{r.from_ym} 分〜 <b style={{ color: '#dc2626' }}>停止中</b></>}
                  </td>
                  <td style={{ ...td, color: '#64748b' }}>{r.reason}</td>
                  <td style={{ ...td, color: '#94a3b8' }}>{r.tool ?? '—'}</td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    {!r.to_ym && (
                      <button onClick={() => release(r)} disabled={busy}
                        style={{ background: '#0ea5e9', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>
                        解除
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
