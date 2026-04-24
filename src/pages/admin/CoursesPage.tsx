import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { Course, Office } from '../../types/db';
import PageHeader from '../../components/PageHeader';
import { btn, btnDanger, btnPrimary, card, input, table, td, th } from '../../lib/ui';

interface Editing {
  id?: string;
  name: string;
  office_id: string;
  daily_vehicle_fee: number;
  sort_order: number;
  active: boolean;
}
const empty: Editing = {
  name: '',
  office_id: '',
  daily_vehicle_fee: 0,
  sort_order: 0,
  active: true,
};

export default function CoursesPage() {
  const [rows, setRows] = useState<Course[]>([]);
  const [offices, setOffices] = useState<Office[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const [coursesRes, officesRes] = await Promise.all([
      supabase.from('courses').select('*').order('sort_order').order('name'),
      supabase.from('offices').select('*').order('sort_order').order('name'),
    ]);
    if (coursesRes.error) setError(coursesRes.error.message);
    else setRows(coursesRes.data as Course[]);
    if (officesRes.error) setError(officesRes.error.message);
    else setOffices(officesRes.data as Office[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const officeName = (id: string) => offices.find((o) => o.id === id)?.name ?? '(不明)';

  const save = async () => {
    if (!editing) return;
    setError(null);
    if (!editing.name.trim()) {
      setError('コース名を入力してください');
      return;
    }
    if (!editing.office_id) {
      setError('営業所を選択してください');
      return;
    }
    const payload = {
      name: editing.name.trim(),
      office_id: editing.office_id,
      daily_vehicle_fee: editing.daily_vehicle_fee,
      sort_order: editing.sort_order,
      active: editing.active,
    };
    const { error } = editing.id
      ? await supabase.from('courses').update(payload).eq('id', editing.id)
      : await supabase.from('courses').insert(payload);
    if (error) {
      setError(error.message);
      return;
    }
    setEditing(null);
    await load();
  };

  const remove = async (id: string) => {
    if (!confirm('削除しますか？')) return;
    const { error } = await supabase.from('courses').delete().eq('id', id);
    if (error) setError(error.message);
    await load();
  };

  return (
    <div>
      <PageHeader
        title="コースマスタ"
        actions={
          <button
            style={btnPrimary}
            onClick={() => {
              if (offices.length === 0) {
                setError('先に営業所を登録してください');
                return;
              }
              setEditing({ ...empty, office_id: offices[0].id });
            }}
          >
            新規追加
          </button>
        }
      />
      {error && <div style={{ color: '#dc2626', marginBottom: 12 }}>{error}</div>}
      <div style={card}>
        {loading ? (
          <div>読み込み中...</div>
        ) : rows.length === 0 ? (
          <div style={{ color: '#6b7280' }}>コースを登録してください。車建金額（1日あたり固定料金）もここで設定します。</div>
        ) : (
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>コース名</th>
                <th style={th}>営業所</th>
                <th style={{ ...th, textAlign: 'right' }}>車建/日（円）</th>
                <th style={th}>並び順</th>
                <th style={th}>状態</th>
                <th style={{ ...th, width: 120 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={td}>{r.name}</td>
                  <td style={td}>{officeName(r.office_id)}</td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    ¥{Number(r.daily_vehicle_fee).toLocaleString()}
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
                          office_id: r.office_id,
                          daily_vehicle_fee: Number(r.daily_vehicle_fee),
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
              {editing.id ? 'コースを編集' : 'コースを追加'}
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label style={labelStyle}>
                コース名
                <input
                  style={input}
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  placeholder="例: 杉並A"
                />
              </label>
              <label style={labelStyle}>
                営業所
                <select
                  style={input}
                  value={editing.office_id}
                  onChange={(e) => setEditing({ ...editing, office_id: e.target.value })}
                >
                  <option value="">-- 選択 --</option>
                  {offices.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </label>
              <label style={labelStyle}>
                車建金額（1日あたり、円）
                <input
                  type="number"
                  step="0.01"
                  style={input}
                  value={editing.daily_vehicle_fee}
                  onChange={(e) =>
                    setEditing({ ...editing, daily_vehicle_fee: Number(e.target.value) })
                  }
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
  modal: { background: '#fff', borderRadius: 6, padding: 20, width: 420, maxWidth: '90vw' },
};
