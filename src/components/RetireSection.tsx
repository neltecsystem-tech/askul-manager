// 🚪 退職予定(2026-10-26)。登録先は NexPort の staff_retirements 1か所(EF staff-retire)。
// この画面からは staff-retire-proxy(このプロジェクトのEF)を通す: 管理者かどうかを確かめ、共有シークレットを付けて中継する。
// どのツールから登録しても全ツール共通。退職日の翌日に自動で「無効」(ログイン不可・シフト編成の対象外)になる。
// ※ askul-manager と delivery-manager に同じファイルがある。直すときは両方そろえる。
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { supabase } from '../lib/supabase';

export type Retirement = {
  id: string; full_name: string; retire_date: string; reason: '自己都合' | '契約終了' | 'その他'; note: string | null;
  site: string | null; created_from: string | null; created_by_name: string | null; created_at: string;
  updated_by_name: string | null; updated_at: string; processed_at: string | null;
  askul_profile_id: string | null; delivery_profile_id: string | null;
  needs_replacement?: boolean;   // 補填が必要(面談シートの不足人員に足す)
  shifts_after?: { tool: string; what: string; count: number }[];
};
const REASONS = ['自己都合', '契約終了', 'その他'] as const;
// このツールのドライバーと中央の行をつなぐ列
const ID_FIELD = 'askul_profile_id' as const;

async function callProxy(payload: Record<string, unknown>) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('ログインし直してください');
  const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/staff-retire-proxy`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(payload),
  });
  const j = await r.json().catch(() => ({ error: '応答を読めませんでした' }));
  if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

/** 退職予定の一覧(このツールのドライバーID → 退職予定) */
export function useRetirements(enabled = true) {
  const [map, setMap] = useState<Record<string, Retirement>>({});
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    if (!enabled) { setMap({}); return; }   // 権限が無い人には読まない・見せない
    try {
      const j = await callProxy({ action: 'list' });
      const m: Record<string, Retirement> = {};
      for (const r of (j.rows ?? []) as Retirement[]) if (r[ID_FIELD]) m[r[ID_FIELD]!] = r;
      setMap(m); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [enabled]);
  useEffect(() => { reload(); }, [reload]);
  return { map, error, reload };
}

const daysUntil = (d: string) => Math.round((new Date(d + 'T00:00:00+09:00').getTime() - Date.now()) / 86400000);
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

/** 一覧の氏名の横に出すバッジ */
export function RetireBadge({ r }: { r?: Retirement }) {
  if (!r) return null;
  const left = daysUntil(r.retire_date);
  const warn = (r.shifts_after ?? []).length > 0;
  const bg = left < 0 ? '#e5e7eb' : left <= 14 ? '#fee2e2' : '#fef3c7';
  const fg = left < 0 ? '#374151' : left <= 14 ? '#991b1b' : '#92400e';
  return (
    <span title={`${r.reason}${r.note ? '：' + r.note : ''}${warn ? '\n⚠ ' + r.shifts_after!.map((s) => s.what).join('\n⚠ ') : ''}`}
      style={{ marginLeft: 6, fontSize: 11, padding: '1px 7px', borderRadius: 8, background: bg, color: fg, whiteSpace: 'nowrap' }}>
      {left < 0 ? '退職' : '退職予定'} {md(r.retire_date)}{warn ? ' ⚠シフトあり' : ''}
    </span>
  );
}

/** 編集画面の「退職予定」欄。保存ボタンとは別に、その場で登録・取消する */
export function RetireSection({ driverId, r, onChanged }: { driverId: string; r?: Retirement; onChanged: () => void }) {
  const [date, setDate] = useState(r?.retire_date ?? '');
  const [reason, setReason] = useState<Retirement['reason']>(r?.reason ?? '自己都合');
  const [note, setNote] = useState(r?.note ?? '');
  const [needs, setNeeds] = useState<boolean>(r?.needs_replacement ?? true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { setDate(r?.retire_date ?? ''); setReason(r?.reason ?? '自己都合'); setNote(r?.note ?? ''); setNeeds(r?.needs_replacement ?? true); setMsg(null); }, [r?.id, r?.updated_at, driverId]);

  const save = async () => {
    if (!date) { setMsg('退職日（最終勤務日）を入れてください'); return; }
    setBusy(true); setMsg(null);
    try {
      const j = await callProxy({ action: 'set', driver_id: driverId, retire_date: date, reason, note, needs_replacement: needs });
      const w = (j.row?.shifts_after ?? []) as Retirement['shifts_after'];
      setMsg(w && w.length ? `登録しました。⚠ ${w.map((x) => x.what).join('／')}` : '登録しました。全ツール共通で表示されます。');
      onChanged();
    } catch (e) { setMsg(`登録できませんでした: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setBusy(false); }
  };
  const cancel = async () => {
    if (!r || !confirm('退職予定を取り消しますか？')) return;
    setBusy(true); setMsg(null);
    try {
      const j = await callProxy({ action: 'cancel', id: r.id });
      setMsg(j.note || '取り消しました。'); onChanged();
    } catch (e) { setMsg(`取り消せませんでした: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setBusy(false); }
  };

  return (
    <div style={box}>
      <div style={{ fontWeight: 700, fontSize: 13 }}>🚪 退職予定 <span style={{ fontWeight: 400, fontSize: 11, color: '#6b7280' }}>（全ツール共通。退職日の翌日に自動で無効＝ログイン不可・シフト編成の対象外。支払明細は引き続き見られます）</span></div>
      {r && (
        <div style={{ fontSize: 12, color: '#374151' }}>
          {r.processed_at ? '✅ 退職の処理済み' : `登録済み：${r.retire_date}（${r.reason}）`}
          <span style={{ color: '#6b7280' }}>　登録 {r.created_by_name ?? '—'}（{r.created_from ?? '—'}）{new Date(r.created_at).toLocaleString('ja-JP')}{r.updated_by_name && r.updated_at !== r.created_at ? `／更新 ${r.updated_by_name} ${new Date(r.updated_at).toLocaleString('ja-JP')}` : ''}</span>
        </div>
      )}
      {(r?.shifts_after ?? []).map((s, i) => <div key={i} style={{ fontSize: 12, color: '#b45309' }}>⚠ 退職日より後に {s.what}</div>)}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={lbl}>退職日（最終勤務日）<input type="date" style={inp} value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label style={lbl}>理由
          <select style={inp} value={reason} onChange={(e) => setReason(e.target.value as Retirement['reason'])}>
            {REASONS.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
        <label style={{ ...lbl, flex: 1, minWidth: 160 }}>メモ<input style={inp} value={note} onChange={(e) => setNote(e.target.value)} placeholder="任意" /></label>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
        <input type="checkbox" checked={needs} onChange={(e) => setNeeds(e.target.checked)} />
        補填が必要（NexPort 面談シートの「不足人員」に1人足す）
      </label>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" style={btnP} disabled={busy} onClick={save}>{busy ? '処理中…' : r ? '退職予定を更新' : '退職予定を登録'}</button>
        {r && <button type="button" style={btnD} disabled={busy} onClick={cancel}>取り消し</button>}
      </div>
      {msg && <div style={{ fontSize: 12, color: msg.includes('できません') ? '#b91c1c' : '#065f46' }}>{msg}</div>}
    </div>
  );
}

const box: CSSProperties = { border: '1px solid #fcd34d', background: '#fffbeb', borderRadius: 8, padding: 10, display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 };
const lbl: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12 };
const inp: CSSProperties = { padding: '5px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 };
const btnP: CSSProperties = { padding: '6px 12px', background: '#b45309', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer' };
const btnD: CSSProperties = { padding: '6px 12px', background: '#fff', color: '#b91c1c', border: '1px solid #fca5a5', borderRadius: 6, fontSize: 13, cursor: 'pointer' };
