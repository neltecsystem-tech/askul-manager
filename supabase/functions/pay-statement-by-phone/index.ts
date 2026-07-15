// 統合明細ビューア / 会計・支払通知書 用: 電話番号 or 氏名 or 会社名 + 年月 でドライバーの月次明細を返す。
// closed_payment_statements(確定済み)を参照。氏名/会社名照合は管理者限定(NexPort JWTで認可)。
// 会計「支払通知書」別紙のために category_matrix(件数明細=2枚目) もそのまま返す。
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface Payload {
  phone?: string;
  name?: string;
  company?: string;
  year_month?: string;
  auth_token?: string;
}

function normalizePhone(s: string): string {
  if (!s) return '';
  return s.replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30)).replace(/[^\d]/g, '');
}

// 氏名/会社名の異体字(旧字体・許容字体)を代表字へ畳み込む。会計とツールで表記が違う同一人物を一致させる。
// 例: 斎藤=斉藤=齋藤, 髙橋=高橋, 山﨑=山崎, 澤田=沢田 など。
const ITAIJI: Record<string, string> = {
  '髙': '高', '﨑': '崎', '嵜': '崎', '斎': '斉', '齋': '斉', '齊': '斉',
  '邊': '辺', '邉': '辺', '澤': '沢', '濱': '浜', '濵': '浜', '廣': '広',
  '德': '徳', '惠': '恵', '槇': '槙', '冨': '富', '峯': '峰', '舘': '館',
  '曾': '曽', '桒': '桑', '渕': '淵', '淸': '清', '靑': '青', '眞': '真',
  '圓': '円', '假': '仮', '國': '国', '瀨': '瀬', '增': '増', '莊': '荘',
  '禮': '礼',
};
// 氏名キー: NFKC正規化 + 空白除去 + 異体字畳み込み。
function nmKey(s: string): string {
  const t = String(s ?? '').normalize('NFKC').replace(/[\s　]/g, '');
  let out = '';
  for (const ch of t) out += ITAIJI[ch] ?? ch;
  return out;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

// NexPort 経由で caller 認証
async function authorizeCaller(authToken: string | undefined): Promise<any | null> {
  if (!authToken) return null;
  const nexportUrl = Deno.env.get('NEXPORT_SUPABASE_URL') || '';
  const nexportKey = Deno.env.get('NEXPORT_SERVICE_ROLE_KEY') || '';
  if (!nexportUrl || !nexportKey) return null;
  const nx = createClient(nexportUrl, nexportKey);
  const { data: { user }, error } = await nx.auth.getUser(authToken);
  if (error || !user) return null;
  const { data: profile } = await nx
    .from('profiles')
    .select('id, role, phone, is_company_owner, company')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile) return null;
  return {
    user_id: user.id,
    role: profile.role || '',
    phone: normalizePhone(profile.phone || ''),
    is_company_owner: !!profile.is_company_owner,
    company: profile.company || '',
    nx,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = (await req.json().catch(() => ({}))) as Payload;
    const phoneInput = normalizePhone(body.phone ?? '');
    const nameInput = (body.name ?? '').trim();
    const companyInput = (body.company ?? '').trim();
    const ym = (body.year_month ?? '').trim();
    if (!phoneInput && !nameInput && !companyInput) return json({ error: 'phone, name or company required' }, 400);
    if (!/^\d{4}-\d{2}$/.test(ym)) return json({ error: 'year_month required (YYYY-MM)' }, 400);

    const caller = await authorizeCaller(body.auth_token);
    if (!caller) return json({ error: 'auth required', code: 'AUTH_REQUIRED' }, 401);
    const isAdmin = caller.role === 'admin' || caller.role === 'super_admin';
    // 法人=会社名で照合 / 個人=氏名 or 電話。氏名・会社名照合は管理者限定。
    const byCompany = !phoneInput && !nameInput && !!companyInput;
    const byName = !phoneInput && !!nameInput && !companyInput;
    if ((byName || byCompany) && !isAdmin) return json({ error: 'forbidden (name/company lookup is admin only)', code: 'FORBIDDEN' }, 403);
    if (!isAdmin && !byName && !byCompany) {
      if (phoneInput !== caller.phone) {
        if (!caller.is_company_owner) return json({ error: 'forbidden', code: 'FORBIDDEN' }, 403);
        const { data: target } = await caller.nx.from('profiles').select('company').eq('phone', phoneInput).maybeSingle();
        if (!target?.company || target.company !== caller.company) {
          return json({ error: 'forbidden', code: 'FORBIDDEN' }, 403);
        }
      }
    }

    const [yStr, mStr] = ym.split('-');
    const year = Number(yStr);
    const month = Number(mStr);
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: profiles, error: pErr } = await admin
      .from('profiles')
      .select('id, full_name, phone, business_type, company_name, office_id');
    if (pErr) return json({ error: 'profiles fetch failed: ' + pErr.message }, 500);

    const nkey = nmKey(nameInput);
    const ckey = nmKey(companyInput);
    const matched = byCompany
      ? (profiles ?? []).filter((p) => ckey && nmKey(String(p.company_name ?? '')).includes(ckey))
      : byName
      ? (profiles ?? []).filter((p) => nmKey(String(p.full_name ?? '')) === nkey)
      : (profiles ?? []).filter((p) => normalizePhone(String(p.phone ?? '')) === phoneInput);
    if (matched.length === 0) {
      return json({ source: 'askul', found: false, reason: byCompany ? 'company_not_found' : byName ? 'name_not_found' : 'phone_not_registered' });
    }
    // askul 側で 'corporation' (法人配下ドライバー) と判定された場合は明細を出さない
    const matchedBizTypes = matched.map((p) => p.business_type);
    const askulCorpSub = matchedBizTypes.length > 0 && matchedBizTypes.every((bt) => bt === 'corporation');
    if (askulCorpSub && !isAdmin) {
      return json({ source: 'askul', found: false, reason: 'corp_sub_no_statement', matched_profiles: matched.map((p) => ({ id: p.id, full_name: p.full_name })) });
    }
    const driverIds = matched.map((p) => p.id);
    const { data: stmts, error: sErr } = await admin
      .from('closed_payment_statements')
      .select('*')
      .in('driver_id', driverIds)
      .eq('year', year)
      .eq('month', month);
    if (sErr) return json({ error: 'statements fetch failed: ' + sErr.message }, 500);
    const rows = (stmts ?? []).map((s: any) => ({
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
      category_matrix: s.category_matrix ?? null,
      finalized_at: s.finalized_at,
      modified_at: s.modified_at,
    }));
    return json({
      source: 'askul',
      found: rows.length > 0,
      year,
      month,
      matched_profiles: matched.map((p) => ({ id: p.id, full_name: p.full_name, company_name: p.company_name, business_type: p.business_type })),
      statements: rows,
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
