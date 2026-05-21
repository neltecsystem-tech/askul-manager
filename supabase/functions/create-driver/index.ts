import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type BusinessType = 'sole_proprietor' | 'corporation' | 'corporation_owner' | 'employee';

interface Payload {
  email: string;
  password: string;
  full_name: string;
  deduction_rate?: number | null;
  office_id?: string | null;
  business_type?: BusinessType | null;
  company_name?: string | null;
  monthly_salary?: number | null;
  invoice_number?: string | null;
  phone?: string | null;
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
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: '認証情報がありません' }, 401);
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) return json({ error: '認証情報がありません' }, 401);

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: userData, error: getUserErr } = await admin.auth.getUser(token);
    if (getUserErr || !userData.user) return json({ error: '認証エラー' }, 401);

    const { data: caller } = await admin
      .from('profiles')
      .select('role, active')
      .eq('id', userData.user.id)
      .maybeSingle();
    if (!caller || caller.role !== 'admin' || !caller.active) {
      return json({ error: '管理者権限が必要です' }, 403);
    }

    const body = (await req.json()) as Payload;
    const email = body.email?.trim();
    const password = body.password;
    const full_name = body.full_name?.trim() ?? '';
    const deduction_rate = body.deduction_rate ?? null;
    const office_id = body.office_id || null;
    const business_type = body.business_type ?? null;
    const company_name_raw = body.company_name?.trim() ?? '';
    const company_name = (business_type === 'corporation' || business_type === 'corporation_owner') && company_name_raw ? company_name_raw : null;
    const monthly_salary = business_type === 'employee' ? (Number(body.monthly_salary) || 0) : 0;
    const invoice_number = body.invoice_number?.trim() || null;
    const phone = body.phone?.trim() || null;

    if (!email || !password || !full_name) {
      return json({ error: 'ID(メール) / パスワード / 氏名は必須です' }, 400);
    }
    if (password.length < 6) {
      return json({ error: 'パスワードは6文字以上必要です' }, 400);
    }

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name },
    });
    if (createErr || !created.user) {
      return json({ error: createErr?.message ?? 'ユーザー作成に失敗しました' }, 500);
    }

    const { error: updateErr } = await admin.from('profiles').update({
      full_name,
      deduction_rate,
      office_id,
      role: 'driver',
      active: true,
      business_type,
      company_name,
      monthly_salary,
      invoice_number,
      phone,
    }).eq('id', created.user.id);
    if (updateErr) {
      await admin.auth.admin.deleteUser(created.user.id);
      return json({ error: `プロフィール作成失敗: ${updateErr.message}` }, 500);
    }
    return json({ id: created.user.id });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
