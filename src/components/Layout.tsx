import { NavLink, Outlet } from 'react-router-dom';
import { useEffect, useState, type CSSProperties } from 'react';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/ui';
import type { PagePermission } from '../types/db';

interface NavItem {
  to: string;
  label: string;
  adminOnly?: boolean;
  fallbackAdmin?: boolean;
  fallbackDriver?: boolean;
}

// page_key -> to(URL path) のマッピング
function toPath(key: string): string {
  return key === 'dashboard' ? '/' : '/' + key;
}

// DBが未取得の間の既定
const DEFAULT_ITEMS: { key: string; label: string; fallbackAdmin: boolean; fallbackDriver: boolean }[] = [
  { key: 'dashboard', label: 'ダッシュボード', fallbackAdmin: true, fallbackDriver: true },
  { key: 'shifts', label: 'シフト', fallbackAdmin: true, fallbackDriver: true },
  { key: 'shift-schedule-settings', label: 'シフト曜日別コース設定', fallbackAdmin: true, fallbackDriver: false },
  { key: 'shift-patterns', label: '基本シフトパターン', fallbackAdmin: true, fallbackDriver: false },
  { key: 'masters/day-types', label: '曜日区分マスタ', fallbackAdmin: true, fallbackDriver: false },
  { key: 'masters/special-dates', label: '特別日マスタ', fallbackAdmin: true, fallbackDriver: false },
  { key: 'masters/work-items', label: '稼働項目マスタ', fallbackAdmin: true, fallbackDriver: false },
  { key: 'work-records', label: '稼働登録', fallbackAdmin: true, fallbackDriver: true },
  { key: 'incidents', label: '不具合登録', fallbackAdmin: true, fallbackDriver: true },
  { key: 'courses-map', label: 'コースエリア地図', fallbackAdmin: true, fallbackDriver: false },
  { key: 'deliveries', label: '配送実績 (全員)', fallbackAdmin: true, fallbackDriver: false },
  { key: 'my-deliveries', label: '自分の配送実績', fallbackAdmin: true, fallbackDriver: true },
  { key: 'expenses', label: '立替金精算', fallbackAdmin: true, fallbackDriver: false },
  { key: 'closing', label: '月次締め/請求', fallbackAdmin: true, fallbackDriver: false },
  { key: 'drivers', label: 'ドライバー管理', fallbackAdmin: true, fallbackDriver: false },
  { key: 'masters/offices', label: '営業所マスタ', fallbackAdmin: true, fallbackDriver: false },
  { key: 'masters/size-categories', label: 'サイズ区分マスタ', fallbackAdmin: true, fallbackDriver: false },
  { key: 'masters/courses', label: 'コースマスタ', fallbackAdmin: true, fallbackDriver: false },
  { key: 'masters/vehicle-days', label: '車建日マスタ', fallbackAdmin: true, fallbackDriver: false },
];

export default function Layout() {
  const { profile, signOut } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [permissions, setPermissions] = useState<PagePermission[] | null>(null);

  const loadPermissions = async () => {
    const { data } = await supabase
      .from('page_permissions')
      .select('*')
      .order('sort_order');
    if (data) setPermissions(data as PagePermission[]);
  };

  useEffect(() => {
    loadPermissions();
    const onUpdate = () => loadPermissions();
    window.addEventListener('page-permissions-updated', onUpdate);
    return () => window.removeEventListener('page-permissions-updated', onUpdate);
  }, []);

  const items: NavItem[] = (() => {
    if (permissions) {
      return permissions
        .filter((p) => (isAdmin ? p.admin_visible : p.driver_visible))
        .map((p) => ({ to: toPath(p.page_key), label: p.label }));
    }
    // フォールバック(DB未取得)
    return DEFAULT_ITEMS.filter((i) => (isAdmin ? i.fallbackAdmin : i.fallbackDriver)).map((i) => ({
      to: toPath(i.key),
      label: i.label,
    }));
  })();

  // 設定ページは管理者専用で常に表示
  if (isAdmin) {
    items.push({ to: '/settings', label: '表示ページ設定' });
  }

  return (
    <div style={styles.root}>
      <aside style={styles.sidebar}>
        <div style={styles.sidebarHeader}>アスクル管理</div>
        <nav style={styles.nav}>
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              style={({ isActive }) => ({
                ...styles.navLink,
                ...(isActive ? styles.navLinkActive : {}),
              })}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div style={styles.main}>
        <header style={styles.header}>
          <div style={{ fontSize: 13, color: colors.textMuted }}>
            {profile?.full_name} ({isAdmin ? '管理者' : 'ドライバー'})
          </div>
          <button onClick={signOut} style={styles.logoutBtn}>
            ログアウト
          </button>
        </header>
        <main style={styles.content}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  root: { display: 'flex', minHeight: '100vh', background: colors.bg },
  sidebar: {
    width: 220,
    background: colors.sidebar,
    color: colors.sidebarText,
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
  },
  sidebarHeader: {
    padding: '16px',
    fontSize: 15,
    fontWeight: 600,
    color: '#fff',
    borderBottom: '1px solid #334155',
  },
  nav: { display: 'flex', flexDirection: 'column', padding: '8px 0' },
  navLink: {
    padding: '10px 16px',
    color: colors.sidebarText,
    textDecoration: 'none',
    fontSize: 13,
    borderLeft: '3px solid transparent',
  },
  navLinkActive: {
    background: colors.sidebarActive,
    color: colors.sidebarTextActive,
    borderLeftColor: '#60a5fa',
  },
  main: { flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 },
  header: {
    height: 48,
    background: '#fff',
    borderBottom: '1px solid ' + colors.borderLight,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 12,
    padding: '0 16px',
  },
  logoutBtn: {
    padding: '6px 12px',
    border: '1px solid ' + colors.border,
    borderRadius: 4,
    background: '#fff',
    cursor: 'pointer',
    fontSize: 13,
  },
  content: { flex: 1, padding: 20, overflow: 'auto' },
};
