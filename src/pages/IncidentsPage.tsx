import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import type { Incident, IncidentStatus, Profile } from '../types/db';
import { incidentStatusLabels } from '../types/db';
import PageHeader from '../components/PageHeader';
import { btn, btnDanger, btnPrimary, card, colors, input, table, td, th } from '../lib/ui';

type EditMode = 'new' | 'driver_fill' | 'admin_edit';

interface Editing {
  mode: EditMode;
  id?: string;
  occurred_at: string;
  target_driver_id: string;
  category: string;
  content: string;
  cause: string;
  countermeasure: string;
  status: IncidentStatus;
  review_note: string;
}

const CATEGORY_SUGGESTIONS = [
  '配送',
  '車両',
  '事故',
  '顧客対応',
  '荷物破損',
  '誤配',
  'システム',
  'その他',
];

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function statusBadgeStyle(status: IncidentStatus): CSSProperties {
  const base: CSSProperties = {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 10,
    fontSize: 11,
    whiteSpace: 'nowrap',
  };
  switch (status) {
    case 'pending_driver':
      return { ...base, background: '#fef3c7', color: '#92400e' };
    case 'pending_review':
      return { ...base, background: '#dbeafe', color: '#1e40af' };
    case 'approved':
      return { ...base, background: '#d1fae5', color: '#065f46' };
  }
}

export default function IncidentsPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';

  const [rows, setRows] = useState<Incident[]>([]);
  const [drivers, setDrivers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<IncidentStatus | 'all'>('all');

  const driverNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of drivers) m.set(d.id, d.full_name);
    return m;
  }, [drivers]);

  const load = async () => {
    setLoading(true);
    setError(null);
    const [incRes, drvRes] = await Promise.all([
      supabase
        .from('incidents')
        .select('*')
        .order('occurred_at', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase
        .from('profiles')
        .select('*')
        .eq('active', true)
        .order('full_name'),
    ]);
    if (incRes.error) setError(incRes.error.message);
    else setRows((incRes.data ?? []) as Incident[]);
    if (drvRes.data) setDrivers(drvRes.data as Profile[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const myPendingTargets = useMemo(
    () =>
      rows.filter(
        (r) => r.target_driver_id === profile?.id && r.status === 'pending_driver',
      ),
    [rows, profile?.id],
  );

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return rows;
    return rows.filter((r) => r.status === statusFilter);
  }, [rows, statusFilter]);

  const openNew = () => {
    setEditing({
      mode: 'new',
      occurred_at: today(),
      target_driver_id: '',
      category: '',
      content: '',
      cause: '',
      countermeasure: '',
      status: 'pending_driver',
      review_note: '',
    });
  };

  const openDriverFill = (r: Incident) => {
    setEditing({
      mode: 'driver_fill',
      id: r.id,
      occurred_at: r.occurred_at,
      target_driver_id: r.target_driver_id ?? '',
      category: r.category ?? '',
      content: r.content,
      cause: r.cause ?? '',
      countermeasure: r.countermeasure ?? '',
      status: r.status,
      review_note: r.review_note ?? '',
    });
  };

  const openAdminEdit = (r: Incident) => {
    setEditing({
      mode: 'admin_edit',
      id: r.id,
      occurred_at: r.occurred_at,
      target_driver_id: r.target_driver_id ?? '',
      category: r.category ?? '',
      content: r.content,
      cause: r.cause ?? '',
      countermeasure: r.countermeasure ?? '',
      status: r.status,
      review_note: r.review_note ?? '',
    });
  };

  const save = async () => {
    if (!editing) return;
    if (!profile) {
      setError('ユーザー情報が取得できません');
      return;
    }
    setError(null);

    if (editing.mode === 'new') {
      if (!editing.occurred_at || !editing.target_driver_id || !editing.content.trim()) {
        setError('発生日・該当者・発生内容 は必須です');
        return;
      }
      setSaving(true);
      const { error } = await supabase.from('incidents').insert({
        occurred_at: editing.occurred_at,
        target_driver_id: editing.target_driver_id,
        category: editing.category.trim() || null,
        content: editing.content.trim(),
        status: 'pending_driver',
        created_by: profile.id,
      });
      setSaving(false);
      if (error) {
        setError(error.message);
        return;
      }
    } else if (editing.mode === 'driver_fill') {
      if (!editing.cause.trim() || !editing.countermeasure.trim()) {
        setError('原因と対策の両方を入力してください');
        return;
      }
      setSaving(true);
      const { error } = await supabase
        .from('incidents')
        .update({
          cause: editing.cause.trim(),
          countermeasure: editing.countermeasure.trim(),
          status: 'pending_review',
          review_note: null,
        })
        .eq('id', editing.id!);
      setSaving(false);
      if (error) {
        setError(error.message);
        return;
      }
    } else {
      // admin_edit (修正 → 承認 として保存)
      setSaving(true);
      const { error } = await supabase
        .from('incidents')
        .update({
          occurred_at: editing.occurred_at,
          target_driver_id: editing.target_driver_id || null,
          category: editing.category.trim() || null,
          content: editing.content.trim(),
          cause: editing.cause.trim() || null,
          countermeasure: editing.countermeasure.trim() || null,
          status: 'approved',
          reviewed_by: profile.id,
          reviewed_at: new Date().toISOString(),
          review_note: null,
        })
        .eq('id', editing.id!);
      setSaving(false);
      if (error) {
        setError(error.message);
        return;
      }
    }

    setEditing(null);
    await load();
    window.dispatchEvent(new Event('incidents-updated'));
  };

  const approve = async (r: Incident) => {
    if (!isAdmin || !profile) return;
    setError(null);
    const { error } = await supabase
      .from('incidents')
      .update({
        status: 'approved',
        reviewed_by: profile.id,
        reviewed_at: new Date().toISOString(),
        review_note: null,
      })
      .eq('id', r.id);
    if (error) setError(error.message);
    await load();
    window.dispatchEvent(new Event('incidents-updated'));
  };

  const reject = async (r: Incident) => {
    if (!isAdmin || !profile) return;
    const note = prompt('差し戻し理由 (該当者に表示されます):', r.review_note ?? '');
    if (note === null) return;
    setError(null);
    const { error } = await supabase
      .from('incidents')
      .update({
        status: 'pending_driver',
        review_note: note.trim() || null,
        reviewed_by: profile.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', r.id);
    if (error) setError(error.message);
    await load();
    window.dispatchEvent(new Event('incidents-updated'));
  };

  const del = async (r: Incident) => {
    if (!isAdmin) return;
    if (!confirm(`${r.occurred_at} の不具合記録を削除しますか?`)) return;
    setError(null);
    const { error } = await supabase.from('incidents').delete().eq('id', r.id);
    if (error) setError(error.message);
    await load();
    window.dispatchEvent(new Event('incidents-updated'));
  };

  const toggleExpand = (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded(next);
  };

  const renderActions = (r: Incident) => {
    const buttons: React.ReactNode[] = [];
    const isMyTarget = r.target_driver_id === profile?.id;
    if (isMyTarget && r.status === 'pending_driver') {
      buttons.push(
        <button
          key="fill"
          style={{ ...btnPrimary, marginRight: 6 }}
          onClick={() => openDriverFill(r)}
        >
          原因/対策を記入
        </button>,
      );
    }
    if (isAdmin) {
      if (r.status === 'pending_review') {
        buttons.push(
          <button
            key="approve"
            style={{ ...btnPrimary, marginRight: 6 }}
            onClick={() => approve(r)}
          >
            承認
          </button>,
        );
        buttons.push(
          <button key="reject" style={{ ...btn, marginRight: 6 }} onClick={() => reject(r)}>
            差し戻し
          </button>,
        );
      }
      buttons.push(
        <button key="edit" style={{ ...btn, marginRight: 6 }} onClick={() => openAdminEdit(r)}>
          {r.status === 'pending_review' ? '修正' : '編集'}
        </button>,
      );
      buttons.push(
        <button key="del" style={btnDanger} onClick={() => del(r)}>
          削除
        </button>,
      );
    }
    return buttons;
  };

  return (
    <div>
      <PageHeader
        title="不具合登録"
        actions={
          <button style={btnPrimary} onClick={openNew} disabled={!profile}>
            新規追加
          </button>
        }
      />

      {myPendingTargets.length > 0 && (
        <div style={alertBox}>
          <strong>⚠ 未対応の不具合 {myPendingTargets.length} 件あります。</strong>
          <div style={{ fontSize: 12, marginTop: 4 }}>
            該当行の「原因/対策を記入」ボタンから入力して提出してください。
            記入が完了するまでこのアラートは表示されます。
          </div>
        </div>
      )}

      <div style={{ ...card, marginBottom: 12, fontSize: 12, color: colors.textMuted }}>
        業務上の不具合・トラブルを記録します。発生内容は誰でも閲覧可。
        該当ドライバーが原因/対策を記入し、管理者が承認します。
      </div>

      {error && (
        <div style={{ color: '#dc2626', marginBottom: 12, whiteSpace: 'pre-wrap' }}>
          {error}
        </div>
      )}

      <div style={{ ...card, marginBottom: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
        <span style={{ fontSize: 12 }}>状態:</span>
        {(['all', 'pending_driver', 'pending_review', 'approved'] as const).map((s) => (
          <button
            key={s}
            style={{
              ...btn,
              ...(statusFilter === s
                ? { background: colors.primary, color: '#fff', borderColor: colors.primary }
                : {}),
            }}
            onClick={() => setStatusFilter(s)}
          >
            {s === 'all' ? 'すべて' : incidentStatusLabels[s]}
          </button>
        ))}
      </div>

      <div style={card}>
        {loading ? (
          <div style={{ color: colors.textMuted }}>読み込み中...</div>
        ) : filtered.length === 0 ? (
          <div style={{ color: colors.textMuted }}>該当する不具合はありません。</div>
        ) : (
          <table style={table}>
            <thead>
              <tr>
                <th style={{ ...th, width: 110 }}>発生日</th>
                <th style={{ ...th, width: 130 }}>該当者</th>
                <th style={{ ...th, width: 100 }}>区分</th>
                <th style={{ ...th, width: 130 }}>状態</th>
                <th style={th}>発生内容</th>
                <th style={{ ...th, textAlign: 'right', width: 240 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const open = expanded.has(r.id);
                const targetName = r.target_driver_id
                  ? driverNameById.get(r.target_driver_id) ?? '(削除済)'
                  : r.reporter_name ?? '—';
                const isMyTargetRow =
                  r.target_driver_id === profile?.id && r.status === 'pending_driver';
                return (
                  <>
                    <tr
                      key={r.id}
                      style={{
                        cursor: 'pointer',
                        background: isMyTargetRow ? '#fef3c7' : undefined,
                      }}
                      onClick={() => toggleExpand(r.id)}
                    >
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{r.occurred_at}</td>
                      <td style={td}>{targetName}</td>
                      <td style={td}>
                        {r.category ? (
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '2px 8px',
                              borderRadius: 10,
                              fontSize: 11,
                              background: '#e0e7ff',
                              color: '#3730a3',
                            }}
                          >
                            {r.category}
                          </span>
                        ) : (
                          <span style={{ color: colors.textMuted, fontSize: 11 }}>—</span>
                        )}
                      </td>
                      <td style={td}>
                        <span style={statusBadgeStyle(r.status)}>
                          {incidentStatusLabels[r.status]}
                        </span>
                      </td>
                      <td
                        style={{
                          ...td,
                          maxWidth: 400,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: open ? 'pre-wrap' : 'nowrap',
                        }}
                      >
                        {r.content}
                      </td>
                      <td
                        style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {renderActions(r)}
                      </td>
                    </tr>
                    {open && (
                      <tr key={r.id + ':detail'}>
                        <td
                          colSpan={6}
                          style={{
                            ...td,
                            background: '#f9fafb',
                            fontSize: 12,
                            whiteSpace: 'pre-wrap',
                          }}
                        >
                          <div style={{ marginBottom: 8 }}>
                            <strong>原因:</strong>{' '}
                            {r.cause ? (
                              r.cause
                            ) : (
                              <span style={{ color: colors.textMuted }}>(未記入)</span>
                            )}
                          </div>
                          <div style={{ marginBottom: 8 }}>
                            <strong>対策:</strong>{' '}
                            {r.countermeasure ? (
                              r.countermeasure
                            ) : (
                              <span style={{ color: colors.textMuted }}>(未記入)</span>
                            )}
                          </div>
                          {r.review_note && (
                            <div
                              style={{
                                marginTop: 8,
                                padding: 8,
                                background: '#fee2e2',
                                border: '1px solid #fca5a5',
                                borderRadius: 4,
                                color: '#991b1b',
                              }}
                            >
                              <strong>差し戻し理由:</strong> {r.review_note}
                            </div>
                          )}
                          {r.reviewed_at && (
                            <div
                              style={{
                                marginTop: 8,
                                fontSize: 11,
                                color: colors.textMuted,
                              }}
                            >
                              レビュー: {new Date(r.reviewed_at).toLocaleString('ja-JP')}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <div style={modal.overlay}>
          <div style={modal.modal}>
            <h2 style={{ fontSize: 15, margin: '0 0 12px' }}>
              {editing.mode === 'new'
                ? '不具合新規登録'
                : editing.mode === 'driver_fill'
                  ? '原因 / 対策 の記入'
                  : '不具合 編集'}
            </h2>

            {editing.mode === 'driver_fill' && editing.review_note && (
              <div
                style={{
                  padding: 8,
                  marginBottom: 12,
                  background: '#fee2e2',
                  border: '1px solid #fca5a5',
                  borderRadius: 4,
                  color: '#991b1b',
                  fontSize: 12,
                }}
              >
                <strong>差し戻し理由:</strong> {editing.review_note}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label style={lbl}>
                発生日 *
                <input
                  type="date"
                  style={input}
                  value={editing.occurred_at}
                  onChange={(e) => setEditing({ ...editing, occurred_at: e.target.value })}
                  disabled={editing.mode === 'driver_fill'}
                />
              </label>
              <label style={lbl}>
                該当者 *
                <select
                  style={input}
                  value={editing.target_driver_id}
                  onChange={(e) =>
                    setEditing({ ...editing, target_driver_id: e.target.value })
                  }
                  disabled={editing.mode === 'driver_fill'}
                >
                  <option value="">(選択してください)</option>
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.full_name}
                    </option>
                  ))}
                </select>
              </label>
              <label style={lbl}>
                区分
                <input
                  style={input}
                  list="incident-category-suggestions"
                  value={editing.category}
                  onChange={(e) => setEditing({ ...editing, category: e.target.value })}
                  placeholder="例: 配送 / 車両 / 顧客対応"
                  disabled={editing.mode === 'driver_fill'}
                />
                <datalist id="incident-category-suggestions">
                  {CATEGORY_SUGGESTIONS.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </label>
              <label style={lbl}>
                発生内容 *
                <textarea
                  style={{ ...input, minHeight: 80, fontFamily: 'inherit' }}
                  value={editing.content}
                  onChange={(e) => setEditing({ ...editing, content: e.target.value })}
                  placeholder="何が起きたかを具体的に"
                  disabled={editing.mode === 'driver_fill'}
                />
              </label>
              {editing.mode !== 'new' && (
                <>
                  <label style={lbl}>
                    原因 {editing.mode === 'driver_fill' && '*'}
                    <textarea
                      style={{ ...input, minHeight: 60, fontFamily: 'inherit' }}
                      value={editing.cause}
                      onChange={(e) => setEditing({ ...editing, cause: e.target.value })}
                      placeholder="判明した原因"
                    />
                  </label>
                  <label style={lbl}>
                    対策 {editing.mode === 'driver_fill' && '*'}
                    <textarea
                      style={{ ...input, minHeight: 60, fontFamily: 'inherit' }}
                      value={editing.countermeasure}
                      onChange={(e) =>
                        setEditing({ ...editing, countermeasure: e.target.value })
                      }
                      placeholder="再発防止策"
                    />
                  </label>
                </>
              )}
            </div>
            <div
              style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}
            >
              <button style={btn} onClick={() => setEditing(null)} disabled={saving}>
                キャンセル
              </button>
              <button style={btnPrimary} onClick={save} disabled={saving}>
                {saving
                  ? '保存中...'
                  : editing.mode === 'driver_fill'
                    ? '提出 (承認待ちへ)'
                    : editing.mode === 'admin_edit'
                      ? '保存して承認'
                      : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const lbl: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 12,
};

const alertBox: CSSProperties = {
  padding: 12,
  marginBottom: 12,
  background: '#fef3c7',
  border: '2px solid #f59e0b',
  borderRadius: 6,
  color: '#92400e',
};

const modal = {
  overlay: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(0,0,0,0.4)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  modal: {
    background: '#fff',
    borderRadius: 6,
    padding: 20,
    width: 500,
    maxWidth: '90vw',
    maxHeight: '90vh',
    overflow: 'auto',
  },
};
