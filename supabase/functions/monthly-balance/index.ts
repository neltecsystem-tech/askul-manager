import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SPREADSHEET_ID = '1Wh280_jyUFOCjsd1XrBNMbEXCiVwcJ1pvGdYEEi8LOY';
const DELIVERY_RANGE = 'DETA貼り付け!A2:P';
const FORM_RANGE = 'フォームの回答 1!A2:G';
const API_KEY = 'AIzaSyD8p7oPEYI1lXWBVnXBr3z96ON56NJG6hQ';

interface DeliveryRow {
  work_date: string;
  driver_code: string;
  driver_name: string;
  quantity: number;
  amount: number;
}
interface FormRow {
  work_date: string;
  driver_name: string;
  type: string;
  amount: number;
}

function normalizeDate(s: string): string {
  if (!s) return '';
  const m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  if (s.length === 8) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return s;
}
function mdKey(workDate: string): string {
  return workDate.slice(5);
}
function vdKey(month: number, day: number): string {
  return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
function formAdjustment(type: string): 'vehicle' | 'kodate' {
  return type.includes('個建') ? 'kodate' : 'vehicle';
}

async function fetchSheet(range: string): Promise<(string | number)[][]> {
  const url =
    'https://sheets.googleapis.com/v4/spreadsheets/' +
    encodeURIComponent(SPREADSHEET_ID) +
    '/values/' +
    encodeURIComponent(range) +
    '?key=' + API_KEY +
    '&majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Sheets ${range}: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { values?: (string | number)[][] };
  return j.values ?? [];
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = (await req.json().catch(() => ({}))) as { from?: string; to?: string };
    const from = body.from ?? '';
    const to = body.to ?? '';
    if (!from || !to) return json({ error: 'from / to required (YYYY-MM-DD)' }, 400);

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const [deliveryValues, formValues, profilesRes, vehicleDaysRes, ratesRes] = await Promise.all([
      fetchSheet(DELIVERY_RANGE),
      fetchSheet(FORM_RANGE),
      admin.from('profiles').select('id, full_name, deduction_rate, business_type, monthly_salary, active'),
      admin.from('vehicle_days').select('month, day, amount').eq('active', true),
      admin.from('driver_deduction_rates').select('driver_id, effective_from, deduction_rate').order('effective_from'),
    ]);

    const profiles = (profilesRes.data ?? []) as { id: string; full_name: string; deduction_rate: number | null; business_type: string | null; monthly_salary: number | null; active: boolean }[];

    // 社員の月給合計 (アクティブな biz_type='employee' のみ)
    let employee_salary_total = 0;
    let employee_count = 0;
    for (const p of profiles) {
      if (p.active && p.business_type === 'employee' && (p.monthly_salary ?? 0) > 0) {
        employee_salary_total += Number(p.monthly_salary);
        employee_count++;
      }
    }
    const vehicleDaysRows = (vehicleDaysRes.data ?? []) as { month: number; day: number; amount: number }[];
    const rateRows = (ratesRes.data ?? []) as { driver_id: string; effective_from: string; deduction_rate: number }[];

    const profileByName = new Map<string, { id: string; deduction_rate: number }>();
    for (const p of profiles) {
      profileByName.set(p.full_name, { id: p.id, deduction_rate: Number(p.deduction_rate ?? 0) });
    }
    const vehicleDayMap = new Map<string, number>();
    for (const v of vehicleDaysRows) vehicleDayMap.set(vdKey(Number(v.month), Number(v.day)), Number(v.amount));
    const rateHistoryByDriver = new Map<string, { effective_from: string; deduction_rate: number }[]>();
    for (const r of rateRows) {
      const arr = rateHistoryByDriver.get(r.driver_id) ?? [];
      arr.push({ effective_from: r.effective_from, deduction_rate: Number(r.deduction_rate) });
      rateHistoryByDriver.set(r.driver_id, arr);
    }
    const getRateOn = (driverId: string | null, date: string, fallback: number): number => {
      if (!driverId) return fallback;
      const hist = rateHistoryByDriver.get(driverId);
      if (!hist || hist.length === 0) return fallback;
      let rate = fallback;
      for (const h of hist) {
        if (h.effective_from <= date) rate = h.deduction_rate;
        else break;
      }
      return rate;
    };

    // Parse + filter delivery rows
    const deliveries: DeliveryRow[] = [];
    for (const row of deliveryValues) {
      if (!row || row.length === 0 || !row[5]) continue;
      const work_date = normalizeDate(String(row[5] ?? ''));
      if (!work_date || work_date < from || work_date > to) continue;
      deliveries.push({
        work_date,
        driver_code: String(row[1] ?? ''),
        driver_name: String(row[2] ?? ''),
        quantity: Number(row[13] ?? 0),
        amount: Number(row[15] ?? 0),
      });
    }

    // Parse + filter form rows
    const forms: FormRow[] = [];
    for (const row of formValues) {
      if (!row || row.length === 0 || !row[1] || !row[2]) continue;
      const work_date = normalizeDate(String(row[1] ?? ''));
      if (!work_date || work_date < from || work_date > to) continue;
      forms.push({
        work_date,
        driver_name: String(row[2] ?? ''),
        type: String(row[3] ?? ''),
        amount: Number(String(row[4] ?? '0').replace(/,/g, '')) || 0,
      });
    }

    interface Agg {
      driver_code: string;
      driver_name: string;
      driver_id: string | null;
      deduction_rate: number;
      deduction_amount: number;
      days: Set<string>;
      count: number;
      quantity: number;
      revenue: number;
      vehicle_day_dates: Set<string>;
    }
    const ensure = (map: Map<string, Agg>, code: string, name: string): Agg => {
      const key = code || name;
      let a = map.get(key);
      if (!a) {
        const profile = profileByName.get(name);
        a = {
          driver_code: code,
          driver_name: name,
          driver_id: profile?.id ?? null,
          deduction_rate: profile?.deduction_rate ?? 0,
          deduction_amount: 0,
          days: new Set(),
          count: 0,
          quantity: 0,
          revenue: 0,
          vehicle_day_dates: new Set(),
        };
        map.set(key, a);
      }
      return a;
    };

    const aggMap = new Map<string, Agg>();
    for (const r of deliveries) {
      const a = ensure(aggMap, r.driver_code, r.driver_name);
      a.days.add(r.work_date);
      a.count += 1;
      a.quantity += r.quantity || 0;
      const vehAmount = vehicleDayMap.get(mdKey(r.work_date));
      if (vehAmount !== undefined) {
        // 車建日: per-day, control off, added later
        a.vehicle_day_dates.add(r.work_date);
      } else {
        a.revenue += r.amount || 0;
        const rate = getRateOn(a.driver_id, r.work_date, a.deduction_rate);
        a.deduction_amount += Math.round(((r.amount || 0) * rate) / 100);
      }
    }
    for (const a of aggMap.values()) {
      for (const d of a.vehicle_day_dates) {
        const amount = vehicleDayMap.get(mdKey(d)) ?? 0;
        a.revenue += amount; // 控除対象外
      }
    }
    for (const f of forms) {
      const a = ensure(aggMap, '', f.driver_name);
      a.days.add(f.work_date);
      a.revenue += f.amount;
      if (formAdjustment(f.type) === 'kodate') {
        const rate = getRateOn(a.driver_id, f.work_date, a.deduction_rate);
        a.deduction_amount += Math.round((f.amount * rate) / 100);
      }
    }

    let revenue = 0, deductionTotal = 0;
    for (const a of aggMap.values()) {
      revenue += a.revenue;
      deductionTotal += a.deduction_amount;
    }
    const driver_payment = revenue - deductionTotal;
    const payment = driver_payment + employee_salary_total;
    const profit = deductionTotal - employee_salary_total;
    const profit_rate = revenue > 0 ? (profit / revenue) * 100 : 0;
    const invoice = Math.round(revenue * 1.1);

    return json({
      period: { from, to },
      revenue,
      payment,
      driver_payment,
      employee_salary_total,
      employee_count,
      profit,
      profit_rate,
      invoice,
      driver_count: aggMap.size,
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
