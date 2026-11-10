// BtoB請求書PDFの中継(2026-11-10)。
//
// アスクルで BtoB CSV を出したとき、同じ数字で「BtoBプラットフォームの請求書(おもて)と同じ形のPDF」を
// NexPort(会計)の EF source-docs に作らせ、共有ドライブ「財務資料/売掛金/売上請求書」へ保管する。
// このEFは「アスクルの管理者であること」を確かめて、共有シークレットを付けて中継するだけ(staff-retire-proxy と同じ作り)。
// 🚨 シークレットをブラウザに置かないためにEFを挟んでいる。このリポジトリは公開なので値はコードに書かない。
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const CENTRAL = 'https://nccognptoprhwsbjnwcu.supabase.co/functions/v1/source-docs';
// NexPort の公開鍵(anon)。source-docs は verify_jwt=true のため付ける。秘密ではない
const NEXPORT_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5jY29nbnB0b3ByaHdzYmpud2N1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzNDU0NDEsImV4cCI6MjA4OTkyMTQ0MX0.M3h31uPyKYWlNevVW3OvZOonoTidC1KLZ04sB5nRKzU';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
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
    const r = await fetch(CENTRAL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${NEXPORT_ANON}`, 'x-proxy-secret': secret },
      body: JSON.stringify({ action: 'invoice_pdf', tool: 'askul', invoice: body.invoice, issued_by: caller.full_name || 'アスクルの管理者' }),
    });
    const out = await r.json().catch(() => ({ error: '中央の応答を読めませんでした' }));
    return json(out, r.status);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
