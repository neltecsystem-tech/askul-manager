import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import PageHeader from '../components/PageHeader';
import { btnPrimary, card, input, table, td, th, colors } from '../lib/ui';

interface DeliveryRow {
  row_index: number;
  work_date: string; // YYYY-MM-DD
  shipper_code: string;
  shipper_name: string;
  size_code: string;
  quantity: number;
  amount: number;
}

// 締めサイクル: 前月21日〜当月20日 を「その月度」とする (ClosingPage と同じ基準)
// 例: 4/21〜5/20 → 5月度
const billingMonth = (dateStr: string): string => {
  const [y, m, d] = (dateStr || '').split('-').map(Number);
  if (!y || !m || !d) return '';
  let year = y;
  let month = m;
  if (d >= 21) {
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return `${year}-${String(month).padStart(2, '0')}`;
};
const ymLabel = (s: string) => {
  const [y, m] = s.split('-').map(Number);
  if (!y || !m) return s;
  return `${y}年${m}月度`;
};

export default function MonthlyVolumePage() {
  const { profile } = useAuth();
  // 法人配下ドライバー (オーナー以外) は金額を表示しない
  const hideMoney = profile?.business_type === 'corporation';

  const [records, setRecords] = useState<DeliveryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const [shipperFilter, setShipperFilter] = useState('');

  const load = async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase.functions.invoke('fetch-delivery-records', { body: {} });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    if (data?.error) {
      setError(data.error);
      setLoading(false);
      return;
    }
    setRecords((data?.records ?? []) as DeliveryRow[]);
    setFetchedAt(new Date());
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const shippers = useMemo(() => {
    const set = new Set(records.map((r) => r.shipper_name).filter(Boolean));
    return Array.from(set).sort();
  }, [records]);

  const filtered = useMemo(
    () => (shipperFilter ? records.filter((r) => r.shipper_name === shipperFilter) : records),
    [records, shipperFilter],
  );

  // 月次サマリー (新しい月が上)
  const monthly = useMemo(() => {
    const map = new Map<string, { qty: number; count: number; amount: number }>();
    for (const r of filtered) {
      const key = billingMonth(r.work_date);
      if (!key) continue;
      const a = map.get(key) ?? { qty: 0, count: 0, amount: 0 };
      a.qty += r.quantity || 0;
      a.count += 1;
      a.amount += r.amount || 0;
      map.set(key, a);
    }
    return Array.from(map.entries())
      .map(([month, v]) => ({ month, ...v }))
      .sort((a, b) => b.month.localeCompare(a.month));
  }, [filtered]);

  const grand = useMemo(
    () =>
      monthly.reduce(
        (s, m) => ({ qty: s.qty + m.qty, count: s.count + m.count, amount: s.amount + m.amount }),
        { qty: 0, count: 0, amount: 0 },
      ),
    [monthly],
  );

  // 荷主別 × 月 の個数マトリクス (列=荷主, 行=月)
  const matrix = useMemo(() => {
    const map = new Map<string, Map<string, number>>(); // month -> shipper -> qty
    for (const r of filtered) {
      const key = billingMonth(r.work_date);
      if (!key) continue;
      const row = map.get(key) ?? new Map<string, number>();
      row.set(r.shipper_name || '(不明)', (row.get(r.shipper_name || '(不明)') ?? 0) + (r.quantity || 0));
      map.set(key, row);
    }
    return Array.from(map.entries())
      .map(([month, row]) => ({ month, row }))
      .sort((a, b) => b.month.localeCompare(a.month));
  }, [filtered]);

  const matrixShippers = useMemo(() => {
    // フィルタ中は1荷主のみ。総量の多い順に列を並べる
    const totals = new Map<string, number>();
    for (const r of filtered) {
      const name = r.shipper_name || '(不明)';
      totals.set(name, (totals.get(name) ?? 0) + (r.quantity || 0));
    }
    return Array.from(totals.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name);
  }, [filtered]);

  return (
    <div>
      <PageHeader
        title="各月の取扱個数"
        actions={
          <button style={btnPrimary} onClick={load} disabled={loading}>
            {loading ? '読み込み中...' : '再読み込み'}
          </button>
        }
      />

      {fetchedAt && (
        <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 8 }}>
          データ参照元: Google Sheets「DETA貼り付け」/ 取得時刻: {fetchedAt.toLocaleString()}
        </div>
      )}

      {error && (
        <div style={{ color: '#dc2626', marginBottom: 12, whiteSpace: 'pre-wrap' }}>{error}</div>
      )}

      <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 12 }}>
        ※ 各月度 = <strong>前月21日〜当月20日</strong>（締めサイクル）。例: 5月度 = 4/21〜5/20
      </div>

      <div style={{ ...card, marginBottom: 16, display: 'flex', gap: 16, alignItems: 'end', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: colors.textMuted }}>
          荷主で絞り込み
          <select style={input} value={shipperFilter} onChange={(e) => setShipperFilter(e.target.value)}>
            <option value="">すべての荷主</option>
            {shippers.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <Stat label="対象月数" value={monthly.length.toLocaleString()} />
        <Stat label="取扱個数 合計" value={grand.qty.toLocaleString()} />
        <Stat label="件数 合計" value={grand.count.toLocaleString()} />
        {!hideMoney && <Stat label="金額 合計" value={`¥${grand.amount.toLocaleString()}`} />}
      </div>

      {/* 月次サマリー */}
      <div style={{ ...card, marginBottom: 16 }}>
        <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>月次サマリー</h3>
        {loading ? (
          <div>読み込み中...</div>
        ) : monthly.length === 0 ? (
          <div style={{ color: '#6b7280' }}>該当データがありません。</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={table}>
              <thead>
                <tr>
                  <th style={th}>月</th>
                  <th style={{ ...th, textAlign: 'right' }}>取扱個数</th>
                  <th style={{ ...th, textAlign: 'right' }}>件数</th>
                  {!hideMoney && <th style={{ ...th, textAlign: 'right' }}>金額</th>}
                </tr>
              </thead>
              <tbody>
                {monthly.map((m) => (
                  <tr key={m.month}>
                    <td style={td}>{ymLabel(m.month)}</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{m.qty.toLocaleString()}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{m.count.toLocaleString()}</td>
                    {!hideMoney && (
                      <td style={{ ...td, textAlign: 'right' }}>¥{m.amount.toLocaleString()}</td>
                    )}
                  </tr>
                ))}
                <tr>
                  <td style={{ ...td, fontWeight: 700 }}>合計</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{grand.qty.toLocaleString()}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{grand.count.toLocaleString()}</td>
                  {!hideMoney && (
                    <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>¥{grand.amount.toLocaleString()}</td>
                  )}
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 荷主別 月次個数 */}
      {!loading && matrix.length > 0 && matrixShippers.length > 1 && (
        <div style={card}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>荷主別 月次個数</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={table}>
              <thead>
                <tr>
                  <th style={th}>月</th>
                  {matrixShippers.map((s) => (
                    <th key={s} style={{ ...th, textAlign: 'right' }}>
                      {s}
                    </th>
                  ))}
                  <th style={{ ...th, textAlign: 'right' }}>計</th>
                </tr>
              </thead>
              <tbody>
                {matrix.map(({ month, row }) => {
                  const rowTotal = matrixShippers.reduce((s, name) => s + (row.get(name) ?? 0), 0);
                  return (
                    <tr key={month}>
                      <td style={td}>{ymLabel(month)}</td>
                      {matrixShippers.map((s) => (
                        <td key={s} style={{ ...td, textAlign: 'right' }}>
                          {(row.get(s) ?? 0).toLocaleString()}
                        </td>
                      ))}
                      <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>
                        {rowTotal.toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
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
