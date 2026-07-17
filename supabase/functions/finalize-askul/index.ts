// アスクル支払明細書のサーバ側自動確定。ClosingPage.tsx の aggregates+finalize を 1:1 移植。
// Google SA署名で2シート(DETA貼り付け=配送実績 / フォームの回答 1=特別日当)を読み、
// DB(vehicle_days/profiles/offices/driver_deduction_rates/delivery_swaps)と合算 → closed_payment_statements へ upsert。
// - mode:'finalize'(既定/dry_run可): 計算し確定。dry_run既定でレビュー安全。
// - mode:'reflect': 当月 reflected_at セット(ビューア/会計に表示解禁)。
// 締めサイクル=前月21〜当月20。cadence: 25日確定 / 月末反映(cron)。書込は service_role bearer or cron_secret。
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

const SHEET_ID = '1Wh280_jyUFOCjsd1XrBNMbEXCiVwcJ1pvGdYEEi8LOY';
const SA = JSON.parse(Deno.env.get('GOOGLE_SERVICE_ACCOUNT_KEY')!);
const ALERT_URL = Deno.env.get('SHIFT_ALERT_URL') ?? 'https://nccognptoprhwsbjnwcu.supabase.co/functions/v1/shift-alert';
const NEXPORT_ANON = Deno.env.get('NEXPORT_ANON_KEY') ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5jY29nbnB0b3ByaHdzYmpud2N1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzNDU0NDEsImV4cCI6MjA4OTkyMTQ0MX0.M3h31uPyKYWlNevVW3OvZOonoTidC1KLZ04sB5nRKzU';

const PRICE_CATEGORY_NAMES: Record<number, string> = {
  4: 'オリコン蓋', 9: 'オリコン', 10: '段ボール', 100: 'カタログ・トナー・サンゲッツ・花',
  201: '通常配達・返品', 220: 'ブックオフ', 326: 'ウォーターサーバー', 351: '代引き',
};

// ── Google Service Account 署名(RS256) → Sheets read (fetch-delivery-records と同一) ──
function b64url(s: string): string { return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    iss: SA.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }));
  const pemBody = SA.private_key.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\s/g, '');
  const binaryDer = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', binaryDer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${payload}`));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${header}.${payload}.${sigB64}`,
  });
  return (await r.json()).access_token;
}
async function readSheet(saToken: string, sheetName: string, range: string, render: string): Promise<(string | number)[][]> {
  const url = 'https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(SHEET_ID) +
    '/values/' + encodeURIComponent(`${sheetName}!${range}`) + `?majorDimension=ROWS&valueRenderOption=${render}`;
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + saToken } });
  if (!res.ok) throw new Error(`Sheets ${res.status}: ${await res.text()}`);
  return ((await res.json()).values ?? []) as (string | number)[][];
}

// ── 型 & ヘルパ(ClosingPage と同一) ──
interface DeliveryRow { driver_code: string; driver_name: string; work_date: string; quantity: number; unit_price: number; amount: number; }
interface FormRow { work_date: string; driver_name: string; type: string; amount: number; }
function normalizeDriverName(n: unknown): string { return String(n ?? '').replace(/[\s　]+/g, ' ').trim(); }
function mdKey(workDate: string): string { return workDate.slice(5); }
function fmtDate(d: Date): string { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function normFormDate(s: string): string { const m = String(s).match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/); return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : String(s); }
// 締め当月(year_month) → {from: 前月21, to: 当月20}
function cycleFromClosing(y: number, m: number): { from: string; to: string } {
  return { from: fmtDate(new Date(y, m - 2, 21)), to: fmtDate(new Date(y, m - 1, 20)) };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    const mode = body.mode === 'reflect' ? 'reflect' : 'finalize';
    const dryRun = mode === 'finalize' && body.dry_run !== false;
    const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey);

    let authorized = bearer === serviceKey;
    if (!authorized && body.cron_secret) {
      const { data: cs } = await admin.from('automation_config').select('value').eq('key', 'cron_secret').maybeSingle();
      authorized = !!(cs?.value && cs.value === String(body.cron_secret));
    }
    if (!dryRun && !authorized) return json({ error: '書込(確定/反映)は権限がありません。cron/管理者のみ。', code: 'FORBIDDEN' }, 403);

    if (!/^\d{4}-\d{2}$/.test(String(body.year_month ?? ''))) return json({ error: 'year_month (締め当月 YYYY-MM) が必要です' }, 400);
    const year = Number(String(body.year_month).slice(0, 4));
    const month = Number(String(body.year_month).slice(5, 7));
    const { from: dateFrom, to: dateTo } = cycleFromClosing(year, month);

    // 反映(reflect): シート不要
    if (mode === 'reflect') {
      const { data: upd, error } = await admin.from('closed_payment_statements')
        .update({ reflected_at: new Date().toISOString() })
        .eq('year', year).eq('month', month).is('reflected_at', null).select('driver_id');
      if (error) return json({ error: 'reflect failed: ' + error.message }, 500);
      return json({ ok: true, mode: 'reflect', year, month, reflected: (upd ?? []).length });
    }

    // ── データ取得: 2シート(SA) + DB各表 ──
    const saToken = await getAccessToken();
    const [recRaw, formRaw, { data: vehData }, { data: profiles }, { data: offices }, { data: rateRows }, { data: swaps }] = await Promise.all([
      readSheet(saToken, 'DETA貼り付け', 'A2:P', 'UNFORMATTED_VALUE'),
      readSheet(saToken, 'フォームの回答 1', 'A2:G', 'FORMATTED_VALUE'),
      admin.from('vehicle_days').select('month, day, amount').eq('active', true),
      admin.from('profiles').select('id, full_name, office_id, business_type, company_name, deduction_rate'),
      admin.from('offices').select('id, name'),
      admin.from('driver_deduction_rates').select('driver_id, effective_from, deduction_rate').order('effective_from'),
      admin.from('delivery_swaps').select('from_driver_name, to_driver_name, to_driver_code, period_from, period_to').is('reverted_at', null),
    ]);

    const records: DeliveryRow[] = (recRaw ?? []).filter((row) => row.length > 0 && row[5]).map((row) => {
      const rawDate = String(row[5] ?? '');
      const workDate = rawDate.length === 8 ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}` : rawDate;
      return { driver_code: String(row[1] ?? ''), driver_name: String(row[2] ?? ''), work_date: workDate, quantity: Number(row[13] ?? 0), unit_price: Number(row[14] ?? 0), amount: Number(row[15] ?? 0) };
    });
    const formResponses: FormRow[] = (formRaw ?? []).filter((row) => row.length > 0 && row[1] && row[2]).map((row) => ({
      work_date: normFormDate(String(row[1] ?? '')), driver_name: String(row[2] ?? ''), type: String(row[3] ?? ''), amount: Number(String(row[4] ?? '0').replace(/,/g, '')) || 0,
    }));

    // vehicleDayMap: "MM-DD" -> amount
    const vehicleDayMap = new Map<string, number>();
    for (const v of (vehData ?? []) as any[]) vehicleDayMap.set(`${String(v.month).padStart(2, '0')}-${String(v.day).padStart(2, '0')}`, Number(v.amount));
    // 控除率履歴 driver_id -> [{effective_from, deduction_rate}](昇順)
    const rateHist = new Map<string, { effective_from: string; deduction_rate: number }[]>();
    for (const r of (rateRows ?? []) as any[]) { const a = rateHist.get(r.driver_id) ?? []; a.push({ effective_from: r.effective_from, deduction_rate: Number(r.deduction_rate) }); rateHist.set(r.driver_id, a); }
    for (const [, a] of rateHist) a.sort((x, y) => x.effective_from.localeCompare(y.effective_from));
    const getRateOn = (driverId: string | null, date: string, fallback: number): number => {
      if (!driverId) return fallback;
      const hist = rateHist.get(driverId); if (!hist || !hist.length) return fallback;
      let rate = fallback; for (const h of hist) { if (h.effective_from <= date) rate = h.deduction_rate; else break; } return rate;
    };
    const officeName = new Map<string, string>(); for (const o of (offices ?? []) as any[]) officeName.set(o.id, o.name);

    // ── アグリゲーション(ClosingPage 240-383 を移植) ──
    interface Agg {
      driver_code: string; driver_name: string; driver_id: string | null; deduction_rate: number; deduction_amount: number;
      revenue: number; invoice_revenue: number; master_vehicle: number;
      vehicle_day_dates: Set<string>; vehicle_day_amounts: Map<string, number>;
      rows: DeliveryRow[]; formRows: FormRow[];
    }
    const inRange = (d: string) => (!dateFrom || d >= dateFrom) && (!dateTo || d <= dateTo);
    const filtered = records.filter((r) => r.work_date && inRange(r.work_date));
    const filteredForm = formResponses.filter((f) => f.work_date && inRange(f.work_date));

    const driverCodeByName = new Map<string, string>();
    for (const r of records) { if (!r.driver_code) continue; const k = normalizeDriverName(r.driver_name); if (k && !driverCodeByName.has(k)) driverCodeByName.set(k, r.driver_code); }

    const map = new Map<string, Agg>();
    const ensure = (driverCode: string, driverName: string): Agg => {
      const normName = normalizeDriverName(driverName);
      const resolvedCode = driverCode || driverCodeByName.get(normName) || '';
      const key = resolvedCode || normName;
      let agg = map.get(key);
      if (!agg) {
        const profile = (profiles ?? []).find((p: any) => normalizeDriverName(p.full_name) === normName);
        agg = {
          driver_code: resolvedCode, driver_name: normName, driver_id: profile?.id ?? null,
          deduction_rate: Number(profile?.deduction_rate ?? 0), deduction_amount: 0,
          revenue: 0, invoice_revenue: 0, master_vehicle: 0,
          vehicle_day_dates: new Set(), vehicle_day_amounts: new Map(), rows: [], formRows: [],
        };
        map.set(key, agg);
      }
      return agg;
    };
    const applySwap = (r: DeliveryRow): DeliveryRow => {
      const swap = (swaps ?? []).find((s: any) => normalizeDriverName(s.from_driver_name) === normalizeDriverName(r.driver_name) && r.work_date >= s.period_from && r.work_date <= s.period_to);
      return swap ? { ...r, driver_name: swap.to_driver_name, driver_code: swap.to_driver_code } : r;
    };
    const baseByRateByAgg = new Map<Agg, Map<number, number>>();
    const addBase = (agg: Agg, rate: number, amount: number) => { let m = baseByRateByAgg.get(agg); if (!m) { m = new Map(); baseByRateByAgg.set(agg, m); } m.set(rate, (m.get(rate) ?? 0) + amount); };

    for (const r of filtered) {
      const aggInvoice = ensure(r.driver_code, r.driver_name);
      aggInvoice.invoice_revenue += r.amount || 0;
      const rPay = applySwap(r);
      const aggPay = ensure(rPay.driver_code, rPay.driver_name);
      aggPay.rows.push(rPay);
      const vehAmount = vehicleDayMap.get(mdKey(rPay.work_date));
      if (vehAmount !== undefined) {
        aggPay.vehicle_day_dates.add(rPay.work_date);
        aggPay.vehicle_day_amounts.set(rPay.work_date, vehAmount);
      } else {
        aggPay.revenue += rPay.amount || 0;
        const rate = getRateOn(aggPay.driver_id, rPay.work_date, aggPay.deduction_rate);
        addBase(aggPay, rate, rPay.amount || 0);
      }
    }
    for (const agg of map.values()) {
      for (const d of agg.vehicle_day_dates) { const amount = vehicleDayMap.get(mdKey(d)) ?? 0; agg.master_vehicle += amount; agg.revenue += amount; }
    }
    for (const f of filteredForm) {
      const agg = ensure('', f.driver_name);
      agg.formRows.push(f); agg.revenue += f.amount;
    }
    for (const a of map.values()) {
      a.deduction_rate = getRateOn(a.driver_id, dateTo, a.deduction_rate);
      const baseByRate = baseByRateByAgg.get(a);
      if (baseByRate) { let dedTotal = 0; for (const [rate, amount] of baseByRate) dedTotal += Math.round((amount * rate) / 100); a.deduction_amount = dedTotal; }
    }

    // ── 日別明細 + 件数明細(ClosingPage buildDailyRows/buildCategoryMatrix) ──
    const eachDate = (): Date[] => { const out: Date[] = []; const cur = new Date(dateFrom); const end = new Date(dateTo); while (cur <= end) { out.push(new Date(cur)); cur.setDate(cur.getDate() + 1); } return out; };
    const buildDailyRows = (agg: Agg) => {
      const byDate = new Map<string, DeliveryRow[]>(); for (const r of agg.rows) { const a = byDate.get(r.work_date) ?? []; a.push(r); byDate.set(r.work_date, a); }
      const formByDate = new Map<string, FormRow[]>(); for (const f of agg.formRows) { const a = formByDate.get(f.work_date) ?? []; a.push(f); formByDate.set(f.work_date, a); }
      return eachDate().map((d) => {
        const ds = fmtDate(d); const rs = byDate.get(ds) ?? []; const formAdds = formByDate.get(ds) ?? [];
        const isMasterVehicleDay = agg.vehicle_day_dates.has(ds);
        const masterVehicle = isMasterVehicleDay ? agg.vehicle_day_amounts.get(ds) ?? 0 : 0;
        const kodateBase = isMasterVehicleDay ? 0 : rs.reduce((s, r) => s + (r.amount || 0), 0);
        const formVehicle = formAdds.reduce((s, f) => s + f.amount, 0); // フォームは全額車建扱い(formAdjustment=vehicle)
        const kodate = kodateBase; // formKodate は常に0
        const vehicle = masterVehicle + formVehicle;
        const qty = rs.reduce((s, r) => s + (r.quantity || 0), 0);
        return { date: ds, day_of_week: d.getDay(), kodate, vehicle, count: qty, subtotal: kodate + vehicle };
      });
    };
    const buildCategoryMatrix = (agg: Agg) => {
      const priceSet = new Set<number>(); for (const r of agg.rows) priceSet.add(r.unit_price);
      const prices = Array.from(priceSet).sort((a, b) => a - b);
      const rows = eachDate().map((d) => {
        const ds = fmtDate(d); const counts: Record<string, number> = {}; for (const p of prices) counts[p] = 0;
        for (const r of agg.rows) if (r.work_date === ds) counts[r.unit_price] = (counts[r.unit_price] ?? 0) + (r.quantity || 0);
        return { date: ds, dow: d.getDay(), counts };
      });
      const totals: Record<string, number> = {}; for (const p of prices) totals[p] = rows.reduce((s, r) => s + (r.counts[p] ?? 0), 0);
      const applied_total = prices.reduce((s, p) => s + (totals[p] ?? 0) * p, 0);
      const labels: Record<string, string> = {}; for (const p of prices) labels[p] = PRICE_CATEGORY_NAMES[p] ?? `¥${p}区分`;
      return { prices, labels, rows, totals, applied_total };
    };

    // ── 確定行 ──
    const nowIso = new Date().toISOString();
    const allAggs = Array.from(map.values());
    const eligible = allAggs.filter((a) => a.driver_id);
    const results = eligible.map((agg) => {
      const daily = buildDailyRows(agg);
      const kodate_total = daily.reduce((s, r) => s + r.kodate, 0);
      const vehicle_total = daily.reduce((s, r) => s + r.vehicle, 0);
      const revenue = kodate_total + vehicle_total;
      const profile = (profiles ?? []).find((p: any) => p.id === agg.driver_id);
      return {
        driver_id: agg.driver_id!, year, month, revenue, kodate_total, vehicle_total,
        deduction_rate: agg.deduction_rate, deduction_amount: agg.deduction_amount,
        payment_amount: revenue - agg.deduction_amount,
        daily_rows: daily, category_matrix: buildCategoryMatrix(agg),
        driver_snapshot: profile ? { full_name: profile.full_name, office_id: profile.office_id, office_name: officeName.get(profile.office_id) ?? null, business_type: profile.business_type, company_name: profile.company_name } : null,
        _name: agg.driver_name,
      };
    });
    results.sort((a, b) => b.payment_amount - a.payment_amount);
    const grand = { revenue: results.reduce((s, r) => s + r.revenue, 0), payment: results.reduce((s, r) => s + r.payment_amount, 0) };

    // 未登録(シート稼働あり・profile未紐付け) → NexPort アラート
    const unregistered = allAggs.filter((a) => !a.driver_id && (a.revenue > 0 || a.invoice_revenue > 0)).map((a) => a.driver_name);
    let alertResult: any = null;
    try {
      const ar = await fetch(ALERT_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + NEXPORT_ANON, 'apikey': NEXPORT_ANON },
        body: JSON.stringify({ action: 'sync', app: 'shift-manager', kind: 'askul_unregistered', month: `${year}-${String(month).padStart(2, '0')}`, names: unregistered }),
      });
      alertResult = await ar.json().catch(() => ({ status: ar.status }));
    } catch (e) { alertResult = { error: String((e as Error)?.message || e) }; }

    const summary = results.map((r) => ({ name: r._name, revenue: r.revenue, kodate_total: r.kodate_total, vehicle_total: r.vehicle_total, deduction_rate: r.deduction_rate, deduction_amount: r.deduction_amount, payment_amount: r.payment_amount }));

    if (dryRun) {
      return json({ ok: true, dry_run: true, year, month, period: { from: dateFrom, to: dateTo }, count: results.length, grand, drivers: summary, unregistered, alert: alertResult });
    }

    // 反映済みロック + upsert
    const { data: existing } = await admin.from('closed_payment_statements').select('driver_id, reflected_at').eq('year', year).eq('month', month);
    const lockedIds = new Set((existing ?? []).filter((r: any) => r.reflected_at).map((r: any) => r.driver_id));
    const payload = results.filter((r) => !lockedIds.has(r.driver_id)).map((r) => ({
      driver_id: r.driver_id, year, month, revenue: r.revenue, kodate_total: r.kodate_total, vehicle_total: r.vehicle_total,
      deduction_rate: r.deduction_rate, deduction_amount: r.deduction_amount, payment_amount: r.payment_amount,
      daily_rows: r.daily_rows, category_matrix: r.category_matrix, driver_snapshot: r.driver_snapshot,
      finalized_at: nowIso, reflected_at: null,
    }));
    const lockedCount = results.length - payload.length;
    if (payload.length === 0) return json({ ok: true, dry_run: false, saved: 0, locked: lockedCount, year, month, note: lockedCount ? '対象月は反映済み(ロック)' : '対象ドライバーなし', unregistered, alert: alertResult });
    const { error } = await admin.from('closed_payment_statements').upsert(payload, { onConflict: 'driver_id,year,month' });
    if (error) return json({ error: 'upsert failed: ' + error.message }, 500);
    return json({ ok: true, dry_run: false, saved: payload.length, locked: lockedCount, year, month, grand, drivers: summary, unregistered, alert: alertResult });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
