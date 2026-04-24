import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import type { Profile, WorkItem, WorkRecord } from '../types/db';
import PageHeader from '../components/PageHeader';
import { btn, btnPrimary, card, colors, input, th } from '../lib/ui';

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

export default function WorkRecordsPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const now = new Date();

  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [driverId, setDriverId] = useState<string>('');
  const [items, setItems] = useState<WorkItem[]>([]);
  const [drivers, setDrivers] = useState<Profile[]>([]);
  const [records, setRecords] = useState<WorkRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null); // work_date saving
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (profile && !driverId) setDriverId(profile.id);
  }, [profile, driverId]);

  const loadMasters = async () => {
    const [itemsRes, drvRes] = await Promise.all([
      supabase
        .from('work_items')
        .select('*')
        .eq('active', true)
        .order('sort_order')
        .order('name'),
      isAdmin
        ? supabase
            .from('profiles')
            .select('*')
            .eq('active', true)
            .order('full_name')
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (!itemsRes.error && itemsRes.data) setItems(itemsRes.data as WorkItem[]);
    if (!drvRes.error && drvRes.data) setDrivers(drvRes.data as Profile[]);
  };

  const loadMonth = async () => {
    if (!driverId) return;
    setLoading(true);
    setError(null);
    const from = `${year}-${String(month).padStart(2, '0')}-01`;
    const to = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth(year, month)).padStart(2, '0')}`;
    const { data, error } = await supabase
      .from('work_records')
      .select('*')
      .eq('driver_id', driverId)
      .gte('work_date', from)
      .lte('work_date', to);
    if (error) setError(error.message);
    else setRecords((data ?? []) as WorkRecord[]);
    setLoading(false);
  };

  useEffect(() => {
    loadMasters();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  useEffect(() => {
    loadMonth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month, driverId]);

  const days = useMemo(() => {
    const n = daysInMonth(year, month);
    const arr: { date: string; dow: string; isWeekend: boolean }[] = [];
    for (let d = 1; d <= n; d++) {
      const dt = new Date(year, month - 1, d);
      arr.push({
        date: fmtDate(dt),
        dow: ['日', '月', '火', '水', '木', '金', '土'][dt.getDay()],
        isWeekend: dt.getDay() === 0 || dt.getDay() === 6,
      });
    }
    return arr;
  }, [year, month]);

  const itemById = useMemo(() => {
    const m = new Map<string, WorkItem>();
    for (const i of items) m.set(i.id, i);
    return m;
  }, [items]);

  // (date -> Set of item_id)
  const byDate = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const r of records) {
      const s = m.get(r.work_date) ?? new Set<string>();
      s.add(r.work_item_id);
      m.set(r.work_date, s);
    }
    return m;
  }, [records]);

  const recordIdFor = (date: string, itemId: string): string | null => {
    const r = records.find((x) => x.work_date === date && x.work_item_id === itemId);
    return r?.id ?? null;
  };

  const toggle = async (date: string, itemId: string, checked: boolean) => {
    if (!driverId) return;
    setSaving(date);
    setError(null);
    if (checked) {
      const { error } = await supabase.from('work_records').insert({
        work_date: date,
        driver_id: driverId,
        work_item_id: itemId,
      });
      if (error) setError(error.message);
    } else {
      const id = recordIdFor(date, itemId);
      if (id) {
        const { error } = await supabase.from('work_records').delete().eq('id', id);
        if (error) setError(error.message);
      }
    }
    setSaving(null);
    await loadMonth();
  };

  const shiftMonth = (delta: number) => {
    let y = year;
    let m = month + delta;
    if (m < 1) {
      m = 12;
      y--;
    } else if (m > 12) {
      m = 1;
      y++;
    }
    setYear(y);
    setMonth(m);
  };

  // 合計金額
  const totalAmount = useMemo(() => {
    let sum = 0;
    for (const r of records) sum += itemById.get(r.work_item_id)?.amount ?? 0;
    return sum;
  }, [records, itemById]);

  // 日ごとの合計
  const dailyAmount = (date: string): number => {
    const ids = byDate.get(date);
    if (!ids) return 0;
    let sum = 0;
    for (const id of ids) sum += itemById.get(id)?.amount ?? 0;
    return sum;
  };

  return (
    <div>
      <PageHeader
        title="稼働登録"
        actions={
          <button style={btn} onClick={loadMonth} disabled={loading}>
            {loading ? '読込中...' : '再読込'}
          </button>
        }
      />

      {error && (
        <div style={{ color: '#dc2626', marginBottom: 12, whiteSpace: 'pre-wrap' }}>
          {error}
        </div>
      )}

      <div
        style={{
          ...card,
          marginBottom: 12,
          display: 'flex',
          gap: 12,
          alignItems: 'end',
          flexWrap: 'wrap',
        }}
      >
        <button style={btn} onClick={() => shiftMonth(-1)}>
          ← 前月
        </button>
        <label style={lbl}>
          年
          <input
            type="number"
            style={{ ...input, width: 90 }}
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          />
        </label>
        <label style={lbl}>
          月
          <input
            type="number"
            min={1}
            max={12}
            style={{ ...input, width: 70 }}
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
          />
        </label>
        <button style={btn} onClick={() => shiftMonth(1)}>
          次月 →
        </button>
        {isAdmin && (
          <label style={lbl}>
            ドライバー
            <select
              style={{ ...input, minWidth: 180 }}
              value={driverId}
              onChange={(e) => setDriverId(e.target.value)}
            >
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.full_name} {d.id === profile?.id ? '(自分)' : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        <div style={{ fontSize: 12, color: colors.textMuted, marginLeft: 'auto' }}>
          合計: <strong style={{ color: colors.text, fontSize: 14 }}>{totalAmount.toLocaleString()} 円</strong>
          {' / '}登録 {records.length} 件
        </div>
      </div>

      {items.length === 0 ? (
        <div style={{ ...card, color: colors.textMuted }}>
          稼働項目が未登録です。管理者は「稼働項目マスタ」で追加してください。
        </div>
      ) : (
        <div style={{ ...card, overflow: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ ...cellTh, position: 'sticky', left: 0, zIndex: 2, minWidth: 90 }}>
                  日付
                </th>
                {items.map((it) => (
                  <th key={it.id} style={{ ...cellTh, minWidth: 90 }}>
                    <div>{it.name}</div>
                    <div style={{ fontWeight: 400, fontSize: 11 }}>
                      {it.amount.toLocaleString()} 円
                    </div>
                  </th>
                ))}
                <th style={{ ...cellTh, minWidth: 90 }}>日計</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => {
                const isSaving = saving === d.date;
                const sum = dailyAmount(d.date);
                return (
                  <tr key={d.date}>
                    <td
                      style={{
                        ...cellTd,
                        position: 'sticky',
                        left: 0,
                        background: d.isWeekend ? '#fef2f2' : '#f9fafb',
                        fontWeight: 600,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {Number(d.date.slice(8))}日 ({d.dow})
                    </td>
                    {items.map((it) => {
                      const checked = byDate.get(d.date)?.has(it.id) ?? false;
                      return (
                        <td
                          key={it.id}
                          style={{
                            ...cellTd,
                            textAlign: 'center',
                            background: d.isWeekend ? '#fef2f2' : '#fff',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={isSaving}
                            onChange={(e) => toggle(d.date, it.id, e.target.checked)}
                            style={{ cursor: isSaving ? 'wait' : 'pointer', width: 18, height: 18 }}
                          />
                        </td>
                      );
                    })}
                    <td
                      style={{
                        ...cellTd,
                        textAlign: 'right',
                        background: d.isWeekend ? '#fef2f2' : '#fff',
                        fontWeight: sum > 0 ? 600 : 400,
                        color: sum > 0 ? colors.text : colors.textMuted,
                      }}
                    >
                      {sum > 0 ? `${sum.toLocaleString()} 円` : '—'}
                    </td>
                  </tr>
                );
              })}
              <tr>
                <td
                  style={{
                    ...cellTd,
                    position: 'sticky',
                    left: 0,
                    background: '#fff',
                    fontWeight: 700,
                  }}
                >
                  項目別合計
                </td>
                {items.map((it) => {
                  const count = records.filter((r) => r.work_item_id === it.id).length;
                  const sum = count * it.amount;
                  return (
                    <td
                      key={it.id}
                      style={{
                        ...cellTd,
                        textAlign: 'center',
                        fontWeight: count > 0 ? 600 : 400,
                        color: count > 0 ? colors.text : colors.textMuted,
                      }}
                    >
                      {count > 0 ? `${count}回 / ${sum.toLocaleString()}円` : '—'}
                    </td>
                  );
                })}
                <td style={{ ...cellTd, textAlign: 'right', fontWeight: 700 }}>
                  {totalAmount.toLocaleString()} 円
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const lbl = { display: 'flex', flexDirection: 'column' as const, gap: 4, fontSize: 12 };
const cellTh = {
  ...th,
  fontSize: 11,
  padding: '4px 6px',
  border: '1px solid #d1d5db',
  background: '#f3f4f6',
  textAlign: 'center' as const,
};
const cellTd = {
  border: '1px solid #e5e7eb',
  padding: '4px 6px',
  whiteSpace: 'nowrap' as const,
};

// unused suppression
void btnPrimary;
