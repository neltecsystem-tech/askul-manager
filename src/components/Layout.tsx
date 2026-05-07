import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
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

// 設定ページに集約された page_key (サイドバーには表示しない。代わりに「⚙ 設定」を1つ表示)
const SETTINGS_KEYS = new Set([
  'settings',
  'shift-schedule-settings',
  'shift-patterns',
  'masters/day-types',
  'masters/special-dates',
  'masters/work-items',
  'masters/offices',
  'masters/size-categories',
  'masters/courses',
  'masters/vehicle-days',
  'drivers',
]);

// DBが未取得の間の既定
const DEFAULT_ITEMS: { key: string; label: string; fallbackAdmin: boolean; fallbackDriver: boolean }[] = [
  { key: 'dashboard', label: 'ダッシュボード', fallbackAdmin: true, fallbackDriver: true },
  { key: 'shifts', label: 'シフト', fallbackAdmin: true, fallbackDriver: true },
  { key: 'work-records', label: '稼働登録', fallbackAdmin: true, fallbackDriver: true },
  { key: 'incidents', label: '不具合登録', fallbackAdmin: true, fallbackDriver: true },
  { key: 'courses-map', label: 'コースエリア地図', fallbackAdmin: true, fallbackDriver: false },
  { key: 'deliveries', label: '配送実績 (全員)', fallbackAdmin: true, fallbackDriver: false },
  { key: 'my-deliveries', label: '自分の配送実績', fallbackAdmin: true, fallbackDriver: true },
  { key: 'expenses', label: '立替金精算', fallbackAdmin: true, fallbackDriver: false },
  { key: 'special-allowance', label: '特別日当 登録', fallbackAdmin: true, fallbackDriver: false },
  { key: 'closing', label: '月次締め/請求', fallbackAdmin: true, fallbackDriver: false },
  { key: 'payment-statements', label: '支払明細書', fallbackAdmin: true, fallbackDriver: true },
];

const MOBILE_BREAKPOINT = 768;

export default function Layout() {
  const { profile, signOut } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [permissions, setPermissions] = useState<PagePermission[] | null>(null);
  const [pendingIncidents, setPendingIncidents] = useState<number>(0);
  const [isMobile, setIsMobile] = useState<boolean>(
    typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT,
  );
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(
    typeof window !== 'undefined' && window.innerWidth >= MOBILE_BREAKPOINT,
  );
  const location = useLocation();

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

  // 該当ドライバー記入待ち件数
  useEffect(() => {
    if (!profile?.id) {
      setPendingIncidents(0);
      return;
    }
    let cancelled = false;
    const fetchPending = async () => {
      const { count } = await supabase
        .from('incidents')
        .select('id', { count: 'exact', head: true })
        .eq('target_driver_id', profile.id)
        .eq('status', 'pending_driver');
      if (!cancelled) setPendingIncidents(count ?? 0);
    };
    fetchPending();
    const onUpdate = () => fetchPending();
    window.addEventListener('incidents-updated', onUpdate);
    return () => {
      cancelled = true;
      window.removeEventListener('incidents-updated', onUpdate);
    };
  }, [profile?.id, location.pathname]);

  useEffect(() => {
    const onResize = () => {
      const mobile = window.innerWidth < MOBILE_BREAKPOINT;
      setIsMobile(mobile);
      if (!mobile) setSidebarOpen(true);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // モバイルでナビゲーション時にサイドバーを閉じる
  useEffect(() => {
    if (isMobile) setSidebarOpen(false);
  }, [location.pathname, isMobile]);

  const items: NavItem[] = (() => {
    if (permissions) {
      return permissions
        .filter((p) => !SETTINGS_KEYS.has(p.page_key))
        .filter((p) => (isAdmin ? p.admin_visible : p.driver_visible))
        .map((p) => ({ to: toPath(p.page_key), label: p.label }));
    }
    return DEFAULT_ITEMS.filter((i) => (isAdmin ? i.fallbackAdmin : i.fallbackDriver)).map((i) => ({
      to: toPath(i.key),
      label: i.label,
    }));
  })();

  if (isAdmin) {
    items.push({ to: '/settings', label: '⚙ 設定' });
  }

  const sidebarStyle: CSSProperties = {
    ...styles.sidebar,
    ...(isMobile
      ? {
          position: 'fixed',
          top: 0,
          left: 0,
          bottom: 0,
          width: 240,
          zIndex: 10000,
          transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 0.2s ease',
          boxShadow: sidebarOpen ? '2px 0 8px rgba(0,0,0,0.2)' : 'none',
        }
      : {}),
  };

  return (
    <div style={styles.root}>
      {/* モバイル用バックドロップ */}
      {isMobile && sidebarOpen && (
        <div style={styles.backdrop} onClick={() => setSidebarOpen(false)} />
      )}

      <aside style={sidebarStyle}>
        <div style={styles.sidebarHeader}>
          <span>アスクル管理</span>
          {isMobile && (
            <button
              style={styles.closeBtn}
              onClick={() => setSidebarOpen(false)}
              aria-label="閉じる"
            >
              ✕
            </button>
          )}
        </div>
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
          {isMobile && (
            <button
              style={styles.menuBtn}
              onClick={() => setSidebarOpen(true)}
              aria-label="メニューを開く"
            >
              ☰
            </button>
          )}
          <div style={{ fontSize: 13, color: colors.textMuted, flex: 1 }}>
            {profile?.full_name} ({isAdmin ? '管理者' : 'ドライバー'})
          </div>
          <Link to="/change-password" style={{ ...styles.logoutBtn, textDecoration: 'none', color: '#0f172a', marginRight: 8 }}>
            🔑 パスワード変更
          </Link>
          <button onClick={signOut} style={styles.logoutBtn}>
            ログアウト
          </button>
        </header>
        <main style={styles.content}>
          {pendingIncidents > 0 && location.pathname !== '/incidents' && (
            <Link to="/incidents" style={styles.alertBanner}>
              <span>⚠ 未対応の不具合が {pendingIncidents} 件あります。原因/対策を記入してください。</span>
              <span style={{ fontSize: 12, opacity: 0.85 }}>→ 不具合登録ページへ</span>
            </Link>
          )}
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
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  closeBtn: {
    background: 'transparent',
    color: '#fff',
    border: 'none',
    fontSize: 18,
    cursor: 'pointer',
    padding: '0 4px',
  },
  nav: { display: 'flex', flexDirection: 'column', padding: '8px 0', overflow: 'auto' },
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
    minHeight: 48,
    background: '#fff',
    borderBottom: '1px solid ' + colors.borderLight,
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '0 16px',
  },
  menuBtn: {
    background: 'transparent',
    border: '1px solid ' + colors.border,
    borderRadius: 4,
    fontSize: 18,
    padding: '4px 10px',
    cursor: 'pointer',
    lineHeight: 1,
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
  alertBanner: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 14px',
    marginBottom: 16,
    background: '#fef3c7',
    border: '2px solid #f59e0b',
    borderRadius: 6,
    color: '#92400e',
    fontWeight: 600,
    textDecoration: 'none',
    fontSize: 14,
  },
  backdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.5)',
    zIndex: 9999,
  },
};
