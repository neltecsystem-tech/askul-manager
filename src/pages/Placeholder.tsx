import { card } from '../lib/ui';

export default function Placeholder({ title }: { title: string }) {
  return (
    <div>
      <h1 style={{ fontSize: 18, margin: '0 0 16px' }}>{title}</h1>
      <div style={card}>
        <p style={{ margin: 0, color: '#6b7280' }}>この画面は次のステップで実装します。</p>
      </div>
    </div>
  );
}
