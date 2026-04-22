import { useAuth } from '../lib/AuthContext';

export default function HomePage() {
  const { profile, signOut } = useAuth();
  return (
    <div style={{ padding: 24 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: 18, margin: 0 }}>アスクル管理ツール</h1>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span style={{ fontSize: 13 }}>
            {profile?.full_name ?? '(未登録)'} / {profile?.role === 'admin' ? '管理者' : 'ドライバー'}
          </span>
          <button onClick={signOut}>ログアウト</button>
        </div>
      </header>
      <main style={{ marginTop: 24 }}>
        <p>ログインに成功しました。ここにダッシュボードを作っていきます。</p>
      </main>
    </div>
  );
}
