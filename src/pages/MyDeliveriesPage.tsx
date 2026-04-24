import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import PageHeader from '../components/PageHeader';
import { btn, btnPrimary, card, colors, input, table, td, th } from '../lib/ui';

interface DeliveryRow {
  row_index: number;
  driver_code: string;
  driver_name: string;
  work_date: string;
  product_code: string;
  product_name: string;
  shipper_code: string;
  shipper_name: string;
  size_code: string;
  quantity: number;
  unit_price: number;
  amount: number;
}

function defaultCycle(): { from: string; to: string } {
  // 前月21日〜当月20日
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - 1, 21);
  const to = new Date(now.getFullYear(), now.getMonth(), 20);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { from: fmt(from), to: fmt(to) };
}

export default function MyDeliveriesPage() {
  const { profile } = useAuth();
  const hideAmount = profile?.business_type === 'corporation';
  const isOwner = profile?.business_type === 'corporation_owner';
  const init = defaultCycle();
  const [records, setRecords] = useState<DeliveryRow[]>([]);
  const [companyMembers, setCompanyMembers] = useState<string[]>([]); // 法人オーナー用: 同社メンバー氏名
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const [dateFrom, setDateFrom] = useState(init.from);
  const [dateTo, setDateTo] = useState(init.to);
  const [shipperQuery, setShipperQuery] = useState('');
  const [sizeQuery, setSizeQuery] = useState('');
  const [driverFilter, setDriverFilter] = useState<string>(''); // オーナー閲覧時のメンバー絞込

  const load = async () => {
    setLoading(true);
    setError(null);
    const session = (await supabase.auth.getSession()).data.session;
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fetch-delivery-records`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session?.access_token ?? ''}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(`HTTP ${res.status}: ${data.error ?? '不明なエラー'}`);
        setLoading(false);
        return;
      }
      const normalize = (s: string) =>
        (s ?? '').replace(/\u3000/g, ' ').replace(/\s+/g, ' ').trim();
      const all = (data.records ?? []) as DeliveryRow[];
      const myName = normalize(profile?.full_name ?? '');
      if (!myName) {
        setRecords([]);
        setError('プロフィール氏名が未設定のため実績を絞り込めません');
        setFetchedAt(new Date());
        return;
      }

      // 法人オーナーなら同じ company_name の全メンバーの実績を対象
      let allowedNames = new Set<string>([myName]);
      if (profile?.business_type === 'corporation_owner' && profile?.company_name) {
        const { data: members } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('company_name', profile.company_name)
          .eq('active', true);
        const names = (members ?? []).map((m) => normalize(m.full_name));
        setCompanyMembers(names.sort());
        allowedNames = new Set(names);
      } else {
        setCompanyMembers([]);
      }

      setRecords(all.filter((r) => allowedNames.has(normalize(r.driver_name))));
      setFetchedAt(new Date());
    } catch (err) {
      setError('通信エラー: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (profile) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  const filtered = useMemo(() => {
    const norm = (s: string) => (s ?? '').replace(/\u3000/g, ' ').replace(/\s+/g, ' ').trim();
    return records.filter((r) => {
      if (dateFrom && r.work_date < dateFrom) return false;
      if (dateTo && r.work_date > dateTo) return false;
      if (shipperQuery && !r.shipper_name.includes(shipperQuery) && !r.shipper_code.includes(shipperQuery))
        return false;
      if (sizeQuery && r.size_code !== sizeQuery) return false;
      if (driverFilter && norm(r.driver_name) !== driverFilter) return false;
      return true;
    });
  }, [records, dateFrom, dateTo, shipperQuery, sizeQuery, driverFilter]);

  const totals = useMemo(() => {
    const qty = filtered.reduce((s, r) => s + (r.quantity || 0), 0);
    const amount = filtered.reduce((s, r) => s + (r.amount || 0), 0);
    const days = new Set(filtered.map((r) => r.work_date)).size;
    return { qty, amount, days, count: filtered.length };
  }, [filtered]);

  const uniqueSizes = useMemo(() => {
    const set = new Set(records.map((r) => r.size_code).filter(Boolean));
    return Array.from(set).sort();
  }, [records]);

  const setPresetCycle = (offset: number) => {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth() + offset - 1, 21);
    const to = new Date(now.getFullYear(), now.getMonth() + offset, 20);
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    setDateFrom(fmt(from));
    setDateTo(fmt(to));
  };

  return (
    <div>
      <PageHeader
        title="自分の配送実績"
        actions={
          <button style={btnPrimary} onClick={load} disabled={loading}>
            {loading ? '読み込み中...' : '再読み込み'}
          </button>
        }
      />
      <div
        style={{
          ...card,
          padding: 10,
          marginBottom: 12,
          fontSize: 12,
          color: colors.textMuted,
          background: '#eff6ff',
          borderColor: '#93c5fd',
        }}
      >
        {isOwner && profile?.company_name ? (
          <>
            法人オーナー <strong style={{ color: '#1e40af' }}>{profile?.full_name}</strong> / 所属会社{' '}
            <strong style={{ color: '#1e40af' }}>{profile.company_name}</strong>（
            {companyMembers.length}名）の実績を表示中（{records.length}件）
          </>
        ) : (
          <>
            ログインユーザー <strong style={{ color: '#1e40af' }}>{profile?.full_name ?? '(未設定)'}</strong>{' '}
            さんの実績のみ表示中（{records.length}件）
          </>
        )}
        {fetchedAt && ` / 取得時刻: ${fetchedAt.toLocaleString()}`}
      </div>

      {error && (
        <div style={{ color: '#dc2626', marginBottom: 12, whiteSpace: 'pre-wrap' }}>{error}</div>
      )}

      <div style={{ ...card, marginBottom: 16 }}>
        <div style={filterGrid}>
          <label style={labelStyle}>
            開始日
            <input
              type="date"
              style={input}
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </label>
          <label style={labelStyle}>
            終了日
            <input
              type="date"
              style={input}
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </label>
          {isOwner && companyMembers.length > 0 && (
            <label style={labelStyle}>
              メンバー
              <select
                style={input}
                value={driverFilter}
                onChange={(e) => setDriverFilter(e.target.value)}
              >
                <option value="">全員</option>
                {companyMembers.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label style={labelStyle}>
            荷主（名称/コード）
            <input
              style={input}
              value={shipperQuery}
              onChange={(e) => setShipperQuery(e.target.value)}
              placeholder="例: アスクル"
            />
          </label>
          <label style={labelStyle}>
            サイズ
            <select style={input} value={sizeQuery} onChange={(e) => setSizeQuery(e.target.value)}>
              <option value="">すべて</option>
              {uniqueSizes.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <div style={{ display: 'flex', gap: 4, alignItems: 'end' }}>
            <button style={btn} onClick={() => setPresetCycle(-1)}>
              先月締め
            </button>
            <button style={btn} onClick={() => setPresetCycle(0)}>
              今月締め
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'end' }}>
            <button
              style={btn}
              onClick={() => {
                setDateFrom('');
                setDateTo('');
                setShipperQuery('');
                setSizeQuery('');
              }}
            >
              クリア
            </button>
          </div>
        </div>
      </div>

      <div style={{ ...card, marginBottom: 16, display: 'flex', gap: 32, flexWrap: 'wrap' }}>
        <Stat label="稼働日数" value={`${totals.days}日`} />
        <Stat label="件数" value={totals.count.toLocaleString()} />
        <Stat label="数量合計" value={totals.qty.toLocaleString()} />
        {!hideAmount && (
          <Stat label="金額合計(税抜)" value={`¥${totals.amount.toLocaleString()}`} />
        )}
      </div>

      <div style={card}>
        {loading ? (
          <div>読み込み中...</div>
        ) : filtered.length === 0 ? (
          <div style={{ color: '#6b7280' }}>該当データがありません。</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={table}>
              <thead>
                <tr>
                  <th style={th}>計上日</th>
                  {isOwner && <th style={th}>ドライバー</th>}
                  <th style={th}>商品</th>
                  <th style={th}>荷主</th>
                  <th style={{ ...th, textAlign: 'right' }}>サイズ</th>
                  <th style={{ ...th, textAlign: 'right' }}>数量</th>
                  {!hideAmount && <th style={{ ...th, textAlign: 'right' }}>単価</th>}
                  {!hideAmount && <th style={{ ...th, textAlign: 'right' }}>金額</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.row_index}>
                    <td style={td}>{r.work_date}</td>
                    {isOwner && <td style={td}>{r.driver_name}</td>}
                    <td style={td}>{r.product_name}</td>
                    <td style={td}>
                      {r.shipper_name}
                      <div style={{ fontSize: 11, color: '#6b7280' }}>{r.shipper_code}</div>
                    </td>
                    <td style={{ ...td, textAlign: 'right' }}>{r.size_code}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{r.quantity.toLocaleString()}</td>
                    {!hideAmount && (
                      <td style={{ ...td, textAlign: 'right' }}>¥{r.unit_price.toLocaleString()}</td>
                    )}
                    {!hideAmount && (
                      <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>
                        ¥{r.amount.toLocaleString()}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: '#6b7280' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 600, marginTop: 2 }}>{value}</div>
    </div>
  );
}

const labelStyle = { display: 'flex', flexDirection: 'column' as const, gap: 4, fontSize: 12 };
const filterGrid = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
  gap: 12,
};
