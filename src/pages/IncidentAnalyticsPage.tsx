import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { supabase } from '../lib/supabase';
import type { Incident, IncidentStatus, Profile } from '../types/db';
import { incidentStatusLabels } from '../types/db';
import PageHeader from '../components/PageHeader';
import { card, colors } from '../lib/ui';

const STATUS_COLORS: Record<IncidentStatus, string> = {
  pending_driver: '#f59e0b',
  pending_review: '#3b82f6',
  approved: '#16a34a',
};

const PALETTE = [
  '#2563eb',
  '#16a34a',
  '#f59e0b',
  '#dc2626',
  '#7c3aed',
  '#0891b2',
  '#db2777',
  '#65a30d',
  '#ea580c',
  '#475569',
];

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-');
  return `${y.slice(2)}/${m}`;
}

export default function IncidentAnalyticsPage() {
  const [rows, setRows] = useState<Incident[]>([]);
  const [drivers, setDrivers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState<string>('all');

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [incRes, drvRes] = await Promise.all([
        supabase.from('incidents').select('*'),
        supabase.from('profiles').select('id, full_name'),
      ]);
      setRows((incRes.data ?? []) as Incident[]);
      setDrivers((drvRes.data ?? []) as Profile[]);
      setLoading(false);
    })();
  }, []);

  const driverNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of drivers) m.set(d.id, d.full_name);
    return m;
  }, [drivers]);

  const whoOf = (r: Incident): string =>
    r.target_driver_id
      ? driverNameById.get(r.target_driver_id) ?? '(削除済)'
      : r.reporter_name?.trim() || '未設定';

  // 年フィルタ候補
  const years = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) if (r.occurred_at) s.add(r.occurred_at.slice(0, 4));
    return Array.from(s).sort().reverse();
  }, [rows]);

  const filtered = useMemo(() => {
    if (year === 'all') return rows;
    return rows.filter((r) => r.occurred_at?.startsWith(year));
  }, [rows, year]);

  const stats = useMemo(() => {
    const byStatus: Record<IncidentStatus, number> = {
      pending_driver: 0,
      pending_review: 0,
      approved: 0,
    };
    const byMonth = new Map<string, number>();
    const byCategory = new Map<string, number>();
    const byDriver = new Map<string, number>();
    let unknownDate = 0;

    for (const r of filtered) {
      byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
      if (r.occurred_at) {
        const ym = r.occurred_at.slice(0, 7);
        byMonth.set(ym, (byMonth.get(ym) ?? 0) + 1);
      } else {
        unknownDate++;
      }
      const cat = r.category?.trim() || '未分類';
      byCategory.set(cat, (byCategory.get(cat) ?? 0) + 1);
      const who = whoOf(r);
      byDriver.set(who, (byDriver.get(who) ?? 0) + 1);
    }

    const months = Array.from(byMonth.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    const categories = Array.from(byCategory.entries()).sort((a, b) => b[1] - a[1]);
    const driversRanked = Array.from(byDriver.entries()).sort((a, b) => b[1] - a[1]);

    return {
      total: filtered.length,
      byStatus,
      months,
      categories,
      driversRanked,
      unknownDate,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, driverNameById]);

  const maxMonth = Math.max(1, ...stats.months.map(([, c]) => c));

  return (
    <div>
      <PageHeader
        title="不具合分析"
        actions={
          <select
            value={year}
            onChange={(e) => setYear(e.target.value)}
            style={{
              padding: '6px 10px',
              border: `1px solid ${colors.border}`,
              borderRadius: 4,
              fontSize: 13,
              background: '#fff',
            }}
          >
            <option value="all">全期間</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}年
              </option>
            ))}
          </select>
        }
      />

      {loading ? (
        <div style={{ ...card, color: colors.textMuted }}>読み込み中...</div>
      ) : stats.total === 0 ? (
        <div style={{ ...card, color: colors.textMuted }}>対象の不具合データがありません。</div>
      ) : (
        <>
          {/* サマリーカード */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            <SummaryCard label="総件数" value={stats.total} color={colors.text} />
            <SummaryCard
              label={incidentStatusLabels.pending_driver}
              value={stats.byStatus.pending_driver}
              color={STATUS_COLORS.pending_driver}
            />
            <SummaryCard
              label={incidentStatusLabels.pending_review}
              value={stats.byStatus.pending_review}
              color={STATUS_COLORS.pending_review}
            />
            <SummaryCard
              label={incidentStatusLabels.approved}
              value={stats.byStatus.approved}
              color={STATUS_COLORS.approved}
            />
          </div>

          {/* 月別推移 */}
          <div style={{ ...card, marginBottom: 16 }}>
            <h3 style={chartTitle}>月別 発生件数</h3>
            {stats.months.length === 0 ? (
              <div style={{ color: colors.textMuted, fontSize: 12 }}>日付ありのデータがありません。</div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 180, paddingTop: 12, overflowX: 'auto' }}>
                {stats.months.map(([ym, count]) => (
                  <div
                    key={ym}
                    style={{ flex: '1 0 36px', display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 36 }}
                  >
                    <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 2 }}>{count}</div>
                    <div
                      title={`${ym}: ${count}件`}
                      style={{
                        width: '70%',
                        height: `${(count / maxMonth) * 130}px`,
                        minHeight: 2,
                        background: colors.primary,
                        borderRadius: '3px 3px 0 0',
                      }}
                    />
                    <div style={{ fontSize: 10, color: colors.textMuted, marginTop: 4, whiteSpace: 'nowrap' }}>
                      {monthLabel(ym)}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {stats.unknownDate > 0 && (
              <div style={{ fontSize: 11, color: '#b45309', marginTop: 8 }}>
                ※ 発生日不明 {stats.unknownDate} 件はグラフ対象外
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {/* 区分別 */}
            <div style={{ ...card, flex: '1 1 360px', minWidth: 300 }}>
              <h3 style={chartTitle}>区分別</h3>
              <BarList
                items={stats.categories}
                total={stats.total}
                colorFor={(i) => PALETTE[i % PALETTE.length]}
              />
            </div>

            {/* 該当者別 */}
            <div style={{ ...card, flex: '1 1 360px', minWidth: 300 }}>
              <h3 style={chartTitle}>該当者別</h3>
              <BarList
                items={stats.driversRanked}
                total={stats.total}
                colorFor={() => colors.primary}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div
      style={{
        ...card,
        flex: '1 1 140px',
        minWidth: 120,
        padding: 14,
        borderLeft: `4px solid ${color}`,
      }}
    >
      <div style={{ fontSize: 12, color: colors.textMuted }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

function BarList({
  items,
  total,
  colorFor,
}: {
  items: [string, number][];
  total: number;
  colorFor: (index: number) => string;
}) {
  const max = Math.max(1, ...items.map(([, c]) => c));
  if (items.length === 0) {
    return <div style={{ color: colors.textMuted, fontSize: 12 }}>データなし</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map(([label, count], i) => {
        const pct = total ? Math.round((count / total) * 100) : 0;
        return (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div
              style={{
                width: 110,
                fontSize: 12,
                textAlign: 'right',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={label}
            >
              {label}
            </div>
            <div style={{ flex: 1, background: '#f1f5f9', borderRadius: 4, height: 20, position: 'relative' }}>
              <div
                style={{
                  width: `${(count / max) * 100}%`,
                  minWidth: 2,
                  height: '100%',
                  background: colorFor(i),
                  borderRadius: 4,
                }}
              />
            </div>
            <div style={{ width: 70, fontSize: 12, textAlign: 'right', whiteSpace: 'nowrap' }}>
              {count}
              <span style={{ color: colors.textMuted, fontSize: 11 }}> ({pct}%)</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const chartTitle: CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  margin: '0 0 12px',
  color: colors.text,
};
