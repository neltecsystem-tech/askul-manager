import PageHeader from '../../components/PageHeader';
import { btn, card, colors } from '../../lib/ui';

const SHEET_ID = '1q_SnkywY-JXtx36Dvb9BQs1v-FBUR84H';
const GID = '261851561';
const EMBED_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit?usp=sharing&rm=embedded&gid=${GID}#gid=${GID}`;
const OPEN_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit?gid=${GID}#gid=${GID}`;

export default function ExpensesPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 90px)' }}>
      <PageHeader
        title="立替金精算書"
        actions={
          <a
            href={OPEN_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{ ...btn, textDecoration: 'none' }}
          >
            新しいタブで開く ↗
          </a>
        }
      />
      <div style={{ ...card, padding: 12, marginBottom: 12, fontSize: 12, color: colors.textMuted }}>
        Googleスプレッドシートを直接埋め込んでいます。編集するには Google にログインし、シートへの編集権限が必要です。
        保存はスプレッドシート側で自動的に行われます。
      </div>
      <div style={{ flex: 1, border: '1px solid ' + colors.borderLight, borderRadius: 6, overflow: 'hidden', background: '#fff' }}>
        <iframe
          title="立替金精算書"
          src={EMBED_URL}
          style={{ width: '100%', height: '100%', border: 'none' }}
          allowFullScreen
        />
      </div>
    </div>
  );
}
