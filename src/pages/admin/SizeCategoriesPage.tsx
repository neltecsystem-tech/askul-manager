import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { SizeCategory } from '../../types/db';
import PageHeader from '../../components/PageHeader';
import { btn, btnDanger, btnPrimary, card, input, table, td, th } from '../../lib/ui';

interface Editing {
  id?: string;
  name: string;
  unit_price: number;
  sort_order: number;
  active: boolean;
}
const empty: Editing = { name: '', unit_price: 0, sort_order: 0, active: true };

export default function SizeCategoriesPage() {
  const [rows, setRows] = useState<SizeCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('size_categories')
      .select('*')
      .order('sort_order')
      .order('name');
    if (error) setError(error.message);
    else setRows(data as SizeCategory[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    if (!editing) return;
    setError(null);
    const payload = {
      name: editing.name.trim(),
      unit_price: editing.unit_price,
      sort_order: editing.sort_order,
      active: editing.active,
    };
    if (!payload.name) {
      setError('名称を入力してください');
      return;
    }
    const { error } = editing.id
      ? await supabase.from('size_categories').update(payload).eq('id', editing.id)
      : await supabase.from('size_categories').insert(payload);
    if (error) {
      setError(error.message);
      return;
    }
    setEditing(null);
    await load();
  };

  const remove = async (id: string) => {
    if (!confirm('削除しますか？')) return;
    const { error } = await supabase.from('size_categories').delete().eq('id', id);
    if (error) setError(error.message);
    await load();
  };

  return (
    <div>
      <PageHeader
        title="サイズ区分マスタ"
        actions={
          <button style={btnPrimary} onClick={() => setEditing({ ...empty })}>
            新規追加
          </button>
        }
      />
      {error && <div style={{ color: '#dc2626', marginBottom: 12 }}>{error}</div>}
      <div style={card}>
        {loading ? (
          <div>読み込み中...</div>
        ) : rows.length === 0 ? (
          <div style={{ color: '#6b7280' }}>
            サイズ区分（小・中・大 など）を登録してください。これが個建の単価になります。
          </div>
        ) : (
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>区分名</th>
                <th style={{ ...th, textAlign: 'right' }}>個建単価（円）</th>
                <th style={th}>並び順</th>
                <th style={th}>状態</th>
                <th style={{ ...th, width: 120 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={td}>{r.name}</td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    ¥{Number(r.unit_price).toLocaleString()}
                  </td>
                  <td style={td}>{r.sort_order}</td>
                  <td style={td}>{r.active ? '有効' : '無効'}</td>
                  <td style={td}>
                    <button
                      style={btn}
                      onClick={() =>
                        setEditing({
                          id: r.id,
                          name: r.name,
                          unit_price: Number(r.unit_price),
                          sort_order: r.sort_order,
                          active: r.active,
                        })
                      }
                    >
                      編集
                    </button>
                    <button style={{ ...btnDanger, marginLeft: 4 }} onClick={() => remove(r.id)}>
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
              {editing.id ? 'サイズ区分を編集' : 'サイズ区分を追加'}
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label style={labelStyle}>
                区分名
                <input
                  style={input}
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  placeholder="小 / 中 / 大 など"
                />
              </label>
              <label style={labelStyle}>
                個建単価（円）
                <input
                  type="number"
                  step="0.01"
                  style={input}
                  value={editing.unit_price}
                  onChange={(e) => setEditing({ ...editing, unit_price: Number(e.target.value) })}
                />
              </label>
              <label style={labelStyle}>
                並び順
                <input
                  type="number"
                  style={input}
                  value={editing.sort_order}
                  onChange={(e) => setEditing({ ...editing, sort_order: Number(e.target.value) })}
                />
              </label>
              <label style={{ ...labelStyle, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={editing.active}
                  onChange={(e) => setEditing({ ...editing, active: e.target.checked })}
                />
                有効
              </label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button style={btn} onClick={() => setEditing(null)}>
                キャンセル
              </button>
              <button style={btnPrimary} onClick={save}>
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const labelStyle = { display: 'flex', flexDirection: 'column' as const, gap: 4, fontSize: 12 };
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
