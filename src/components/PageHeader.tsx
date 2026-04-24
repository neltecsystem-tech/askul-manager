import type { ReactNode } from 'react';

export default function PageHeader({
  title,
  actions,
}: {
  title: string;
  actions?: ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 16,
      }}
    >
      <h1 style={{ fontSize: 18, margin: 0 }}>{title}</h1>
      <div style={{ display: 'flex', gap: 8 }}>{actions}</div>
    </div>
  );
}
