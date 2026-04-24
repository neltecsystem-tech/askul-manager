import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import type { Incident } from '../types/db';
import PageHeader from '../components/PageHeader';
import { btn, btnDanger, btnPrimary, card, colors, input, table, td, th } from '../lib/ui';

interface Editing {
  id?: string;
  occurred_at: string;
  reporter_name: string;
  category: string;
  content: string;
  cause: string;
  countermeasure: string;
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

export default function IncidentsPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';

  const [rows, setRows] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase
      .from('incidents')
      .select('*')
      .order('occurred_at', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) setError(error.message);
    else setRows((data ?? []) as Incident[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const openNew = () => {
    setEditing({
      occurred_at: today(),
      reporter_name: profile?.full_name ?? '',
      category: '',
      content: '',
      cause: '',
      countermeasure: '',
    });
  };

  const openEdit = (r: Incident) =>
    setEditing({
      id: r.id,
      occurred_at: r.occurred_at,
      reporter_name: r.reporter_name,
      category: r.category ?? '',
      content: r.content,
      cause: r.cause ?? '',
      countermeasure: r.countermeasure ?? '',
    });

  const save = async () => {
    if (!editing) return;
    setError(null);
    if (!editing.occurred_at || !editing.reporter_name.trim() || !editing.content.trim()) {
      setError('発生日・氏名・発生内容 は必須です');
      return;
    }
    if (!profile) {
      setError('ユーザー情報が取得できません');
      return;
    }
    setSaving(true);
    const payload = {
      occurred_at: editing.occurred_at,
      reporter_name: editing.reporter_name.trim(),
      category: editing.category.trim() || null,
      content: editing.content.trim(),
      cause: editing.cause.trim() || null,
      countermeasure: editing.countermeasure.trim() || null,
    };
    const { error } = editing.id
      ? await supabase.from('incidents').update(payload).eq('id', editing.id)
      : await supabase
          .from('incidents')
          .insert({ ...payload, created_by: profile.id });
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    setEditing(null);
    await load();
  };

  const del = async (r: Incident) => {
    if (!isAdmin) return;
    if (!confirm(`${r.occurred_at} の不具合記録を削除しますか?`)) return;
    setError(null);
    const { error } = await supabase.from('incidents').delete().eq('id', r.id);
    if (error) setError(error.message);
    await load();
  };

  const toggleExpand = (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded(next);
  };

  const canEditRow = (r: Incident): boolean =>
    isAdmin || r.created_by === profile?.id;

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

      <div style={{ ...card, marginBottom: 12, fontSize: 12, color: colors.textMuted }}>
        業務上の不具合・トラブルを記録します。発生内容は誰でも見られ、投稿者と管理者のみ編集できます。削除は管理者のみ。
      </div>

      {error && (
        <div style={{ color: '#dc2626', marginBottom: 12, whiteSpace: 'pre-wrap' }}>
          {error}
        </div>
      )}

      <div style={card}>
        {loading ? (
          <div style={{ color: colors.textMuted }}>読み込み中...</div>
        ) : rows.length === 0 ? (
          <div style={{ color: colors.textMuted }}>登録されていません。</div>
        ) : (
          <table style={table}>
            <thead>
              <tr>
                <th style={{ ...th, width: 110 }}>発生日</th>
                <th style={{ ...th, width: 120 }}>氏名</th>
                <th style={{ ...th, width: 100 }}>区分</th>
                <th style={th}>発生内容</th>
                <th style={{ ...th, textAlign: 'right', width: 180 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const open = expanded.has(r.id);
                return (
                  <>
                    <tr
                      key={r.id}
                      style={{ cursor: 'pointer' }}
                      onClick={() => toggleExpand(r.id)}
                    >
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{r.occurred_at}</td>
                      <td style={td}>{r.reporter_name}</td>
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
                        {canEditRow(r) && (
                          <button
                            style={{ ...btn, marginRight: 6 }}
                            onClick={() => openEdit(r)}
                          >
                            編集
                          </button>
                        )}
                        {isAdmin && (
                          <button style={btnDanger} onClick={() => del(r)}>
                            削除
                          </button>
                        )}
                      </td>
                    </tr>
                    {open && (
                      <tr key={r.id + ':detail'}>
                        <td
                          colSpan={5}
                          style={{
                            ...td,
                            background: '#f9fafb',
                            fontSize: 12,
                            whiteSpace: 'pre-wrap',
                          }}
                        >
                          <div style={{ marginBottom: 8 }}>
                            <strong>原因:</strong>{' '}
                            {r.cause ? r.cause : (
                              <span style={{ color: colors.textMuted }}>(未記入)</span>
                            )}
                          </div>
                          <div>
                            <strong>対策:</strong>{' '}
                            {r.countermeasure ? r.countermeasure : (
                              <span style={{ color: colors.textMuted }}>(未記入)</span>
                            )}
                          </div>
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
              {editing.id ? '不具合編集' : '不具合新規登録'}
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label style={lbl}>
                発生日 *
                <input
                  type="date"
                  style={input}
                  value={editing.occurred_at}
                  onChange={(e) =>
                    setEditing({ ...editing, occurred_at: e.target.value })
                  }
                />
              </label>
              <label style={lbl}>
                氏名 *
                <input
                  style={input}
                  value={editing.reporter_name}
                  onChange={(e) =>
                    setEditing({ ...editing, reporter_name: e.target.value })
                  }
                  placeholder="例: 山田 太郎"
                />
              </label>
              <label style={lbl}>
                区分
                <input
                  style={input}
                  list="incident-category-suggestions"
                  value={editing.category}
                  onChange={(e) => setEditing({ ...editing, category: e.target.value })}
                  placeholder="例: 配送 / 車両 / 顧客対応"
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
                />
              </label>
              <label style={lbl}>
                原因
                <textarea
                  style={{ ...input, minHeight: 60, fontFamily: 'inherit' }}
                  value={editing.cause}
                  onChange={(e) => setEditing({ ...editing, cause: e.target.value })}
                  placeholder="判明していれば記入 (後で追記可)"
                />
              </label>
              <label style={lbl}>
                対策
                <textarea
                  style={{ ...input, minHeight: 60, fontFamily: 'inherit' }}
                  value={editing.countermeasure}
                  onChange={(e) =>
                    setEditing({ ...editing, countermeasure: e.target.value })
                  }
                  placeholder="再発防止策 (後で追記可)"
                />
              </label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button style={btn} onClick={() => setEditing(null)} disabled={saving}>
                キャンセル
              </button>
              <button style={btnPrimary} onClick={save} disabled={saving}>
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const lbl = { display: 'flex', flexDirection: 'column' as const, gap: 4, fontSize: 12 };
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
  modal: { background: '#fff', borderRadius: 6, padding: 20, width: 500, maxWidth: '90vw', maxHeight: '90vh', overflow: 'auto' },
};
