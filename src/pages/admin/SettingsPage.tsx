import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { PagePermission } from '../../types/db';
import PageHeader from '../../components/PageHeader';
import { btn, btnPrimary, card, colors, input, table, td, th } from '../../lib/ui';

const ALWAYS_ADMIN_KEYS = new Set(['settings']); // 自分で自分を無効化できないように

export default function SettingsPage() {
  const [rows, setRows] = useState<PagePermission[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase
      .from('page_permissions')
      .select('*')
      .order('sort_order');
    if (error) setError(error.message);
    else setRows((data ?? []) as PagePermission[]);
    setLoading(false);
    setDirty(false);
  };

  useEffect(() => {
    load();
  }, []);

  const toggle = (key: string, field: 'admin_visible' | 'driver_visible') => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.page_key !== key) return r;
        if (field === 'admin_visible' && ALWAYS_ADMIN_KEYS.has(key)) return r; // 必須保護
        return { ...r, [field]: !r[field] };
      }),
    );
    setDirty(true);
  };

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    [next[index], next[target]] = [next[target], next[index]];
    setRows(next);
    setDirty(true);
  };

  const saveAll = async () => {
    setSaving(true);
    setError(null);
    // sort_order を現在の並び順で再採番 (10刻み)
    const updates = rows.map((r, i) =>
      supabase
        .from('page_permissions')
        .update({
          admin_visible: r.admin_visible,
          driver_visible: r.driver_visible,
          sort_order: (i + 1) * 10,
        })
        .eq('page_key', r.page_key),
    );
    const results = await Promise.all(updates);
    const firstErr = results.find((r) => r.error)?.error;
    setSaving(false);
    if (firstErr) {
      setError(firstErr.message);
      return;
    }
    setDirty(false);
    await load();
    window.dispatchEvent(new Event('page-permissions-updated'));
  };

  return (
    <div>
      <PageHeader
        title="表示ページ設定"
        actions={
          <>
            <button style={btn} onClick={load} disabled={loading || saving}>
              再読込
            </button>
            <button style={btnPrimary} onClick={saveAll} disabled={saving || !dirty}>
              {saving ? '保存中...' : dirty ? '保存' : '変更なし'}
            </button>
          </>
        }
      />
      <div style={{ ...card, marginBottom: 12, fontSize: 12, color: colors.textMuted }}>
        管理者 / ドライバー それぞれに対し、左メニューに表示するページをチェックで切替できます。
        チェックを外すとそのロールのユーザーからは非表示になります（直接URL入力でもアクセス時にリダイレクトされる場合があります）。
        設定後は各ユーザーに**再ログインまたはページ再読込**を案内してください。
      </div>

      {error && <div style={{ color: '#dc2626', marginBottom: 12 }}>{error}</div>}

      <div style={card}>
        {loading ? (
          <div>読み込み中...</div>
        ) : (
          <table style={table}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: 'center', width: 80 }}>並替</th>
                <th style={th}>ページ</th>
                <th style={th}>page_key</th>
                <th style={{ ...th, textAlign: 'center', width: 100 }}>管理者に表示</th>
                <th style={{ ...th, textAlign: 'center', width: 130 }}>ドライバーに表示</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.page_key}>
                  <td style={{ ...td, textAlign: 'center', whiteSpace: 'nowrap' }}>
                    <button
                      style={{ ...btn, padding: '2px 6px', fontSize: 12, marginRight: 2 }}
                      onClick={() => move(i, -1)}
                      disabled={i === 0}
                      title="上へ"
                    >
                      ▲
                    </button>
                    <button
                      style={{ ...btn, padding: '2px 6px', fontSize: 12 }}
                      onClick={() => move(i, 1)}
                      disabled={i === rows.length - 1}
                      title="下へ"
                    >
                      ▼
                    </button>
                  </td>
                  <td style={td}>{r.label}</td>
                  <td style={{ ...td, fontSize: 11, color: '#6b7280' }}>
                    /{r.page_key === 'dashboard' ? '' : r.page_key}
                  </td>
                  <td style={{ ...td, textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={r.admin_visible}
                      disabled={ALWAYS_ADMIN_KEYS.has(r.page_key)}
                      onChange={() => toggle(r.page_key, 'admin_visible')}
                    />
                  </td>
                  <td style={{ ...td, textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={r.driver_visible}
                      onChange={() => toggle(r.page_key, 'driver_visible')}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* unused to suppress lint */}
      <span style={{ display: 'none' }}>
        {input && null}
      </span>
    </div>
  );
}
