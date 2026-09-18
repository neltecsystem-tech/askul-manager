// 支払停止（明細発行STOP）の中継。
//
// 支払停止の登録先は NexPort(workchat)の pay_suspensions ただ1か所。
// このEFは「アスクルの管理者であること」を確かめて、共有シークレットを付けて中継するだけ。
//
// 🚨 シークレットをブラウザに置かないためにEFを挟んでいる。
//    画面から中央EFを直接叩く作りにすると、鍵がバンドルに載って誰でも他人の
//    支払いを止められるようになる。
//
// 🚨 会計の金額は止まらない。止まるのは明細ビューアと支払通知だけ。
//    契約違反があっても報酬債務そのものは消えないため(2026-09-18 利用者判断)。
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const CENTRAL = 'https://nccognptoprhwsbjnwcu.supabase.co/functions/v1/pay-suspension';
// 中継してよい操作だけを通す。check(判定)は画面からは使わない。
const ALLOWED = new Set(['list', 'set', 'release']);

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const secret = Deno.env.get('PAY_SUSPENSION_SECRET');
    if (!secret) return json({ error: 'PAY_SUSPENSION_SECRET が未設定です' }, 500);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: '未認証' }, 401);
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData.user) return json({ error: 'ユーザー特定失敗' }, 401);

    const { data: caller } = await admin.from('profiles')
      .select('role, active').eq('id', userData.user.id).maybeSingle();
    if (!caller || caller.role !== 'admin' || !caller.active) {
      return json({ error: '管理者権限がありません' }, 403);
    }

    const body = await req.json().catch(() => ({} as any));
    const action = String(body.action || '');
    if (!ALLOWED.has(action)) return json({ error: 'この操作は中継できません', code: 'BAD_ACTION' }, 400);

    // 対象者は「アスクルのドライバー」から選ばせる。中央マスタとは氏名/電話で突き合わせる。
    let who: Record<string, unknown> = {};
    if (action === 'set') {
      const driverId = String(body.driver_id || '');
      if (!driverId) return json({ error: '対象のドライバーを選んでください' }, 400);
      const { data: d } = await admin.from('profiles')
        .select('full_name, phone').eq('id', driverId).maybeSingle();
      if (!d) return json({ error: 'ドライバーが見つかりません' }, 404);
      // 電話が一番確実。無ければ氏名(空白を詰めたもの)で中央マスタを引く。
      who = d.phone
        ? { phone: d.phone }
        : { subject_key: 'n:' + String(d.full_name || '').replace(/\s+/g, '') };
    }

    const r = await fetch(CENTRAL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...body, ...who, secret, tool: 'askul', actor_id: undefined,
        driver_id: undefined,
      }),
    });
    const out = await r.json().catch(() => ({ error: '中央の応答を読めませんでした' }));
    return json(out, r.status);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
