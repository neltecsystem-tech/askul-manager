import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { WorkItem } from '../../types/db';
import PageHeader from '../../components/PageHeader';
import { btn, btnDanger, btnPrimary, card, colors, input, table, td, th } from '../../lib/ui';

interface Editing {
  id?: string;
  name: string;
  amount: number;
  sort_order: number;
  active: boolean;
}
const empty: Editing = { name: '', amount: 0, sort_order: 0, active: true };

export default function WorkItemsPage() {
  const [rows, setRows] = useState<WorkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('work_items')
      .select('*')
      .order('sort_order')
      .order('name');
    if (error) setError(error.message);
    else setRows((data ?? []) as WorkItem[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    if (!editing) return;
    setError(null);
    const name = editing.name.trim();
    if (!name) {
      setError('項目名は必須です');
      return;
    }
    setSaving(true);
    const payload = {
      name,
      amount: Number(editing.amount) || 0,
      sort_order: Number(editing.sort_order) || 0,
      active: editing.active,
    };
    const { error } = editing.id
      ? await supabase.from('work_items').update(payload).eq('id', editing.id)
      : await supabase.from('work_items').insert(payload);
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    setEditing(null);
    await load();
  };

  const del = async (row: WorkItem) => {
    if (
      !confirm(
        `「${row.name}」を削除しますか? このレコードを使っている稼働登録も連動削除されます。`,
      )
    )
      return;
    setError(null);
    const { error } = await supabase.from('work_items').delete().eq('id', row.id);
    if (error) setError(error.message);
    await load();
  };

  return (
    <div>
      <PageHeader
        title="稼働項目マスタ"
        actions={
          <button style={btnPrimary} onClick={() => setEditing({ ...empty })}>
            新規追加
          </button>
        }
      />

      <div style={{ ...card, marginBottom: 12, fontSize: 12, color: colors.textMuted }}>
        稼働登録画面で選べる項目を管理します。項目名と金額のセットで登録してください (例: 通常稼働 15000円 / 早朝手当 2000円 など)。
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
                <th style={th}>項目名</th>
                <th style={{ ...th, textAlign: 'right' }}>金額</th>
                <th style={{ ...th, textAlign: 'right' }}>並び順</th>
                <th style={th}>状態</th>
                <th style={{ ...th, textAlign: 'right' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={td}>{r.name}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{r.amount.toLocaleString()} 円</td>
                  <td style={{ ...td, textAlign: 'right' }}>{r.sort_order}</td>
                  <td style={td}>{r.active ? '有効' : '無効'}</td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <button
                      style={{ ...btn, marginRight: 6 }}
                      onClick={() =>
                        setEditing({
                          id: r.id,
                          name: r.name,
                          amount: r.amount,
                          sort_order: r.sort_order,
                          active: r.active,
                        })
                      }
                    >
                      編集
                    </button>
                    <button style={btnDanger} onClick={() => del(r)}>
                      削除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <div style={modal.overlay}>
          <div style={modal.modal}>
            <h2 style={{ fontSize: 15, margin: '0 0 12px' }}>
              {editing.id ? '項目編集' : '項目新規追加'}
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label style={lbl}>
                項目名
                <input
                  style={input}
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  placeholder="例: 通常稼働, 早朝手当"
                />
              </label>
              <label style={lbl}>
                金額 (円)
                <input
                  type="number"
                  style={input}
                  value={editing.amount}
                  onChange={(e) =>
                    setEditing({ ...editing, amount: Number(e.target.value) })
                  }
                />
              </label>
              <label style={lbl}>
                並び順
                <input
                  type="number"
                  style={input}
                  value={editing.sort_order}
                  onChange={(e) =>
                    setEditing({ ...editing, sort_order: Number(e.target.value) })
                  }
                />
              </label>
              <label style={{ ...lbl, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={editing.active}
                  onChange={(e) => setEditing({ ...editing, active: e.target.checked })}
                />
                有効
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
  modal: { background: '#fff', borderRadius: 6, padding: 20, width: 400, maxWidth: '90vw' },
};
