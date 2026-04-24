import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { Office } from '../../types/db';
import PageHeader from '../../components/PageHeader';
import { btn, btnDanger, btnPrimary, card, input, table, td, th } from '../../lib/ui';

interface Editing {
  id?: string;
  name: string;
  sort_order: number;
  active: boolean;
}

const emptyEditing: Editing = { name: '', sort_order: 0, active: true };

export default function OfficesPage() {
  const [offices, setOffices] = useState<Office[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('offices')
      .select('*')
      .order('sort_order')
      .order('name');
    if (error) setError(error.message);
    else setOffices(data as Office[]);
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
      sort_order: editing.sort_order,
      active: editing.active,
    };
    if (!payload.name) {
      setError('名称を入力してください');
      return;
    }
    const { error } = editing.id
      ? await supabase.from('offices').update(payload).eq('id', editing.id)
      : await supabase.from('offices').insert(payload);
    if (error) {
      setError(error.message);
      return;
    }
    setEditing(null);
    await load();
  };

  const remove = async (id: string) => {
    if (!confirm('削除しますか？（関連データがあると削除できません）')) return;
    const { error } = await supabase.from('offices').delete().eq('id', id);
    if (error) setError(error.message);
    await load();
  };

  return (
    <div>
      <PageHeader
        title="営業所マスタ"
        actions={
          <button style={btnPrimary} onClick={() => setEditing({ ...emptyEditing })}>
            新規追加
          </button>
        }
      />
      {error && <div style={{ color: '#dc2626', marginBottom: 12 }}>{error}</div>}
      <div style={card}>
        {loading ? (
          <div>読み込み中...</div>
        ) : offices.length === 0 ? (
          <div style={{ color: '#6b7280' }}>まだ営業所が登録されていません。</div>
        ) : (
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>名称</th>
                <th style={th}>並び順</th>
                <th style={th}>状態</th>
                <th style={{ ...th, width: 120 }}></th>
              </tr>
            </thead>
            <tbody>
              {offices.map((o) => (
                <tr key={o.id}>
                  <td style={td}>{o.name}</td>
                  <td style={td}>{o.sort_order}</td>
                  <td style={td}>{o.active ? '有効' : '無効'}</td>
                  <td style={td}>
                    <button
                      style={btn}
                      onClick={() =>
                        setEditing({
                          id: o.id,
                          name: o.name,
                          sort_order: o.sort_order,
                          active: o.active,
                        })
                      }
                    >
                      編集
                    </button>
                    <button style={{ ...btnDanger, marginLeft: 4 }} onClick={() => remove(o.id)}>
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
        <EditModal
          value={editing}
          onChange={setEditing}
          onSave={save}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function EditModal({
  value,
  onChange,
  onSave,
  onCancel,
}: {
  value: Editing;
  onChange: (v: Editing) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div style={modalStyles.overlay}>
      <div style={modalStyles.modal}>
        <h2 style={{ fontSize: 15, margin: '0 0 12px' }}>
          {value.id ? '営業所を編集' : '営業所を追加'}
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label style={labelStyle}>
            名称
            <input
              style={input}
              value={value.name}
              onChange={(e) => onChange({ ...value, name: e.target.value })}
              placeholder="杉並営業所"
            />
          </label>
          <label style={labelStyle}>
            並び順（小さいほど上）
            <input
              type="number"
              style={input}
              value={value.sort_order}
              onChange={(e) => onChange({ ...value, sort_order: Number(e.target.value) })}
            />
          </label>
          <label style={{ ...labelStyle, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={value.active}
              onChange={(e) => onChange({ ...value, active: e.target.checked })}
            />
            有効
          </label>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button style={btn} onClick={onCancel}>
            キャンセル
          </button>
          <button style={btnPrimary} onClick={onSave}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

const labelStyle = { display: 'flex', flexDirection: 'column' as const, gap: 4, fontSize: 12 };
const modalStyles = {
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
    width: 400,
    maxWidth: '90vw',
  },
};
