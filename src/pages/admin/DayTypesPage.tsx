import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { DayTypeDef } from '../../types/db';
import PageHeader from '../../components/PageHeader';
import { btn, btnDanger, btnPrimary, card, colors, input, table, td, th } from '../../lib/ui';

interface Editing {
  code: string;
  label: string;
  sort_order: number;
  is_system: boolean;
  isNew: boolean;
}

const emptyEditing: Editing = {
  code: '',
  label: '',
  sort_order: 10,
  is_system: false,
  isNew: true,
};

export default function DayTypesPage() {
  const [rows, setRows] = useState<DayTypeDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('day_types')
      .select('*')
      .order('sort_order')
      .order('code');
    if (error) setError(error.message);
    else setRows((data ?? []) as DayTypeDef[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    if (!editing) return;
    setError(null);
    const code = editing.code.trim();
    const label = editing.label.trim();
    if (!code) {
      setError('コードを入力してください');
      return;
    }
    if (!/^[a-z0-9_]+$/.test(code)) {
      setError('コードは半角英数字と_のみ使用できます');
      return;
    }
    if (!label) {
      setError('表示名を入力してください');
      return;
    }
    setSaving(true);
    if (editing.isNew) {
      const { error } = await supabase.from('day_types').insert({
        code,
        label,
        sort_order: editing.sort_order,
        is_system: false,
      });
      if (error) {
        setError(error.message);
        setSaving(false);
        return;
      }
    } else {
      const { error } = await supabase
        .from('day_types')
        .update({ label, sort_order: editing.sort_order })
        .eq('code', code);
      if (error) {
        setError(error.message);
        setSaving(false);
        return;
      }
    }
    setSaving(false);
    setEditing(null);
    await load();
  };

  const del = async (row: DayTypeDef) => {
    if (row.is_system) {
      alert('システム区分 (平日/土/日/祝日) は削除できません');
      return;
    }
    if (!confirm(`「${row.label}」を削除しますか? 関連する特別日・コース設定も連動削除されます。`)) return;
    setError(null);
    const { error } = await supabase.from('day_types').delete().eq('code', row.code);
    if (error) setError(error.message);
    await load();
  };

  return (
    <div>
      <PageHeader
        title="曜日区分マスタ"
        actions={
          <button style={btnPrimary} onClick={() => setEditing({ ...emptyEditing })}>
            新規追加
          </button>
        }
      />

      <div style={{ ...card, marginBottom: 12, fontSize: 12, color: colors.textMuted }}>
        シフトで使う曜日区分を管理します。平日/土/日/祝日はシステム組込。GW・年末年始など独自の区分を追加できます。
      </div>

      {error && (
        <div style={{ color: '#dc2626', marginBottom: 12, whiteSpace: 'pre-wrap' }}>
          {error}
        </div>
      )}

      <div style={card}>
        {loading ? (
          <div style={{ color: colors.textMuted }}>読み込み中...</div>
        ) : (
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>コード</th>
                <th style={th}>表示名</th>
                <th style={{ ...th, textAlign: 'right' }}>並び順</th>
                <th style={th}>種別</th>
                <th style={{ ...th, textAlign: 'right' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.code}>
                  <td style={{ ...td, fontFamily: 'monospace' }}>{r.code}</td>
                  <td style={td}>{r.label}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{r.sort_order}</td>
                  <td style={td}>
                    {r.is_system ? (
                      <span style={{ fontSize: 11, color: colors.textMuted }}>組込</span>
                    ) : (
                      <span style={{ fontSize: 11, color: colors.primary }}>カスタム</span>
                    )}
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <button
                      style={{ ...btn, marginRight: 6 }}
                      onClick={() =>
                        setEditing({
                          code: r.code,
                          label: r.label,
                          sort_order: r.sort_order,
                          is_system: r.is_system,
                          isNew: false,
                        })
                      }
                    >
                      編集
                    </button>
                    {!r.is_system && (
                      <button style={btnDanger} onClick={() => del(r)}>
                        削除
                      </button>
                    )}
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
              {editing.isNew ? '曜日区分 新規追加' : '曜日区分 編集'}
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label style={lbl}>
                コード (英数字)
                <input
                  style={input}
                  value={editing.code}
                  disabled={!editing.isNew}
                  onChange={(e) => setEditing({ ...editing, code: e.target.value })}
                  placeholder="例: gw, newyear, obon"
                />
              </label>
              <label style={lbl}>
                表示名
                <input
                  style={input}
                  value={editing.label}
                  onChange={(e) => setEditing({ ...editing, label: e.target.value })}
                  placeholder="例: GW, 年末年始"
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
  modal: { background: '#fff', borderRadius: 6, padding: 20, width: 420, maxWidth: '90vw' },
};
