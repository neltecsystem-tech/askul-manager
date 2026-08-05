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
  list_all?: boolean; // 管理者限定: 当月の全支払明細を返す(明細ビューアの取引先一覧用)
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
  '禮': '礼', 'ヶ': 'ケ', 'ヵ': 'カ',
};
// 氏名キー: NFKC正規化 + 空白除去 + 異体字畳み込み。
function nmKey(s: string): string {
  const t = String(s ?? '').normalize('NFKC').replace(/[\s　]/g, '');
  let out = '';
  for (const ch of t) out += ITAIJI[ch] ?? ch;
  return out;
}

// 会社名キー: nmKey に加えて法人格(株式会社/㈱/(株)等)と記号(・/中点/ハイフン/括弧)を除去し、
// ツール間の会社名表記ゆれ(半角㈱ vs 全角株式会社 等)を吸収する。会社名照合はこれで統一。
function coKey(s: string): string {
  return nmKey(s)
    .replace(/株式会社|有限会社|合同会社|合資会社|\(株\)|\(有\)|\(合\)|㈱|㈲/g, '')
    .replace(/[\s　・,，.。\-—–ー'"`（）()]/g, '')
    .toLowerCase();
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


// 🔒 公開タイミング = 支払通知メールの発行に合わせる(2026-08〜)。確定しただけの明細は本人にも見せない。
//   公開条件: ① 自分宛の支払通知が発行済み(NexPort pay_statement_acceptance.issued_at) または
//            ② 実績月の翌月11日 9:00 JST を過ぎた(=2回目の送信cron)。
//   ②は保険。支払0円・メール未登録・明細停止などで通知が出ない人が、いつまでも自分の明細を
//   見られなくなるのを防ぐ。管理者(admin/super_admin)は従来どおり常に閲覧できる。
const PUBLISH_MSG = 'この月の明細は、支払通知書の発行後に公開されます（毎月1日・11日の朝に発行）。もうしばらくお待ちください。';
function publishOpenAt(ym: string): number {
  const [y, m] = ym.split('-').map(Number);
  return Date.UTC(y, m, 11, 0, 0, 0); // 翌月11日 00:00 UTC = 09:00 JST
}
async function noticePublished(nx: any, profileId: string, ym: string): Promise<boolean> {
  if (Date.now() >= publishOpenAt(ym)) return true;
  if (!profileId) return false;
  const { data } = await nx.from('pay_statement_acceptance').select('issued_at').eq('month', ym).eq('profile_id', profileId).maybeSingle();
  return !!(data as any)?.issued_at;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = (await req.json().catch(() => ({}))) as Payload;
    const phoneInput = normalizePhone(body.phone ?? '');
    const nameInput = (body.name ?? '').trim();
    const companyInput = (body.company ?? '').trim();
    const ym = (body.year_month ?? '').trim();
    const listAll = body.list_all === true || (body.list_all as unknown) === 'true';
    if (!phoneInput && !nameInput && !companyInput && !listAll) return json({ error: 'phone, name or company required' }, 400);
    if (!/^\d{4}-\d{2}$/.test(ym)) return json({ error: 'year_month required (YYYY-MM)' }, 400);

    const caller = await authorizeCaller(body.auth_token);
    if (!caller) return json({ error: 'auth required', code: 'AUTH_REQUIRED' }, 401);
    const isAdmin = caller.role === 'admin' || caller.role === 'super_admin';
    // 表示対象月の制限: 統合ビューア/通知運用は2026年7月開始。それより前の月は非管理者に表示しない。
    if (ym < '2026-07' && !isAdmin && !listAll) return json({ source: 'askul', found: false, reason: 'month_not_available', message: '2026年7月分より前は表示対象外です' });
    // 🔒 公開は支払通知メールの発行に合わせる(確定しただけでは本人にも出さない)
    if (!listAll && !isAdmin && !(await noticePublished(caller.nx, caller.user_id, ym)))
      return json({ source: 'askul', found: false, reason: 'not_published', message: PUBLISH_MSG });
    // 🔒 明細ビューア ログイン許可: NexPort recipient_access.viewer_login=false の本人は閲覧不可(管理者は除外)。
    if (!isAdmin) {
      // 🔒 中央 login_access(meisai) で判定(明示停止/法人配下)。会計マトリクスに一本化。
      const chk = await fetch('https://nccognptoprhwsbjnwcu.supabase.co/functions/v1/check-login-access', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ system: 'meisai', profile_id: caller.user_id, source: 'viewer-askul' }),
      }).then((x) => x.json()).catch(() => null);
      if (chk && chk.allowed === false) {
        const corp = chk.reason === 'corp_sub_denied';
        return json({ error: corp ? '法人配下の方の明細は、法人のオーナー/担当者がご確認ください。' : 'この明細ビューアのご利用は停止されています。担当者にお問い合わせください。', code: corp ? 'CORP_SUB_DENIED' : 'VIEWER_DISABLED' }, 403);
      }
    }
    if (listAll && !isAdmin) return json({ error: 'forbidden (list_all is admin only)', code: 'FORBIDDEN' }, 403);
    // 法人=会社名で照合 / 個人=氏名 or 電話。氏名・会社名照合は管理者限定。
    const byCompany = !phoneInput && !nameInput && !!companyInput;
    const byName = !phoneInput && !!nameInput && !companyInput;
    // 氏名照合=管理者のみ。会社集計=管理者 or 自社オーナー/担当者(自社=会社名一致のみ)。
    if (byName && !isAdmin) return json({ error: 'forbidden (name lookup is admin only)', code: 'FORBIDDEN' }, 403);
    if (byCompany && !isAdmin) {
      let isOwnerOrContact = !!caller.is_company_owner;
      const companies: string[] = [];
      if (caller.company) companies.push(caller.company);
      // staff_master を 電話 or profile_id で照合(電話未登録のオーナー/担当でもアカウントで自社特定)。
      const smOr = [caller.phone ? `phone.eq.${caller.phone}` : '', caller.user_id ? `profile_id.eq.${caller.user_id}` : ''].filter(Boolean).join(',');
      if (smOr) {
        const { data: sms } = await caller.nx.from('staff_master').select('company_name, is_company_owner, is_company_contact').or(smOr);
        for (const sm of (sms ?? [])) { if ((sm as any).company_name) companies.push(String((sm as any).company_name)); if ((sm as any).is_company_owner || (sm as any).is_company_contact) isOwnerOrContact = true; }
      }
      const cKey = coKey(companyInput);
      const companyMatch = !!cKey && companies.some((c) => coKey(c) === cKey);
      if (!(isOwnerOrContact && companyMatch))
        return json({ error: 'forbidden (自社の会社集計のみ閲覧できます)', code: 'FORBIDDEN' }, 403);
    }
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

    if (listAll) {
      // 取引先一覧: 当月の確定明細(closed_payment_statements)を管理者へ返す。
      // ※ reflected_at ゲートは撤廃(2026-07): 確定済みなら即ビューア表示(会計はシート取込が正=別管理)。
      const { data: stmts, error: sErr } = await admin
        .from('closed_payment_statements')
        .select('*')
        .eq('year', year)
        .eq('month', month);
      if (sErr) return json({ error: 'statements fetch failed: ' + sErr.message }, 500);
      const phoneById = new Map((profiles ?? []).map((p: any) => [p.id, p.phone]));
      const rows = (stmts ?? []).map((s: any) => ({
        driver_id: s.driver_id,
        driver_name: s.driver_snapshot?.full_name ?? '',
        phone: phoneById.get(s.driver_id) ?? null,
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
      return json({ source: 'askul', found: rows.length > 0, year, month, statements: rows });
    }

    const nkey = nmKey(nameInput);
    const ckey = coKey(companyInput);
    const matched = byCompany
      ? (profiles ?? []).filter((p) => ckey && coKey(String(p.company_name ?? '')).includes(ckey))
      : byName
      ? (profiles ?? []).filter((p) => nmKey(String(p.full_name ?? '')) === nkey)
      : (profiles ?? []).filter((p) => normalizePhone(String(p.phone ?? '')) === phoneInput);
    if (matched.length === 0) {
      return json({ source: 'askul', found: false, reason: byCompany ? 'company_not_found' : byName ? 'name_not_found' : 'phone_not_registered' });
    }
    // askul 側で 'corporation' (法人配下ドライバー) と判定された本人(byPhone)は明細を出さない
    //  → 法人配下の明細はオーナー/担当が法人集計(byCompany)で確認する運用。
    //  ※ byCompany は上で「自社オーナー/担当＋会社名一致」を検証済みなので、配下(全員corporation)でも
    //    正当な閲覧としてブロックしない(オーナーが自分のaskul明細を持たない法人でも配下明細を表示)。
    const matchedBizTypes = matched.map((p) => p.business_type);
    const askulCorpSub = matchedBizTypes.length > 0 && matchedBizTypes.every((bt) => bt === 'corporation');
    if (askulCorpSub && !isAdmin && !byCompany) {
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
