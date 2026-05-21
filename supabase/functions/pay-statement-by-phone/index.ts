import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface Payload {
  phone?: string;
  year_month?: string;
}

function normalizePhone(s: string): string {
  if (!s) return '';
  return s
    .replace(/[０-９]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30),
    )
    .replace(/[^\d]/g, '');
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = (await req.json().catch(() => ({}))) as Payload;
    const phoneInput = normalizePhone(body.phone ?? '');
    const ym = (body.year_month ?? '').trim();
    if (!phoneInput) return json({ error: 'phone required' }, 400);
    if (!/^\d{4}-\d{2}$/.test(ym))
      return json({ error: 'year_month required (YYYY-MM)' }, 400);
    const [yStr, mStr] = ym.split('-');
    const year = Number(yStr);
    const month = Number(mStr);

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: profiles, error: pErr } = await admin
      .from('profiles')
      .select('id, full_name, phone, business_type, company_name, office_id')
      .not('phone', 'is', null);
    if (pErr) return json({ error: 'profiles fetch failed: ' + pErr.message }, 500);

    const matched = (profiles ?? []).filter(
      (p) => normalizePhone(String(p.phone ?? '')) === phoneInput,
    );
    if (matched.length === 0) {
      return json({ source: 'askul', found: false, reason: 'phone_not_registered' });
    }

    const driverIds = matched.map((p) => p.id);
    const { data: stmts, error: sErr } = await admin
      .from('closed_payment_statements')
      .select('*')
      .in('driver_id', driverIds)
      .eq('year', year)
      .eq('month', month);
    if (sErr) return json({ error: 'statements fetch failed: ' + sErr.message }, 500);

    const rows = (stmts ?? []).map((s) => ({
      driver_id: s.driver_id,
      driver_name: s.driver_snapshot?.full_name ?? '',
      company_name: s.driver_snapshot?.company_name ?? null,
      business_type: s.driver_snapshot?.business_type ?? null,
      revenue: s.revenue,
      kodate_total: s.kodate_total,
      vehicle_total: s.vehicle_total,
      deduction_rate: s.deduction_rate,
      deduction_amount: s.deduction_amount,
      payment_amount: s.payment_amount,
      daily_rows: s.daily_rows,
      finalized_at: s.finalized_at,
      modified_at: s.modified_at,
    }));

    return json({
      source: 'askul',
      found: rows.length > 0,
      year,
      month,
      matched_profiles: matched.map((p) => ({
        id: p.id,
        full_name: p.full_name,
        company_name: p.company_name,
        business_type: p.business_type,
      })),
      statements: rows,
    });
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
});
