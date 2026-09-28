import { useEffect, useState } from 'react';
import PageHeader from '../../components/PageHeader';
import { supabase } from '../../lib/supabase';
import { btn, card, colors } from '../../lib/ui';

// 🚨 立替金精算書のファイルIDはコードに書かない。
//    このリポジトリは PUBLIC で、 ビルド済みJSも誰でも取得できるため、
//    IDを書くと「リンクを知っている全員が編集可」のファイルを公開するのと同じになる。
//    ログイン後に app_settings(key='expense_sheet') から読む。
interface ExpenseSheet { fileId: string; gid: string }

export default function ExpensesPage() {
  const [sheet, setSheet] = useState<ExpenseSheet | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'expense_sheet')
      .maybeSingle()
      .then(({ data, error: err }) => {
        if (err) setError(err.message);
        else if (data?.value) setSheet(data.value as ExpenseSheet);
        else setError('立替金精算書の場所が設定されていません (app_settings: expense_sheet)');
      });
  }, []);

  const embedUrl = sheet
    ? `https://docs.google.com/spreadsheets/d/${sheet.fileId}/edit?usp=sharing&rm=embedded&gid=${sheet.gid}#gid=${sheet.gid}`
    : '';
  const openUrl = sheet
    ? `https://docs.google.com/spreadsheets/d/${sheet.fileId}/edit?gid=${sheet.gid}#gid=${sheet.gid}`
    : '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 90px)' }}>
      <PageHeader
        title="立替金精算書"
        actions={
          sheet ? (
            <a
              href={openUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ ...btn, textDecoration: 'none' }}
            >
              新しいタブで開く ↗
            </a>
          ) : null
        }
      />
      <div style={{ ...card, padding: 12, marginBottom: 12, fontSize: 12, color: colors.textMuted }}>
        Googleスプレッドシートを直接埋め込んでいます。編集するには Google にログインし、シートへの編集権限が必要です。
        保存はスプレッドシート側で自動的に行われます。
      </div>
      {error && (
        <div style={{ ...card, padding: 12, marginBottom: 12, fontSize: 13, color: '#b91c1c' }}>
          立替金精算書を開けませんでした: {error}
        </div>
      )}
      <div style={{ flex: 1, border: '1px solid ' + colors.borderLight, borderRadius: 6, overflow: 'hidden', background: '#fff' }}>
        {sheet ? (
          <iframe
            title="立替金精算書"
            src={embedUrl}
            style={{ width: '100%', height: '100%', border: 'none' }}
            allowFullScreen
          />
        ) : (
          <div style={{ padding: 16, fontSize: 13, color: colors.textMuted }}>
            {error ? '' : '読み込み中…'}
          </div>
        )}
      </div>
    </div>
  );
}
