import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { VehicleDay } from '../../types/db';
import PageHeader from '../../components/PageHeader';
import { btn, btnDanger, btnPrimary, card, input, table, td, th } from '../../lib/ui';

interface Editing {
  id?: string;
  month: number;
  day: number;
  amount: number;
  note: string;
  active: boolean;
}
const empty: Editing = { month: 1, day: 1, amount: 22000, note: '', active: true };

export default function VehicleDaysPage() {
  const [rows, setRows] = useState<VehicleDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('vehicle_days')
      .select('*')
      .order('month')
      .order('day');
    if (error) setError(error.message);
    else setRows(data as VehicleDay[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    if (!editing) return;
    setError(null);
    const m = Number(editing.month);
    const d = Number(editing.day);
    if (!(m >= 1 && m <= 12)) {
      setError('月は 1 〜 12 を指定してください');
      return;
    }
    if (!(d >= 1 && d <= 31)) {
      setError('日は 1 〜 31 を指定してください');
      return;
    }
    const payload = {
      month: m,
      day: d,
      amount: editing.amount,
      note: editing.note.trim() || null,
      active: editing.active,
    };
    const { error } = editing.id
      ? await supabase.from('vehicle_days').update(payload).eq('id', editing.id)
      : await supabase.from('vehicle_days').insert(payload);
    if (error) {
      setError(error.message);
      return;
    }
    setEditing(null);
    await load();
  };

  const remove = async (id: string) => {
    if (!confirm('削除しますか？')) return;
    const { error } = await supabase.from('vehicle_days').delete().eq('id', id);
    if (error) setError(error.message);
    await load();
  };

  return (
    <div>
      <PageHeader
        title="車建日マスタ"
        actions={
          <button style={btnPrimary} onClick={() => setEditing({ ...empty })}>
            新規追加
          </button>
        }
      />
      <div style={{ ...card, marginBottom: 12, fontSize: 12, color: '#6b7280' }}>
        祝日・年末年始など「個建ではなく車建で支払う日」を登録します。
        登録された日に配送実績がある場合、個建金額はカウントされず、ここの金額が車建として計上されます（控除対象外）。
      </div>
      {error && <div style={{ color: '#dc2626', marginBottom: 12 }}>{error}</div>}
      <div style={card}>
        {loading ? (
          <div>読み込み中...</div>
        ) : rows.length === 0 ? (
          <div style={{ color: '#6b7280' }}>まだ登録されていません。</div>
        ) : (
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>月日</th>
                <th style={{ ...th, textAlign: 'right' }}>車建金額</th>
                <th style={th}>備考</th>
                <th style={th}>状態</th>
                <th style={{ ...th, width: 120 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={td}>
                    {r.month}月{r.day}日
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    ¥{Number(r.amount).toLocaleString()}
                  </td>
                  <td style={td}>{r.note || '—'}</td>
                  <td style={td}>{r.active ? '有効' : '無効'}</td>
                  <td style={td}>
                    <button
                      style={btn}
                      onClick={() =>
                        setEditing({
                          id: r.id,
                          month: r.month,
                          day: r.day,
                          amount: Number(r.amount),
                          note: r.note ?? '',
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
              {editing.id ? '車建日を編集' : '車建日を追加'}
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <label style={labelStyle}>
                  月
                  <input
                    type="number"
                    min={1}
                    max={12}
                    style={{ ...input, width: 100 }}
                    value={editing.month}
                    onChange={(e) => setEditing({ ...editing, month: Number(e.target.value) })}
                  />
                </label>
                <label style={labelStyle}>
                  日
                  <input
                    type="number"
                    min={1}
                    max={31}
                    style={{ ...input, width: 100 }}
                    value={editing.day}
                    onChange={(e) => setEditing({ ...editing, day: Number(e.target.value) })}
                  />
                </label>
              </div>
              <label style={labelStyle}>
                車建金額（円）
                <input
                  type="number"
                  step="0.01"
                  style={input}
                  value={editing.amount}
                  onChange={(e) => setEditing({ ...editing, amount: Number(e.target.value) })}
                />
              </label>
              <label style={labelStyle}>
                備考（祝日名など、任意）
                <input
                  style={input}
                  value={editing.note}
                  onChange={(e) => setEditing({ ...editing, note: e.target.value })}
                  placeholder="例: 元日"
                />
              </label>
              <label style={{ ...labelStyle, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={editing.active}
                  onChange={(e) => setEditing({ ...editing, active: e.target.checked })}
                />
                有効（チェックを外すと集計時に無視されます）
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
