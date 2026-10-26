// 退職予定の中継(2026-10-26)。
//
// 退職予定の登録先は NexPort(workchat)の staff_retirements ただ1か所(EF staff-retire)。
// このEFは「アスクルの管理者であること」を確かめて、共有シークレットを付けて中継するだけ(支払停止の pay-suspension-proxy と同じ作り)。
// 🚨 シークレットをブラウザに置かないためにEFを挟んでいる。
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const CENTRAL = 'https://nccognptoprhwsbjnwcu.supabase.co/functions/v1/staff-retire';
const ALLOWED = new Set(['list', 'set', 'cancel']);

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    // 支払停止と同じ「現場ツール用の共有シークレット」を使う(中央の staff-retire も同じ値で確かめる)
    const secret = Deno.env.get('PAY_SUSPENSION_SECRET');
    if (!secret) return json({ error: 'PAY_SUSPENSION_SECRET が未設定です' }, 500);

    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return json({ error: '未認証' }, 401);
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData.user) return json({ error: 'ユーザー特定失敗' }, 401);
    const { data: caller } = await admin.from('profiles').select('role, active, full_name').eq('id', userData.user.id).maybeSingle();
    if (!caller || caller.role !== 'admin' || !caller.active) return json({ error: '管理者権限がありません' }, 403);

    const body = await req.json().catch(() => ({} as any));
    const action = String(body.action || '');
    if (!ALLOWED.has(action)) return json({ error: 'この操作は中継できません', code: 'BAD_ACTION' }, 400);

    // 対象者は「アスクルのドライバー」。中央マスタとは askul_profile_id(無ければ電話・氏名)で突き合わせる
    let who: Record<string, unknown> = {};
    if (action === 'set') {
      const driverId = String(body.driver_id || '');
      if (!driverId) return json({ error: '対象のドライバーを選んでください' }, 400);
      const { data: d } = await admin.from('profiles').select('full_name, phone').eq('id', driverId).maybeSingle();
      if (!d) return json({ error: 'ドライバーが見つかりません' }, 404);
      who = { askul_profile_id: driverId, phone: d.phone || undefined, full_name: d.full_name, site: 'アスクル' };
    }

    const r = await fetch(CENTRAL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, ...who, secret, tool: 'askul', actor_name: caller.full_name || 'アスクルの管理者', driver_id: undefined }),
    });
    const out = await r.json().catch(() => ({ error: '中央の応答を読めませんでした' }));
    return json(out, r.status);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
