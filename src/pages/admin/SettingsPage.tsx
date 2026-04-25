import { NavLink, Outlet, useLocation, Navigate } from 'react-router-dom';
import { type CSSProperties } from 'react';
import { colors } from '../../lib/ui';

interface SettingItem {
  to: string;
  label: string;
  group: string;
}

const ITEMS: SettingItem[] = [
  { to: 'page-permissions', label: '表示ページ設定', group: 'システム' },
  { to: 'drivers', label: 'ドライバー管理', group: 'システム' },
  { to: 'offices', label: '営業所マスタ', group: 'マスタ' },
  { to: 'size-categories', label: 'サイズ区分マスタ', group: 'マスタ' },
  { to: 'courses', label: 'コースマスタ', group: 'マスタ' },
  { to: 'vehicle-days', label: '車建日マスタ', group: 'マスタ' },
  { to: 'day-types', label: '曜日区分マスタ', group: 'マスタ' },
  { to: 'special-dates', label: '特別日マスタ', group: 'マスタ' },
  { to: 'work-items', label: '稼働項目マスタ', group: 'マスタ' },
  { to: 'shift-schedule', label: 'シフト曜日別コース設定', group: 'シフト' },
  { to: 'shift-patterns', label: '基本シフトパターン', group: 'シフト' },
];

export default function SettingsPage() {
  const location = useLocation();

  if (location.pathname === '/settings' || location.pathname === '/settings/') {
    return <Navigate to="/settings/page-permissions" replace />;
  }

  const groups = ITEMS.reduce<Record<string, SettingItem[]>>((acc, item) => {
    (acc[item.group] ||= []).push(item);
    return acc;
  }, {});

  return (
    <div style={styles.root}>
      <aside style={styles.sidebar}>
        <div style={styles.title}>設定</div>
        {Object.entries(groups).map(([group, items]) => (
          <div key={group} style={styles.group}>
            <div style={styles.groupLabel}>{group}</div>
            {items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                style={({ isActive }) => ({
                  ...styles.link,
                  ...(isActive ? styles.linkActive : {}),
                })}
              >
                {item.label}
              </NavLink>
            ))}
          </div>
        ))}
      </aside>
      <div style={styles.content}>
        <Outlet />
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  root: {
    display: 'flex',
    gap: 16,
    alignItems: 'flex-start',
    minHeight: '100%',
  },
  sidebar: {
    flexShrink: 0,
    width: 200,
    background: colors.surface,
    border: '1px solid ' + colors.borderLight,
    borderRadius: 6,
    padding: '12px 0',
    position: 'sticky',
    top: 0,
  },
  title: {
    fontSize: 14,
    fontWeight: 600,
    color: colors.text,
    padding: '4px 16px 12px',
    borderBottom: '1px solid ' + colors.borderLight,
    marginBottom: 8,
  },
  group: {
    marginBottom: 8,
  },
  groupLabel: {
    fontSize: 11,
    color: colors.textMuted,
    padding: '6px 16px 4px',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  link: {
    display: 'block',
    padding: '8px 16px',
    fontSize: 13,
    color: colors.text,
    textDecoration: 'none',
    borderLeft: '3px solid transparent',
  },
  linkActive: {
    background: '#eff6ff',
    color: colors.primary,
    borderLeftColor: colors.primary,
    fontWeight: 500,
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
};
