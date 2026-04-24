import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import { btn, btnPrimary, card, colors, input } from '../lib/ui';

export default function ChangePasswordPage() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const forced = profile?.must_change_password === true;

  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    if (pw1.length < 6) {
      setError('パスワードは6文字以上にしてください');
      return;
    }
    if (pw1 !== pw2) {
      setError('確認用と一致しません');
      return;
    }
    if (!profile) {
      setError('ユーザー情報が取得できません。再ログインしてください。');
      return;
    }
    setSaving(true);
    const { error: authErr } = await supabase.auth.updateUser({ password: pw1 });
    if (authErr) {
      setSaving(false);
      setError('パスワード更新失敗: ' + authErr.message);
      return;
    }
    const { error: profileErr } = await supabase
      .from('profiles')
      .update({ must_change_password: false })
      .eq('id', profile.id);
    setSaving(false);
    if (profileErr) {
      setError('フラグ更新失敗: ' + profileErr.message);
      return;
    }
    alert('パスワードを変更しました。再ログインしてください。');
    await signOut();
    navigate('/login');
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: colors.bg,
        padding: 20,
      }}
    >
      <div style={{ ...card, width: 400, maxWidth: '100%' }}>
        <h1 style={{ fontSize: 18, margin: '0 0 12px' }}>
          {forced ? '初回パスワード変更' : 'パスワード変更'}
        </h1>
        {forced && (
          <div
            style={{
              background: '#fff7ed',
              border: '1px solid #fed7aa',
              borderRadius: 4,
              padding: 10,
              fontSize: 12,
              color: '#9a3412',
              marginBottom: 12,
            }}
          >
            初期パスワードのままです。セキュリティのため、お好みのパスワードに変更してから他の機能をご利用ください。
          </div>
        )}
        <div style={{ fontSize: 13, color: colors.textMuted, marginBottom: 12 }}>
          ログイン中: {profile?.full_name}
        </div>
        {error && (
          <div style={{ color: '#dc2626', marginBottom: 12, fontSize: 13 }}>{error}</div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label style={lbl}>
            新しいパスワード (6文字以上)
            <input
              type="password"
              style={input}
              value={pw1}
              onChange={(e) => setPw1(e.target.value)}
              autoFocus
            />
          </label>
          <label style={lbl}>
            確認用
            <input
              type="password"
              style={input}
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') save();
              }}
            />
          </label>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 16 }}>
          {!forced ? (
            <button style={btn} onClick={() => navigate(-1)} disabled={saving}>
              キャンセル
            </button>
          ) : (
            <button style={btn} onClick={signOut} disabled={saving}>
              ログアウト
            </button>
          )}
          <button style={btnPrimary} onClick={save} disabled={saving || !pw1 || !pw2}>
            {saving ? '変更中...' : '変更する'}
          </button>
        </div>
      </div>
    </div>
  );
}

const lbl = { display: 'flex', flexDirection: 'column' as const, gap: 4, fontSize: 12 };
