import type { CSSProperties } from 'react';

export const colors = {
  bg: '#f4f5f7',
  surface: '#ffffff',
  border: '#d1d5db',
  borderLight: '#e5e7eb',
  text: '#1f2937',
  textMuted: '#6b7280',
  primary: '#2563eb',
  primaryDark: '#1d4ed8',
  danger: '#dc2626',
  success: '#16a34a',
  sidebar: '#1e293b',
  sidebarActive: '#334155',
  sidebarText: '#cbd5e1',
  sidebarTextActive: '#ffffff',
};

export const btn: CSSProperties = {
  padding: '6px 12px',
  border: '1px solid ' + colors.border,
  borderRadius: 4,
  background: colors.surface,
  color: colors.text,
  cursor: 'pointer',
  fontSize: 13,
};

export const btnPrimary: CSSProperties = {
  ...btn,
  background: colors.primary,
  color: '#fff',
  borderColor: colors.primary,
};

export const btnDanger: CSSProperties = {
  ...btn,
  background: colors.danger,
  color: '#fff',
  borderColor: colors.danger,
};

export const input: CSSProperties = {
  padding: '6px 10px',
  border: '1px solid ' + colors.border,
  borderRadius: 4,
  fontSize: 13,
  background: '#fff',
  color: colors.text,
};

export const card: CSSProperties = {
  background: colors.surface,
  border: '1px solid ' + colors.borderLight,
  borderRadius: 6,
  padding: 16,
};

export const table: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 13,
};

export const th: CSSProperties = {
  textAlign: 'left',
  padding: '8px 10px',
  borderBottom: '2px solid ' + colors.border,
  background: '#f9fafb',
  fontWeight: 600,
  whiteSpace: 'nowrap',
};

export const td: CSSProperties = {
  padding: '8px 10px',
  borderBottom: '1px solid ' + colors.borderLight,
  verticalAlign: 'middle',
};
