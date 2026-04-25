import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import PageHeader from '../../components/PageHeader';
import { btn, btnPrimary, card, colors, input, table, td, th } from '../../lib/ui';
import type { DriverDeductionRate, Office, Profile } from '../../types/db';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

interface DeliveryRow {
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

interface FormResponse {
  timestamp: string;
  date_raw: string;
  work_date: string; // YYYY-MM-DD
  driver_name: string;
  type: string; // 車建 | 車建OR個建 | 個建+ | etc
  amount: number;
  reason: string;
  entered_by: string;
}

interface VehicleDay {
  month: number;
  day: number;
  amount: number;
}

// "YYYY-MM-DD" -> "MM-DD"
function mdKey(workDate: string): string {
  return workDate.slice(5);
}
function vdKey(v: VehicleDay): string {
  return `${String(v.month).padStart(2, '0')}-${String(v.day).padStart(2, '0')}`;
}

// 種別→(車建/個建)振り分け
function formAdjustment(type: string): 'vehicle' | 'kodate' {
  if (type.includes('個建')) return 'kodate';
  return 'vehicle';
}

interface DriverAggregate {
  driver_code: string;
  driver_name: string;
  driver_id: string | null;
  deduction_rate: number;
  deduction_amount: number;
  days: Set<string>;
  count: number;
  quantity: number;
  revenue: number;
  form_vehicle: number; // フォーム車建合計
  form_kodate: number; // フォーム個建+ 合計
  master_vehicle: number; // マスタ車建日による合計 (控除対象外)
  vehicle_day_dates: Set<string>; // 車建日として処理した work_date
  vehicle_day_amounts: Map<string, number>; // work_date -> 車建単価
  rows: DeliveryRow[];
  formRows: FormResponse[];
}

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 締めサイクル = 前月21日〜当月20日
// offset=0 → 今月締め(前月21〜当月20)
// offset=-1 → 先月締め(前々月21〜前月20)
function cyclePeriod(offset = 0): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() + offset - 1, 21);
  const to = new Date(now.getFullYear(), now.getMonth() + offset, 20);
  return { from: fmtDate(from), to: fmtDate(to) };
}

function defaultPeriod(): { from: string; to: string } {
  return cyclePeriod(0);
}

export default function ClosingPage() {
  const init = defaultPeriod();
  const [dateFrom, setDateFrom] = useState(init.from);
  const [dateTo, setDateTo] = useState(init.to);
  const [records, setRecords] = useState<DeliveryRow[]>([]);
  const [formResponses, setFormResponses] = useState<FormResponse[]>([]);
  const [vehicleDays, setVehicleDays] = useState<VehicleDay[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [offices, setOffices] = useState<Office[]>([]);
  const [rateHistory, setRateHistory] = useState<DriverDeductionRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDriver, setSelectedDriver] = useState<string | null>(null);
  const [docMode, setDocMode] = useState<'invoice' | 'payment'>('invoice');
  const [bulkMode, setBulkMode] = useState<'invoice' | 'payment' | null>(null);
  const [finalizing, setFinalizing] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    const session = (await supabase.auth.getSession()).data.session;
    const base = import.meta.env.VITE_SUPABASE_URL;
    const authHeader = {
      Authorization: `Bearer ${session?.access_token ?? ''}`,
      'Content-Type': 'application/json',
    };
    try {
      const [recRes, formRes] = await Promise.all([
        fetch(`${base}/functions/v1/fetch-delivery-records`, {
          method: 'POST',
          headers: authHeader,
          body: JSON.stringify({}),
        }),
        fetch(`${base}/functions/v1/fetch-form-responses`, {
          method: 'POST',
          headers: authHeader,
          body: JSON.stringify({}),
        }),
      ]);
      const recData = await recRes.json();
      if (!recRes.ok || recData.error) {
        setError(`HTTP ${recRes.status}: ${recData.error ?? '配送実績エラー'}`);
        setLoading(false);
        return;
      }
      setRecords((recData.records ?? []) as DeliveryRow[]);
      const formData = await formRes.json();
      if (formRes.ok && !formData.error) {
        setFormResponses((formData.responses ?? []) as FormResponse[]);
      } else {
        setFormResponses([]);
      }
    } catch (err) {
      setError('通信エラー: ' + (err instanceof Error ? err.message : String(err)));
      setLoading(false);
      return;
    }

    // 車建日マスタ (DB)
    const { data: vehData, error: vehErr } = await supabase
      .from('vehicle_days')
      .select('month, day, amount')
      .eq('active', true);
    if (vehErr) setError(vehErr.message);
    else
      setVehicleDays(
        (vehData ?? []).map((d) => ({
          month: Number(d.month),
          day: Number(d.day),
          amount: Number(d.amount),
        })),
      );
    const [
      { data: profileData, error: profileErr },
      { data: officeData, error: officeErr },
      { data: rateData, error: rateErr },
    ] = await Promise.all([
      supabase.from('profiles').select('*'),
      supabase.from('offices').select('*'),
      supabase.from('driver_deduction_rates').select('*').order('effective_from'),
    ]);
    if (profileErr) setError(profileErr.message);
    else setProfiles((profileData ?? []) as Profile[]);
    if (officeErr) setError(officeErr.message);
    else setOffices((officeData ?? []) as Office[]);
    if (rateErr) setError(rateErr.message);
    else setRateHistory((rateData ?? []) as DriverDeductionRate[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  // driver_id → 履歴(古い順)のMap
  const rateHistoryByDriver = useMemo(() => {
    const map = new Map<string, DriverDeductionRate[]>();
    for (const r of rateHistory) {
      const arr = map.get(r.driver_id) ?? [];
      arr.push(r);
      map.set(r.driver_id, arr);
    }
    // 各配列を effective_from 昇順
    for (const [, arr] of map) arr.sort((a, b) => a.effective_from.localeCompare(b.effective_from));
    return map;
  }, [rateHistory]);

  // 指定driverID・日付時点の控除率を返す
  const getRateOn = (driverId: string | null, date: string, fallback: number): number => {
    if (!driverId) return fallback;
    const hist = rateHistoryByDriver.get(driverId);
    if (!hist || hist.length === 0) return fallback;
    let rate = fallback;
    for (const h of hist) {
      if (h.effective_from <= date) rate = Number(h.deduction_rate);
      else break;
    }
    return rate;
  };

  const vehicleDayMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of vehicleDays) m.set(vdKey(v), v.amount);
    return m;
  }, [vehicleDays]);

  const aggregates = useMemo<DriverAggregate[]>(() => {
    const filtered = records.filter((r) => {
      if (!r.work_date) return false;
      if (dateFrom && r.work_date < dateFrom) return false;
      if (dateTo && r.work_date > dateTo) return false;
      return true;
    });
    const filteredForm = formResponses.filter((f) => {
      if (!f.work_date) return false;
      if (dateFrom && f.work_date < dateFrom) return false;
      if (dateTo && f.work_date > dateTo) return false;
      return true;
    });

    const map = new Map<string, DriverAggregate>();
    const ensure = (driverCode: string, driverName: string): DriverAggregate => {
      const key = driverCode || driverName;
      let agg = map.get(key);
      if (!agg) {
        const profile = profiles.find((p) => p.full_name === driverName);
        agg = {
          driver_code: driverCode,
          driver_name: driverName,
          driver_id: profile?.id ?? null,
          deduction_rate: Number(profile?.deduction_rate ?? 0),
          deduction_amount: 0,
          days: new Set<string>(),
          count: 0,
          quantity: 0,
          revenue: 0,
          form_vehicle: 0,
          form_kodate: 0,
          master_vehicle: 0,
          vehicle_day_dates: new Set<string>(),
          vehicle_day_amounts: new Map<string, number>(),
          rows: [],
          formRows: [],
        };
        map.set(key, agg);
      }
      return agg;
    };

    for (const r of filtered) {
      const agg = ensure(r.driver_code, r.driver_name);
      agg.days.add(r.work_date);
      agg.count += 1;
      agg.quantity += r.quantity || 0;
      agg.rows.push(r);

      const vehAmount = vehicleDayMap.get(mdKey(r.work_date));
      if (vehAmount !== undefined) {
        // 車建日: 個建ではなく車建扱い。日単位で後ほど1回だけ加算
        agg.vehicle_day_dates.add(r.work_date);
        agg.vehicle_day_amounts.set(r.work_date, vehAmount);
      } else {
        // 通常の個建
        agg.revenue += r.amount || 0;
        const rate = getRateOn(agg.driver_id, r.work_date, agg.deduction_rate);
        agg.deduction_amount += Math.round(((r.amount || 0) * rate) / 100);
      }
    }

    // 車建日の金額を日×ドライバー単位で加算 (控除対象外)
    for (const agg of map.values()) {
      for (const d of agg.vehicle_day_dates) {
        const amount = vehicleDayMap.get(mdKey(d)) ?? 0;
        agg.master_vehicle += amount;
        agg.revenue += amount;
      }
    }

    for (const f of filteredForm) {
      const agg = ensure('', f.driver_name);
      agg.formRows.push(f);
      agg.days.add(f.work_date);
      const target = formAdjustment(f.type);
      agg.revenue += f.amount;
      if (target === 'vehicle') {
        // 車建は控除対象外
        agg.form_vehicle += f.amount;
      } else {
        // 個建+ は控除対象
        agg.form_kodate += f.amount;
        const rate = getRateOn(agg.driver_id, f.work_date, agg.deduction_rate);
        agg.deduction_amount += Math.round((f.amount * rate) / 100);
      }
    }

    for (const a of map.values()) {
      a.deduction_rate = getRateOn(a.driver_id, dateTo, a.deduction_rate);
    }
    return Array.from(map.values()).sort((a, b) => a.driver_code.localeCompare(b.driver_code));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, formResponses, profiles, rateHistoryByDriver, dateFrom, dateTo]);

  const totals = useMemo(() => {
    let revenue = 0, payment = 0, invoice = 0;
    for (const a of aggregates) {
      revenue += a.revenue;
      payment += a.revenue - a.deduction_amount;
      invoice += Math.round(a.revenue * 1.1);
    }
    return { revenue, payment, invoice };
  }, [aggregates]);

  const selected = selectedDriver
    ? aggregates.find((a) => (a.driver_code || a.driver_name) === selectedDriver)
    : null;

  const setPresetCycle = (offset: number) => {
    const p = cyclePeriod(offset);
    setDateFrom(p.from);
    setDateTo(p.to);
  };

  const finalizePaymentStatements = async () => {
    if (aggregates.length === 0 || !dateFrom || !dateTo) return;

    const eligible = aggregates.filter((a) => a.driver_id);
    if (eligible.length === 0) {
      alert('プロファイルに紐付いたドライバーがいません。');
      return;
    }

    const year = parseInt(dateTo.slice(0, 4));
    const month = parseInt(dateTo.slice(5, 7));

    const { data: existing, error: existingErr } = await supabase
      .from('closed_payment_statements')
      .select('driver_id')
      .eq('year', year)
      .eq('month', month);
    if (existingErr) {
      alert('既存データの確認に失敗: ' + existingErr.message);
      return;
    }
    const existingCount = existing?.length ?? 0;

    const msg =
      existingCount > 0
        ? `${year}年${month}月度の確定済データ ${existingCount}件 が既にあります。\n上書き確定しますか？(対象 ${eligible.length}名)`
        : `${year}年${month}月度の支払明細書を確定します。\n対象 ${eligible.length}名\nよろしいですか？`;
    if (!confirm(msg)) return;

    setFinalizing(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const isUpdate = existingCount > 0;

      const buildDailyRows = (agg: DriverAggregate) => {
        const dates: Date[] = [];
        const cur = new Date(dateFrom);
        const end = new Date(dateTo);
        while (cur <= end) {
          dates.push(new Date(cur));
          cur.setDate(cur.getDate() + 1);
        }
        const byDate = new Map<string, DeliveryRow[]>();
        for (const r of agg.rows) {
          const arr = byDate.get(r.work_date) ?? [];
          arr.push(r);
          byDate.set(r.work_date, arr);
        }
        const formByDate = new Map<string, FormResponse[]>();
        for (const f of agg.formRows) {
          const arr = formByDate.get(f.work_date) ?? [];
          arr.push(f);
          formByDate.set(f.work_date, arr);
        }
        return dates.map((d) => {
          const ds = fmtDate(d);
          const rs = byDate.get(ds) ?? [];
          const formAdds = formByDate.get(ds) ?? [];
          const isMasterVehicleDay = agg.vehicle_day_dates.has(ds);
          const masterVehicle = isMasterVehicleDay
            ? agg.vehicle_day_amounts.get(ds) ?? 0
            : 0;
          const kodateBase = isMasterVehicleDay
            ? 0
            : rs.reduce((s, r) => s + (r.amount || 0), 0);
          const formKodate = formAdds
            .filter((f) => formAdjustment(f.type) === 'kodate')
            .reduce((s, f) => s + f.amount, 0);
          const formVehicle = formAdds
            .filter((f) => formAdjustment(f.type) === 'vehicle')
            .reduce((s, f) => s + f.amount, 0);
          const kodate = kodateBase + formKodate;
          const vehicle = masterVehicle + formVehicle;
          const qty = rs.reduce((s, r) => s + (r.quantity || 0), 0);
          return {
            date: ds,
            day_of_week: d.getDay(),
            kodate,
            vehicle,
            count: qty,
            subtotal: kodate + vehicle,
          };
        });
      };

      const rows = eligible.map((agg) => {
        const daily = buildDailyRows(agg);
        const kodate_total = daily.reduce((s, r) => s + r.kodate, 0);
        const vehicle_total = daily.reduce((s, r) => s + r.vehicle, 0);
        const revenue = kodate_total + vehicle_total;
        const profile = profiles.find((p) => p.id === agg.driver_id);
        const office = offices.find((o) => o.id === profile?.office_id);
        return {
          driver_id: agg.driver_id!,
          year,
          month,
          revenue,
          kodate_total,
          vehicle_total,
          deduction_rate: agg.deduction_rate,
          deduction_amount: agg.deduction_amount,
          payment_amount: revenue - agg.deduction_amount,
          daily_rows: daily,
          category_matrix: null,
          driver_snapshot: profile
            ? {
                full_name: profile.full_name,
                office_id: profile.office_id,
                office_name: office?.name ?? null,
                business_type: profile.business_type,
                company_name: profile.company_name,
              }
            : null,
          finalized_by: user?.id ?? null,
          modified_at: isUpdate ? new Date().toISOString() : null,
          modified_by: isUpdate ? user?.id ?? null : null,
        };
      });

      const { error } = await supabase
        .from('closed_payment_statements')
        .upsert(rows, { onConflict: 'driver_id,year,month' });
      if (error) throw error;

      alert(`${rows.length}名分の支払明細書を確定しました。`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      alert('確定エラー: ' + msg);
    } finally {
      setFinalizing(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="月次締め / 請求書"
        actions={
          <>
            <button
              style={btn}
              onClick={() => setBulkMode('invoice')}
              disabled={loading || aggregates.length === 0}
            >
              全員の請求書
            </button>
            <button
              style={btn}
              onClick={() => setBulkMode('payment')}
              disabled={loading || aggregates.length === 0}
            >
              全員の支払明細
            </button>
            <button
              style={btn}
              onClick={finalizePaymentStatements}
              disabled={loading || finalizing || aggregates.length === 0}
              title="現在の集計を支払明細書として確定保存し、各ドライバー/法人オーナーが閲覧できるようにします"
            >
              {finalizing ? '確定中...' : '支払明細書を確定'}
            </button>
            <button style={btnPrimary} onClick={load} disabled={loading}>
              {loading ? '読み込み中...' : '再集計'}
            </button>
          </>
        }
      />

      {error && (
        <div style={{ color: '#dc2626', marginBottom: 12, whiteSpace: 'pre-wrap' }}>{error}</div>
      )}

      <div style={{ ...card, marginBottom: 16 }} className="no-print-hide">
        <div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
          <label style={labelStyle}>
            期間 開始
            <input
              type="date"
              style={input}
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </label>
          <label style={labelStyle}>
            期間 終了
            <input
              type="date"
              style={input}
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </label>
          <button style={btn} onClick={() => setPresetCycle(-1)} title="前々月21〜前月20">
            先月締め
          </button>
          <button style={btn} onClick={() => setPresetCycle(0)} title="前月21〜当月20">
            今月締め
          </button>
          <button style={btn} onClick={() => setPresetCycle(1)} title="当月21〜翌月20">
            来月締め
          </button>
        </div>
      </div>

      <div style={{ ...card, marginBottom: 16, display: 'flex', gap: 32 }}>
        <Stat label="対象ドライバー" value={aggregates.length.toLocaleString() + '名'} />
        <Stat label="総売上(税抜)" value={`¥${totals.revenue.toLocaleString()}`} />
        <Stat label="ドライバー支払い合計" value={`¥${totals.payment.toLocaleString()}`} />
        <Stat label="アスクル請求合計(税込)" value={`¥${totals.invoice.toLocaleString()}`} />
      </div>

      <div style={card}>
        <h2 style={sectionTitle}>ドライバー別 サマリ</h2>
        {loading ? (
          <div>読み込み中...</div>
        ) : aggregates.length === 0 ? (
          <div style={{ color: colors.textMuted }}>
            対象期間にデータがありません（{dateFrom}〜{dateTo}）
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={table}>
              <thead>
                <tr>
                  <th style={th}>ドライバー</th>
                  <th style={{ ...th, textAlign: 'right' }}>稼働日数</th>
                  <th style={{ ...th, textAlign: 'right' }}>件数</th>
                  <th style={{ ...th, textAlign: 'right' }}>数量</th>
                  <th style={{ ...th, textAlign: 'right' }}>売上(税抜)</th>
                  <th style={{ ...th, textAlign: 'right' }}>控除率</th>
                  <th style={{ ...th, textAlign: 'right' }}>控除額</th>
                  <th style={{ ...th, textAlign: 'right' }}>支払額</th>
                  <th style={{ ...th, textAlign: 'right' }}>請求(税込)</th>
                  <th style={{ ...th, width: 90 }}></th>
                </tr>
              </thead>
              <tbody>
                {aggregates.map((a) => {
                  const deduction = a.deduction_amount;
                  const payment = a.revenue - deduction;
                  const invoice = Math.round(a.revenue * 1.1);
                  const key = a.driver_code || a.driver_name;
                  return (
                    <tr key={key}>
                      <td style={td}>
                        {a.driver_name}
                        <div style={{ fontSize: 11, color: colors.textMuted }}>
                          {a.driver_code}
                        </div>
                      </td>
                      <td style={{ ...td, textAlign: 'right' }}>{a.days.size}日</td>
                      <td style={{ ...td, textAlign: 'right' }}>{a.count.toLocaleString()}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{a.quantity.toLocaleString()}</td>
                      <td style={{ ...td, textAlign: 'right' }}>
                        ¥{a.revenue.toLocaleString()}
                      </td>
                      <td style={{ ...td, textAlign: 'right' }}>{a.deduction_rate}%</td>
                      <td style={{ ...td, textAlign: 'right', color: '#b45309' }}>
                        -¥{deduction.toLocaleString()}
                      </td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>
                        ¥{payment.toLocaleString()}
                      </td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>
                        ¥{invoice.toLocaleString()}
                      </td>
                      <td style={td}>
                        <button
                          style={btn}
                          onClick={() => {
                            setDocMode('invoice');
                            setSelectedDriver(key);
                          }}
                        >
                          請求書
                        </button>
                        <button
                          style={{ ...btn, marginLeft: 4 }}
                          onClick={() => {
                            setDocMode('payment');
                            setSelectedDriver(key);
                          }}
                        >
                          支払明細
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected && docMode === 'invoice' && (
        <InvoiceModal
          aggregate={selected}
          from={dateFrom}
          to={dateTo}
          profile={profiles.find((p) => p.full_name === selected.driver_name) ?? null}
          offices={offices}
          onClose={() => setSelectedDriver(null)}
        />
      )}
      {selected && docMode === 'payment' && (
        <PaymentStatementModal
          aggregate={selected}
          from={dateFrom}
          to={dateTo}
          profile={profiles.find((p) => p.full_name === selected.driver_name) ?? null}
          offices={offices}
          onClose={() => setSelectedDriver(null)}
        />
      )}
      {bulkMode && (
        <BulkDocumentsView
          mode={bulkMode}
          aggregates={aggregates}
          from={dateFrom}
          to={dateTo}
          profiles={profiles}
          offices={offices}
          onClose={() => setBulkMode(null)}
        />
      )}
    </div>
  );
}

function InvoiceModal({
  aggregate,
  from,
  to,
  profile,
  offices,
  onClose,
}: {
  aggregate: DriverAggregate;
  from: string;
  to: string;
  profile: Profile | null;
  offices: Office[];
  onClose: () => void;
}) {
  const toDate = new Date(to);
  const reiwaYear = toDate.getFullYear() - 2018; // 令和 元年=2019
  const closingMonth = toDate.getMonth() + 1;
  const officeName = offices.find((o) => o.id === profile?.office_id)?.name ?? '杉並営業所';

  // 期間中の全日付を生成
  const dates: Date[] = [];
  {
    const d = new Date(from);
    const end = new Date(to);
    while (d <= end) {
      dates.push(new Date(d));
      d.setDate(d.getDate() + 1);
    }
  }

  const byDate = useMemo(() => {
    const map = new Map<string, DeliveryRow[]>();
    for (const r of aggregate.rows) {
      const arr = map.get(r.work_date) ?? [];
      arr.push(r);
      map.set(r.work_date, arr);
    }
    return map;
  }, [aggregate]);

  const formByDate = new Map<string, FormResponse[]>();
  for (const f of aggregate.formRows) {
    const arr = formByDate.get(f.work_date) ?? [];
    arr.push(f);
    formByDate.set(f.work_date, arr);
  }
  const dayRows = dates.map((d) => {
    const ds = fmtDate(d);
    const rows = byDate.get(ds) ?? [];
    const formAdds = formByDate.get(ds) ?? [];
    const isMasterVehicleDay = aggregate.vehicle_day_dates.has(ds);
    const masterVehicle = isMasterVehicleDay ? (aggregate.vehicle_day_amounts.get(ds) ?? 0) : 0;
    const kodateBase = isMasterVehicleDay ? 0 : rows.reduce((s, r) => s + (r.amount || 0), 0);
    const formKodate = formAdds.filter((f) => formAdjustment(f.type) === 'kodate').reduce((s, f) => s + f.amount, 0);
    const formVehicle = formAdds.filter((f) => formAdjustment(f.type) === 'vehicle').reduce((s, f) => s + f.amount, 0);
    const kodate = kodateBase + formKodate;
    const vehicle = masterVehicle + formVehicle;
    const qty = rows.reduce((s, r) => s + (r.quantity || 0), 0);
    const subtotal = kodate + vehicle;
    const tax = Math.round(subtotal * 0.1);
    const total = subtotal + tax;
    return {
      date: d,
      dow: ['日', '月', '火', '水', '木', '金', '土'][d.getDay()],
      isHoliday: d.getDay() === 0 || d.getDay() === 6,
      kodate,
      vehicle,
      qty,
      tax,
      total,
      subtotal,
      hasData: rows.length > 0 || formAdds.length > 0,
    };
  });

  const totals = dayRows.reduce(
    (acc, r) => ({
      kodate: acc.kodate + r.kodate,
      vehicle: acc.vehicle + r.vehicle,
      qty: acc.qty + r.qty,
      tax: acc.tax + r.tax,
      total: acc.total + r.total,
    }),
    { kodate: 0, vehicle: 0, qty: 0, tax: 0, total: 0 },
  );

  return (
    <div style={modalStyle.overlay}>
      <div style={modalStyle.modal} className="invoice-sheet">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>
              令和{reiwaYear}年 {closingMonth}月度 請求書
            </div>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
              期間: {from} 〜 {to}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 13 }}>{officeName}</div>
            <div style={{ fontSize: 16, fontWeight: 600, marginTop: 2 }}>
              {aggregate.driver_name}
            </div>
            <div style={{ fontSize: 11, color: '#6b7280' }}>{aggregate.driver_code}</div>
          </div>
        </div>

        <div className="no-print-hide" style={{ marginBottom: 12, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button style={btn} onClick={() => window.print()}>
            印刷 / PDF保存
          </button>
          <button style={btn} onClick={onClose}>
            閉じる
          </button>
        </div>

        <table style={{ ...table, fontSize: 12 }}>
          <thead>
            <tr>
              <th style={invTh}>日付</th>
              <th style={invTh}>曜日</th>
              <th style={{ ...invTh, textAlign: 'right' }}>個建金額</th>
              <th style={{ ...invTh, textAlign: 'right' }}>車建金額</th>
              <th style={{ ...invTh, textAlign: 'right' }}>個数</th>
              <th style={{ ...invTh, textAlign: 'right' }}>税率</th>
              <th style={{ ...invTh, textAlign: 'right' }}>消費税額</th>
              <th style={{ ...invTh, textAlign: 'right' }}>請求額</th>
            </tr>
          </thead>
          <tbody>
            {dayRows.map((r, i) => (
              <tr key={i} style={r.isHoliday ? { background: '#fde8e8' } : undefined}>
                <td style={invTd}>{r.date.getMonth() + 1}月{r.date.getDate()}日</td>
                <td style={invTd}>{r.dow}</td>
                <td style={{ ...invTd, textAlign: 'right' }}>
                  {r.kodate.toLocaleString()}
                </td>
                <td style={{ ...invTd, textAlign: 'right' }}>
                  {r.vehicle.toLocaleString()}
                </td>
                <td style={{ ...invTd, textAlign: 'right' }}>{r.qty.toLocaleString()}</td>
                <td style={{ ...invTd, textAlign: 'right' }}>{r.hasData ? '10%' : ''}</td>
                <td style={{ ...invTd, textAlign: 'right' }}>{r.tax.toLocaleString()}</td>
                <td style={{ ...invTd, textAlign: 'right', fontWeight: r.hasData ? 600 : 400 }}>
                  {r.total.toLocaleString()}
                </td>
              </tr>
            ))}
            <tr style={{ background: '#f3f4f6', fontWeight: 700 }}>
              <td style={invTd} colSpan={2}>合計</td>
              <td style={{ ...invTd, textAlign: 'right' }}>
                {totals.kodate.toLocaleString()}
              </td>
              <td style={{ ...invTd, textAlign: 'right' }}>
                {totals.vehicle.toLocaleString()}
              </td>
              <td style={{ ...invTd, textAlign: 'right' }}>{totals.qty.toLocaleString()}</td>
              <td style={invTd}></td>
              <td style={{ ...invTd, textAlign: 'right' }}>{totals.tax.toLocaleString()}</td>
              <td style={{ ...invTd, textAlign: 'right' }}>{totals.total.toLocaleString()}</td>
            </tr>
          </tbody>
        </table>

      </div>
    </div>
  );
}

function PaymentStatementModal({
  aggregate,
  from,
  to,
  profile,
  offices,
  onClose,
}: {
  aggregate: DriverAggregate;
  from: string;
  to: string;
  profile: Profile | null;
  offices: Office[];
  onClose: () => void;
}) {
  const toDate = new Date(to);
  const reiwaYear = toDate.getFullYear() - 2018;
  const closingMonth = toDate.getMonth() + 1;
  const officeName = offices.find((o) => o.id === profile?.office_id)?.name ?? '杉並営業所';

  const dates: Date[] = [];
  {
    const d = new Date(from);
    const end = new Date(to);
    while (d <= end) {
      dates.push(new Date(d));
      d.setDate(d.getDate() + 1);
    }
  }

  const byDate = useMemo(() => {
    const map = new Map<string, DeliveryRow[]>();
    for (const r of aggregate.rows) {
      const arr = map.get(r.work_date) ?? [];
      arr.push(r);
      map.set(r.work_date, arr);
    }
    return map;
  }, [aggregate]);

  const formByDate = new Map<string, FormResponse[]>();
  for (const f of aggregate.formRows) {
    const arr = formByDate.get(f.work_date) ?? [];
    arr.push(f);
    formByDate.set(f.work_date, arr);
  }
  const dayRows = dates.map((d) => {
    const ds = fmtDate(d);
    const rows = byDate.get(ds) ?? [];
    const formAdds = formByDate.get(ds) ?? [];
    const isMasterVehicleDay = aggregate.vehicle_day_dates.has(ds);
    const masterVehicle = isMasterVehicleDay ? (aggregate.vehicle_day_amounts.get(ds) ?? 0) : 0;
    const kodateBase = isMasterVehicleDay ? 0 : rows.reduce((s, r) => s + (r.amount || 0), 0);
    const formKodate = formAdds.filter((f) => formAdjustment(f.type) === 'kodate').reduce((s, f) => s + f.amount, 0);
    const formVehicle = formAdds.filter((f) => formAdjustment(f.type) === 'vehicle').reduce((s, f) => s + f.amount, 0);
    const kodate = kodateBase + formKodate;
    const vehicle = masterVehicle + formVehicle;
    const qty = rows.reduce((s, r) => s + (r.quantity || 0), 0);
    const subtotal = kodate + vehicle;
    return {
      date: d,
      dow: ['日', '月', '火', '水', '木', '金', '土'][d.getDay()],
      isHoliday: d.getDay() === 0 || d.getDay() === 6,
      kodate,
      vehicle,
      qty,
      subtotal,
      hasData: rows.length > 0 || formAdds.length > 0,
    };
  });

  const grossRevenue = dayRows.reduce((s, r) => s + r.subtotal, 0);
  const deductionRate = aggregate.deduction_rate;
  // 日付別控除の合計は aggregate.deduction_amount に格納済み
  const deduction = aggregate.deduction_amount;
  const payment = grossRevenue - deduction;

  return (
    <div style={modalStyle.overlay}>
      <div style={modalStyle.modal}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>
              令和{reiwaYear}年 {closingMonth}月度 支払い明細
            </div>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
              期間: {from} 〜 {to}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 13 }}>{officeName}</div>
            <div style={{ fontSize: 16, fontWeight: 600, marginTop: 2 }}>
              {aggregate.driver_name} 様
            </div>
            <div style={{ fontSize: 11, color: '#6b7280' }}>{aggregate.driver_code}</div>
          </div>
        </div>

        <div className="no-print-hide" style={{ marginBottom: 12, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button style={btn} onClick={() => window.print()}>
            印刷 / PDF保存
          </button>
          <button style={btn} onClick={onClose}>
            閉じる
          </button>
        </div>

        <table style={{ ...table, fontSize: 12 }}>
          <thead>
            <tr>
              <th style={invTh}>日付</th>
              <th style={invTh}>曜日</th>
              <th style={{ ...invTh, textAlign: 'right' }}>個建金額</th>
              <th style={{ ...invTh, textAlign: 'right' }}>車建金額</th>
              <th style={{ ...invTh, textAlign: 'right' }}>個数</th>
              <th style={{ ...invTh, textAlign: 'right' }}>売上(税抜)</th>
            </tr>
          </thead>
          <tbody>
            {dayRows.map((r, i) => (
              <tr key={i} style={r.isHoliday ? { background: '#fde8e8' } : undefined}>
                <td style={invTd}>{r.date.getMonth() + 1}月{r.date.getDate()}日</td>
                <td style={invTd}>{r.dow}</td>
                <td style={{ ...invTd, textAlign: 'right' }}>{r.kodate.toLocaleString()}</td>
                <td style={{ ...invTd, textAlign: 'right' }}>{r.vehicle.toLocaleString()}</td>
                <td style={{ ...invTd, textAlign: 'right' }}>{r.qty.toLocaleString()}</td>
                <td style={{ ...invTd, textAlign: 'right', fontWeight: r.hasData ? 600 : 400 }}>
                  {r.subtotal.toLocaleString()}
                </td>
              </tr>
            ))}
            <tr style={{ background: '#f3f4f6', fontWeight: 700 }}>
              <td style={invTd} colSpan={2}>合計</td>
              <td style={{ ...invTd, textAlign: 'right' }}>
                {dayRows.reduce((s, r) => s + r.kodate, 0).toLocaleString()}
              </td>
              <td style={{ ...invTd, textAlign: 'right' }}>
                {dayRows.reduce((s, r) => s + r.vehicle, 0).toLocaleString()}
              </td>
              <td style={{ ...invTd, textAlign: 'right' }}>
                {dayRows.reduce((s, r) => s + r.qty, 0).toLocaleString()}
              </td>
              <td style={{ ...invTd, textAlign: 'right' }}>
                {grossRevenue.toLocaleString()}
              </td>
            </tr>
          </tbody>
        </table>

        <div
          style={{
            marginTop: 20,
            padding: 16,
            background: '#f9fafb',
            border: '1px solid #e5e7eb',
            borderRadius: 4,
            fontSize: 13,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 14 }}>お支払い額計算</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 24px', maxWidth: 440 }}>
            <span>個建 合計</span>
            <span style={{ textAlign: 'right' }}>
              ¥{(grossRevenue - aggregate.form_vehicle - aggregate.master_vehicle).toLocaleString()}
            </span>
            <span>車建 合計 (控除対象外)</span>
            <span style={{ textAlign: 'right' }}>
              ¥{(aggregate.form_vehicle + aggregate.master_vehicle).toLocaleString()}
            </span>
            <span>総売上(税抜)</span>
            <span style={{ textAlign: 'right' }}>¥{grossRevenue.toLocaleString()}</span>
            <span>控除率 (個建のみ適用)</span>
            <span style={{ textAlign: 'right' }}>{deductionRate}%</span>
            <span>控除額</span>
            <span style={{ textAlign: 'right', color: '#b45309' }}>
              -¥{deduction.toLocaleString()}
            </span>
            <div style={{ gridColumn: '1 / -1', borderTop: '1px solid #d1d5db', margin: '4px 0' }} />
            <span style={{ fontWeight: 700, fontSize: 15 }}>お支払い額</span>
            <span style={{ textAlign: 'right', fontWeight: 700, fontSize: 15 }}>
              ¥{payment.toLocaleString()}
            </span>
          </div>
        </div>

        <div style={{ marginTop: 32, paddingTop: 24, borderTop: '2px dashed #d1d5db' }}>
          <CategoryMatrixPage
            aggregate={aggregate}
            dates={dates}
            closingMonth={closingMonth}
            officeName={officeName}
          />
        </div>
      </div>
    </div>
  );
}

const invTh = {
  ...th,
  fontSize: 11,
  padding: '6px 8px',
  border: '1px solid #d1d5db',
} as const;
const invTd = {
  ...td,
  fontSize: 12,
  padding: '4px 8px',
  border: '1px solid #e5e7eb',
} as const;

// 件数マトリクス用の詰めスタイル (高さ半分 / 日付幅広め)
const matrixTh = {
  ...th,
  fontSize: 10,
  padding: '3px 6px',
  border: '1px solid #d1d5db',
} as const;
const matrixTd = {
  ...td,
  fontSize: 12,
  padding: '2px 6px',
  lineHeight: 1.45,
  border: '1px solid #e5e7eb',
} as const;

// 単価 → 区分名 マッピング（既存シート準拠）
const PRICE_CATEGORY_NAMES: Record<number, string> = {
  4: 'オリコン蓋',
  9: 'オリコン',
  10: '段ボール',
  100: 'カタログ・トナー・サンゲッツ・花',
  201: '通常配達・返品',
  220: 'ブックオフ',
  326: 'ウォーターサーバー',
  351: '代引き',
};

function CategoryMatrixPage({
  aggregate,
  dates,
  closingMonth,
  officeName,
}: {
  aggregate: DriverAggregate;
  dates: Date[];
  closingMonth: number;
  officeName: string;
}) {
  // このドライバーの全記録で使われている単価リスト
  const priceSet = new Set<number>();
  for (const r of aggregate.rows) priceSet.add(r.unit_price);
  const prices = Array.from(priceSet).sort((a, b) => a - b);

  // 日付×単価の数量
  const byDate = new Map<string, Map<number, number>>();
  for (const d of dates) {
    byDate.set(fmtDate(d), new Map(prices.map((p) => [p, 0])));
  }
  for (const r of aggregate.rows) {
    const m = byDate.get(r.work_date);
    if (m) m.set(r.unit_price, (m.get(r.unit_price) ?? 0) + r.quantity);
  }

  const totalsPerPrice = new Map<number, number>();
  for (const p of prices) {
    let sum = 0;
    for (const d of dates) sum += byDate.get(fmtDate(d))?.get(p) ?? 0;
    totalsPerPrice.set(p, sum);
  }
  const appliedTotal = prices.reduce((s, p) => s + (totalsPerPrice.get(p) ?? 0) * p, 0);

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{closingMonth}月度 件数明細</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 13 }}>{officeName}</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginTop: 2 }}>
            {aggregate.driver_name}
          </div>
          <div style={{ fontSize: 10, color: '#555' }}>{aggregate.driver_code}</div>
        </div>
      </div>

      <div style={{ marginBottom: 12, display: 'inline-block', background: '#fff59d', padding: '6px 12px', fontSize: 13, fontWeight: 600 }}>
        適用金額 &nbsp; ¥{appliedTotal.toLocaleString()}
      </div>

      <table style={{ ...table, fontSize: 11, width: '100%', tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: '24mm' }} />
          <col style={{ width: '10mm' }} />
          {prices.map((p) => (
            <col key={p} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th style={matrixTh} rowSpan={2}>日付</th>
            <th style={matrixTh} rowSpan={2}>曜日</th>
            {prices.map((p) => (
              <th key={p} style={{ ...matrixTh, textAlign: 'center' }}>
                {PRICE_CATEGORY_NAMES[p] ?? `¥${p}区分`}
              </th>
            ))}
          </tr>
          <tr>
            {prices.map((p) => (
              <th key={p} style={{ ...matrixTh, textAlign: 'right', fontWeight: 400 }}>
                {p}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dates.map((d, i) => {
            const ds = fmtDate(d);
            const row = byDate.get(ds) ?? new Map<number, number>();
            const isHoliday = d.getDay() === 0 || d.getDay() === 6;
            return (
              <tr key={i} style={isHoliday ? { background: '#fde8e8' } : undefined}>
                <td style={matrixTd}>{d.getMonth() + 1}月{d.getDate()}日</td>
                <td style={matrixTd}>{['日','月','火','水','木','金','土'][d.getDay()]}</td>
                {prices.map((p) => (
                  <td key={p} style={{ ...matrixTd, textAlign: 'right' }}>
                    {(row.get(p) ?? 0).toLocaleString()}
                  </td>
                ))}
              </tr>
            );
          })}
          <tr style={{ background: '#f3f4f6', fontWeight: 700 }}>
            <td style={matrixTd} colSpan={2}>合計件数</td>
            {prices.map((p) => (
              <td key={p} style={{ ...matrixTd, textAlign: 'right' }}>
                {(totalsPerPrice.get(p) ?? 0).toLocaleString()}
              </td>
            ))}
          </tr>
          <tr style={{ background: '#f3f4f6', fontWeight: 700 }}>
            <td style={matrixTd} colSpan={2}>金額</td>
            {prices.map((p) => (
              <td key={p} style={{ ...matrixTd, textAlign: 'right' }}>
                ¥{((totalsPerPrice.get(p) ?? 0) * p).toLocaleString()}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </>
  );
}

function BulkDocumentsView({
  mode,
  aggregates,
  from,
  to,
  profiles,
  offices,
  onClose,
}: {
  mode: 'invoice' | 'payment';
  aggregates: DriverAggregate[];
  from: string;
  to: string;
  profiles: Profile[];
  offices: Office[];
  onClose: () => void;
}) {
  const toDate = new Date(to);
  const reiwaYear = toDate.getFullYear() - 2018;
  const closingMonth = toDate.getMonth() + 1;

  const dates: Date[] = [];
  {
    const d = new Date(from);
    const end = new Date(to);
    while (d <= end) {
      dates.push(new Date(d));
      d.setDate(d.getDate() + 1);
    }
  }

  const pagesRef = useRef<HTMLDivElement>(null);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  const renderElToPdfPage = async (pdf: jsPDF, el: HTMLDivElement, addNewPage: boolean) => {
    if (addNewPage) pdf.addPage();
    const canvas = await html2canvas(el, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
    });
    const imgData = canvas.toDataURL('image/jpeg', 0.92);
    const pdfW = pdf.internal.pageSize.getWidth();
    const pdfH = pdf.internal.pageSize.getHeight();
    const imgW = pdfW - 10;
    const imgH = (canvas.height * imgW) / canvas.width;
    if (imgH <= pdfH - 10) {
      pdf.addImage(imgData, 'JPEG', 5, 5, imgW, imgH);
    } else {
      const fitH = pdfH - 10;
      const fitW = (canvas.width * fitH) / canvas.height;
      pdf.addImage(imgData, 'JPEG', (pdfW - fitW) / 2, 5, fitW, fitH);
    }
  };

  const buildPdfBlob = async (page1: HTMLDivElement, page2: HTMLDivElement | null) => {
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    await renderElToPdfPage(pdf, page1, false);
    if (page2) await renderElToPdfPage(pdf, page2, true);
    return pdf.output('blob') as Blob;
  };

  const folderName = `${mode === 'invoice' ? '請求書' : '支払明細'}_${reiwaYear}年${closingMonth}月度`;
  const buildFileName = (agg: DriverAggregate, idx: number) => {
    const safeName = (agg.driver_name || agg.driver_code || `driver-${idx + 1}`).replace(/[\\/:*?"<>|]/g, '_');
    return `${safeName}.pdf`;
  };

  const downloadIndividualPdfs = async () => {
    const container = pagesRef.current;
    if (!container) return;
    const pageEls = container.querySelectorAll<HTMLDivElement>('.print-page');
    if (pageEls.length === 0) return;
    setGenerating(true);
    try {
      const zip = new JSZip();
      const folder = zip.folder(folderName);
      const n = aggregates.length;
      for (let i = 0; i < n; i++) {
        const agg = aggregates[i];
        setProgress(`${i + 1}/${n}: ${agg.driver_name}`);
        const page1 = pageEls[i];
        const page2 = mode === 'payment' ? pageEls[i + n] : null;
        const blob = await buildPdfBlob(page1, page2);
        folder!.file(buildFileName(agg, i), blob);
      }
      setProgress('ZIP生成中...');
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      saveAs(zipBlob, `${folderName}.zip`);
    } catch (err) {
      alert('PDF生成失敗: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setProgress(null);
      setGenerating(false);
    }
  };

  const downloadMergedPdf = async () => {
    const container = pagesRef.current;
    if (!container) return;
    const pageEls = container.querySelectorAll<HTMLDivElement>('.print-page');
    if (pageEls.length === 0) return;
    setGenerating(true);
    try {
      const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
      const n = aggregates.length;
      for (let i = 0; i < n; i++) {
        const agg = aggregates[i];
        setProgress(`${i + 1}/${n}: ${agg.driver_name}`);
        const page1 = pageEls[i];
        const page2 = mode === 'payment' ? pageEls[i + n] : null;
        await renderElToPdfPage(pdf, page1, i !== 0);
        if (page2) await renderElToPdfPage(pdf, page2, true);
      }
      setProgress('PDF保存中...');
      const blob = pdf.output('blob') as Blob;
      saveAs(blob, `${folderName}.pdf`);
    } catch (err) {
      alert('PDF生成失敗: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setProgress(null);
      setGenerating(false);
    }
  };

  return (
    <div style={bulkStyle.root}>
      <style>{printCss}</style>
      <div style={bulkStyle.header} className="no-print">
        <div style={{ fontWeight: 600 }}>
          {mode === 'invoice' ? '請求書' : '支払い明細'} ({aggregates.length}件)
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {progress && (
            <span style={{ fontSize: 12, color: '#2563eb' }}>{progress}</span>
          )}
          <button style={btnPrimary} onClick={downloadMergedPdf} disabled={generating}>
            {generating ? '生成中...' : `1つのPDFにまとめる (${aggregates.length}ページ)`}
          </button>
          <button style={btn} onClick={downloadIndividualPdfs} disabled={generating}>
            {generating ? '生成中...' : `ZIPで個別ダウンロード (${aggregates.length}ファイル)`}
          </button>
          <button style={btn} onClick={() => window.print()} disabled={generating}>
            まとめて印刷
          </button>
          <button style={btn} onClick={onClose} disabled={generating}>
            閉じる
          </button>
        </div>
      </div>
      <div style={bulkStyle.pages} ref={pagesRef}>
        {aggregates.map((agg) => {
          const profile = profiles.find((p) => p.full_name === agg.driver_name) ?? null;
          const officeName = offices.find((o) => o.id === profile?.office_id)?.name ?? '杉並営業所';
          const byDate = new Map<string, DeliveryRow[]>();
          for (const r of agg.rows) {
            const arr = byDate.get(r.work_date) ?? [];
            arr.push(r);
            byDate.set(r.work_date, arr);
          }
          const formByDate = new Map<string, FormResponse[]>();
          for (const f of agg.formRows) {
            const arr = formByDate.get(f.work_date) ?? [];
            arr.push(f);
            formByDate.set(f.work_date, arr);
          }
          const dayRows = dates.map((d) => {
            const ds = fmtDate(d);
            const rows = byDate.get(ds) ?? [];
            const formAdds = formByDate.get(ds) ?? [];
            const isMasterVehicleDay = agg.vehicle_day_dates.has(ds);
            const masterVehicle = isMasterVehicleDay ? (agg.vehicle_day_amounts.get(ds) ?? 0) : 0;
            const kodateBase = isMasterVehicleDay ? 0 : rows.reduce((s, r) => s + (r.amount || 0), 0);
            const formKodate = formAdds.filter((f) => formAdjustment(f.type) === 'kodate').reduce((s, f) => s + f.amount, 0);
            const formVehicle = formAdds.filter((f) => formAdjustment(f.type) === 'vehicle').reduce((s, f) => s + f.amount, 0);
            const kodate = kodateBase + formKodate;
            const vehicle = masterVehicle + formVehicle;
            const qty = rows.reduce((s, r) => s + (r.quantity || 0), 0);
            const subtotal = kodate + vehicle;
            const tax = Math.round(subtotal * 0.1);
            return {
              date: d,
              dow: ['日', '月', '火', '水', '木', '金', '土'][d.getDay()],
              isHoliday: d.getDay() === 0 || d.getDay() === 6,
              kodate,
              vehicle,
              qty,
              tax,
              total: subtotal + tax,
              subtotal,
              hasData: rows.length > 0 || formAdds.length > 0,
            };
          });
          const totals = dayRows.reduce(
            (acc, r) => ({
              kodate: acc.kodate + r.kodate,
              vehicle: acc.vehicle + r.vehicle,
              qty: acc.qty + r.qty,
              tax: acc.tax + r.tax,
              total: acc.total + r.total,
              subtotal: acc.subtotal + r.subtotal,
            }),
            { kodate: 0, vehicle: 0, qty: 0, tax: 0, total: 0, subtotal: 0 },
          );
          const deduction = agg.deduction_amount;
          const payment = totals.subtotal - deduction;

          return (
            <div key={agg.driver_code || agg.driver_name} className="print-page" style={bulkStyle.page}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>
                    令和{reiwaYear}年 {closingMonth}月度 {mode === 'invoice' ? '請求書' : '支払い明細'}
                  </div>
                  <div style={{ fontSize: 11, color: '#555', marginTop: 4 }}>
                    期間: {from} 〜 {to}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 13 }}>{officeName}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, marginTop: 2 }}>
                    {agg.driver_name}{mode === 'payment' ? ' 様' : ''}
                  </div>
                  <div style={{ fontSize: 10, color: '#555' }}>{agg.driver_code}</div>
                </div>
              </div>

              <table style={{ ...table, fontSize: 11, width: '100%' }}>
                <thead>
                  <tr>
                    <th style={invTh}>日付</th>
                    <th style={invTh}>曜日</th>
                    <th style={{ ...invTh, textAlign: 'right' }}>個建金額</th>
                    <th style={{ ...invTh, textAlign: 'right' }}>車建金額</th>
                    <th style={{ ...invTh, textAlign: 'right' }}>個数</th>
                    {mode === 'invoice' ? (
                      <>
                        <th style={{ ...invTh, textAlign: 'right' }}>税率</th>
                        <th style={{ ...invTh, textAlign: 'right' }}>消費税額</th>
                        <th style={{ ...invTh, textAlign: 'right' }}>請求額</th>
                      </>
                    ) : (
                      <th style={{ ...invTh, textAlign: 'right' }}>売上(税抜)</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {dayRows.map((r, i) => (
                    <tr key={i} style={r.isHoliday ? { background: '#fde8e8' } : undefined}>
                      <td style={invTd}>{r.date.getMonth() + 1}月{r.date.getDate()}日</td>
                      <td style={invTd}>{r.dow}</td>
                      <td style={{ ...invTd, textAlign: 'right' }}>{r.kodate.toLocaleString()}</td>
                      <td style={{ ...invTd, textAlign: 'right' }}>{r.vehicle.toLocaleString()}</td>
                      <td style={{ ...invTd, textAlign: 'right' }}>{r.qty.toLocaleString()}</td>
                      {mode === 'invoice' ? (
                        <>
                          <td style={{ ...invTd, textAlign: 'right' }}>{r.hasData ? '10%' : ''}</td>
                          <td style={{ ...invTd, textAlign: 'right' }}>{r.tax.toLocaleString()}</td>
                          <td style={{ ...invTd, textAlign: 'right', fontWeight: r.hasData ? 600 : 400 }}>
                            {r.total.toLocaleString()}
                          </td>
                        </>
                      ) : (
                        <td style={{ ...invTd, textAlign: 'right', fontWeight: r.hasData ? 600 : 400 }}>
                          {r.subtotal.toLocaleString()}
                        </td>
                      )}
                    </tr>
                  ))}
                  <tr style={{ background: '#f3f4f6', fontWeight: 700 }}>
                    <td style={invTd} colSpan={2}>合計</td>
                    <td style={{ ...invTd, textAlign: 'right' }}>{totals.kodate.toLocaleString()}</td>
                    <td style={{ ...invTd, textAlign: 'right' }}>{totals.vehicle.toLocaleString()}</td>
                    <td style={{ ...invTd, textAlign: 'right' }}>{totals.qty.toLocaleString()}</td>
                    {mode === 'invoice' ? (
                      <>
                        <td style={invTd}></td>
                        <td style={{ ...invTd, textAlign: 'right' }}>{totals.tax.toLocaleString()}</td>
                        <td style={{ ...invTd, textAlign: 'right' }}>{totals.total.toLocaleString()}</td>
                      </>
                    ) : (
                      <td style={{ ...invTd, textAlign: 'right' }}>{totals.subtotal.toLocaleString()}</td>
                    )}
                  </tr>
                </tbody>
              </table>

              {mode === 'payment' && (
                <div
                  style={{
                    marginTop: 14,
                    padding: 12,
                    border: '1px solid #d1d5db',
                    borderRadius: 4,
                    fontSize: 12,
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 8 }}>お支払い額計算</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 24px', maxWidth: 400 }}>
                    <span>個建 合計</span>
                    <span style={{ textAlign: 'right' }}>
                      ¥{(totals.subtotal - agg.form_vehicle - agg.master_vehicle).toLocaleString()}
                    </span>
                    <span>車建 合計 (控除対象外)</span>
                    <span style={{ textAlign: 'right' }}>
                      ¥{(agg.form_vehicle + agg.master_vehicle).toLocaleString()}
                    </span>
                    <span>総売上(税抜)</span>
                    <span style={{ textAlign: 'right' }}>¥{totals.subtotal.toLocaleString()}</span>
                    <span>控除率 (個建のみ適用)</span>
                    <span style={{ textAlign: 'right' }}>{agg.deduction_rate}%</span>
                    <span>控除額</span>
                    <span style={{ textAlign: 'right' }}>-¥{deduction.toLocaleString()}</span>
                    <div style={{ gridColumn: '1 / -1', borderTop: '1px solid #d1d5db', margin: '4px 0' }} />
                    <span style={{ fontWeight: 700 }}>お支払い額</span>
                    <span style={{ textAlign: 'right', fontWeight: 700 }}>¥{payment.toLocaleString()}</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* 支払い明細モードのときは、各ドライバーの件数明細ページ(page2)も追加 */}
        {mode === 'payment' &&
          aggregates.map((agg) => {
            const profile = profiles.find((p) => p.full_name === agg.driver_name) ?? null;
            const officeName = offices.find((o) => o.id === profile?.office_id)?.name ?? '杉並営業所';
            return (
              <div
                key={(agg.driver_code || agg.driver_name) + '-matrix'}
                className="print-page"
                style={bulkStyle.page}
              >
                <CategoryMatrixPage
                  aggregate={agg}
                  dates={dates}
                  closingMonth={closingMonth}
                  officeName={officeName}
                />
              </div>
            );
          })}
      </div>
    </div>
  );
}

const bulkStyle = {
  root: {
    position: 'fixed' as const,
    inset: 0,
    background: '#f4f5f7',
    zIndex: 20,
    overflow: 'auto',
    display: 'flex',
    flexDirection: 'column' as const,
  },
  header: {
    position: 'sticky' as const,
    top: 0,
    background: '#fff',
    borderBottom: '1px solid #e5e7eb',
    padding: '10px 16px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    zIndex: 1,
  },
  pages: {
    padding: 16,
  },
  page: {
    background: '#fff',
    padding: '20mm',
    margin: '0 auto 12px',
    width: '210mm',
    minHeight: '297mm',
    boxShadow: '0 2px 6px rgba(0,0,0,0.1)',
    boxSizing: 'border-box' as const,
  },
};

const printCss = `
@media print {
  @page { size: A4; margin: 12mm; }
  body { background: #fff !important; }
  .no-print { display: none !important; }
  .print-page {
    box-shadow: none !important;
    margin: 0 !important;
    padding: 0 !important;
    width: auto !important;
    min-height: auto !important;
    page-break-after: always;
  }
  .print-page:last-child { page-break-after: auto; }
}
`;

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: '#6b7280' }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 600, marginTop: 2 }}>{value}</div>
    </div>
  );
}

const sectionTitle = { fontSize: 14, margin: '0 0 12px', color: '#374151' };
const labelStyle = { display: 'flex', flexDirection: 'column' as const, gap: 4, fontSize: 12 };
const modalStyle = {
  overlay: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(0,0,0,0.4)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  modal: {
    background: '#fff',
    borderRadius: 6,
    padding: 20,
    width: 900,
    maxWidth: '95vw',
    maxHeight: '92vh',
    overflow: 'auto',
  },
};
