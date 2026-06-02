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
const SERVICE_ACCOUNT = JSON.parse(Deno.env.get('GOOGLE_SERVICE_ACCOUNT_KEY')!);

function b64url(s: string): string { return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    iss: SERVICE_ACCOUNT.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  }));
  const pemBody = SERVICE_ACCOUNT.private_key.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\s/g, '');
  const binaryDer = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', binaryDer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${payload}`));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const jwt = `${header}.${payload}.${sigB64}`;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  return (await r.json()).access_token;
}

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
// ドライバー名の正規化 (全角/半角スペースのゆらぎ吸収) — ClosingPage と統一
function normalizeDriverName(name: string | undefined | null): string {
  return (name ?? '').replace(/[\s　]+/g, ' ').trim();
}
// 特別日当 (フォーム入力) は種別問わず全て車建扱い (控除対象外) — ClosingPage と統一。
// 旧ロジックは "個建" を含む種別に控除をかけていたが、 ClosingPage が全車建に変更済みのため追従。

async function fetchSheet(range: string, token: string): Promise<(string | number)[][]> {
  const url =
    'https://sheets.googleapis.com/v4/spreadsheets/' +
    encodeURIComponent(SPREADSHEET_ID) +
    '/values/' +
    encodeURIComponent(range) +
    '?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE';
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
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

    // 確定済み支払明細の年月キー (ClosingPage の「支払明細書を確定」と同じく 期間終了日の年月)
    const closedYear = parseInt(to.slice(0, 4));
    const closedMonth = parseInt(to.slice(5, 7));

    const gToken = await getAccessToken();
    const [deliveryValues, formValues, profilesRes, vehicleDaysRes, ratesRes, swapsRes, closedRes] = await Promise.all([
      fetchSheet(DELIVERY_RANGE, gToken),
      fetchSheet(FORM_RANGE, gToken),
      admin.from('profiles').select('id, full_name, deduction_rate, business_type, monthly_salary, active'),
      admin.from('vehicle_days').select('month, day, amount').eq('active', true),
      admin.from('driver_deduction_rates').select('driver_id, effective_from, deduction_rate').order('effective_from'),
      admin.from('delivery_swaps').select('from_driver_name, to_driver_name, to_driver_code, period_from, period_to').is('reverted_at', null),
      admin.from('closed_payment_statements').select('payment_amount, deduction_amount').eq('year', closedYear).eq('month', closedMonth),
    ]);
    const closedRows = (closedRes.data ?? []) as { payment_amount: number; deduction_amount: number }[];

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
    const swaps = (swapsRes.data ?? []) as { from_driver_name: string; to_driver_name: string; to_driver_code: string; period_from: string; period_to: string }[];

    // 正規化名でプロファイル照合 (ClosingPage と統一)
    const profileByName = new Map<string, { id: string; deduction_rate: number }>();
    for (const p of profiles) {
      profileByName.set(normalizeDriverName(p.full_name), { id: p.id, deduction_rate: Number(p.deduction_rate ?? 0) });
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
      revenue: number;
      vehicle_day_dates: Set<string>;
    }

    // records(配送実績) から 正規化名 → driver_code の逆引き (フォーム入力で code 空でも統合するため)
    const driverCodeByName = new Map<string, string>();
    for (const r of deliveries) {
      if (!r.driver_code) continue;
      const k = normalizeDriverName(r.driver_name);
      if (k && !driverCodeByName.has(k)) driverCodeByName.set(k, r.driver_code);
    }

    const ensure = (map: Map<string, Agg>, code: string, name: string): Agg => {
      const normName = normalizeDriverName(name);
      const resolvedCode = code || driverCodeByName.get(normName) || '';
      const key = resolvedCode || normName;
      let a = map.get(key);
      if (!a) {
        const profile = profileByName.get(normName);
        a = {
          driver_code: resolvedCode,
          driver_name: normName,
          driver_id: profile?.id ?? null,
          deduction_rate: profile?.deduction_rate ?? 0,
          deduction_amount: 0,
          revenue: 0,
          vehicle_day_dates: new Set(),
        };
        map.set(key, a);
      }
      return a;
    };

    // swap (振り替え) 適用: 該当行は driver_name/code を先ドライバーに書き換え (ClosingPage と統一)
    const applySwap = (r: DeliveryRow): DeliveryRow => {
      const swap = swaps.find((s) =>
        normalizeDriverName(s.from_driver_name) === normalizeDriverName(r.driver_name) &&
        r.work_date >= s.period_from &&
        r.work_date <= s.period_to,
      );
      if (swap) return { ...r, driver_name: swap.to_driver_name, driver_code: swap.to_driver_code };
      return r;
    };

    // 控除は行ごとに round せず、 率ごとに合算 → ×率 → round (累積誤差を避ける、 ClosingPage と統一)
    const baseByRateByAgg = new Map<Agg, Map<number, number>>();
    const addBase = (agg: Agg, rate: number, amount: number) => {
      let m = baseByRateByAgg.get(agg);
      if (!m) { m = new Map<number, number>(); baseByRateByAgg.set(agg, m); }
      m.set(rate, (m.get(rate) ?? 0) + amount);
    };

    // 売上は2系統:
    //   revenue_invoice: アスクル請求ベース = シートP列の単純合計 (swap 影響なし)
    //   revenue_payment: ドライバー支払いベース = 車建日マスタ置換 + フォーム加算 (swap 適用後)
    let revenue_invoice = 0;
    const aggMap = new Map<string, Agg>();
    for (const r of deliveries) {
      revenue_invoice += r.amount || 0; // 請求側: シート原データそのまま
      const rPay = applySwap(r);        // 支払側: 先ドライバーに付け替え
      const a = ensure(aggMap, rPay.driver_code, rPay.driver_name);
      const vehAmount = vehicleDayMap.get(mdKey(rPay.work_date));
      if (vehAmount !== undefined) {
        a.vehicle_day_dates.add(rPay.work_date); // 車建日: 後段で日単位 1 回だけ加算 (控除対象外)
      } else {
        a.revenue += rPay.amount || 0;
        const rate = getRateOn(a.driver_id, rPay.work_date, a.deduction_rate);
        addBase(a, rate, rPay.amount || 0);
      }
    }
    for (const a of aggMap.values()) {
      for (const d of a.vehicle_day_dates) {
        a.revenue += vehicleDayMap.get(mdKey(d)) ?? 0; // 控除対象外
      }
    }
    for (const f of forms) {
      const a = ensure(aggMap, '', f.driver_name);
      a.revenue += f.amount; // フォームは全て車建扱い → 控除なし (ClosingPage と統一)
    }
    // 控除額: 率ごとに合算してから round
    for (const a of aggMap.values()) {
      const baseByRate = baseByRateByAgg.get(a);
      if (baseByRate) {
        let ded = 0;
        for (const [rate, amount] of baseByRate) ded += Math.round((amount * rate) / 100);
        a.deduction_amount = ded;
      }
    }

    // ライブ集計 (確定前の月のフォールバック用)
    let liveRevenuePayment = 0, liveDeduction = 0;
    for (const a of aggMap.values()) {
      liveRevenuePayment += a.revenue;
      liveDeduction += a.deduction_amount;
    }
    const liveDriverPayment = liveRevenuePayment - liveDeduction;

    // ★ ドライバー支払いは「支払明細書を確定」で保存済みの closed_payment_statements を最優先。
    //   確定データが唯一の正解 (ライブ再計算は swap/控除/丸めの微差で ClosingPage とズレるため)。
    //   未確定の月のみライブ集計にフォールバック。
    let driver_payment: number;
    let driver_count: number;
    let source: 'confirmed' | 'live';
    if (closedRows.length > 0) {
      driver_payment = closedRows.reduce((s, r) => s + Number(r.payment_amount || 0), 0);
      driver_count = closedRows.length;
      source = 'confirmed';
    } else {
      driver_payment = liveDriverPayment;
      driver_count = aggMap.size;
      source = 'live';
    }

    const payment = driver_payment + employee_salary_total;
    // 利益 = アスクル請求 (税抜) - 全支払 (ドライバー + 社員)
    const profit = revenue_invoice - payment;
    const profit_rate = revenue_invoice > 0 ? (profit / revenue_invoice) * 100 : 0;
    const invoice = Math.round(revenue_invoice * 1.1);

    return json({
      period: { from, to },
      revenue: revenue_invoice,  // 画面「総売上(税抜)」 = アスクル請求の税抜 (シートP列ライブ集計)
      payment,
      driver_payment,
      employee_salary_total,
      employee_count,
      profit,
      profit_rate,
      invoice,
      driver_count,
      source,  // 'confirmed' = 確定データ使用 / 'live' = 未確定でライブ集計
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
