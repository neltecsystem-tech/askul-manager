import { AuthProvider, useAuth } from './lib/AuthContext';
import LoginPage from './pages/LoginPage';
import HomePage from './pages/HomePage';

function Gate() {
  const { session, loading } = useAuth();
  if (loading) return <div style={{ padding: 24 }}>読み込み中...</div>;
  return session ? <HomePage /> : <LoginPage />;
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
