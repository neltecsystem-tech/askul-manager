import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SPREADSHEET_ID = '1Wh280_jyUFOCjsd1XrBNMbEXCiVwcJ1pvGdYEEi8LOY';
const SHEET_NAME = 'DETA貼り付け';
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: '未認証' }, 401);
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData.user) return json({ error: 'ユーザー特定失敗' }, 401);

    const { data: caller } = await admin
      .from('profiles')
      .select('role, active')
      .eq('id', userData.user.id)
      .maybeSingle();
    if (!caller || caller.role !== 'admin' || !caller.active) {
      return json({ error: '管理者権限がありません' }, 403);
    }

    const body = await req.json() as { rows?: (string | number)[][] };
    const rows = body.rows;
    if (!Array.isArray(rows) || rows.length === 0) {
      return json({ error: '追加する行がありません' }, 400);
    }

    // サービスアカウントキー読み込み
    const saRaw = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_KEY');
    if (!saRaw) return json({ error: 'GOOGLE_SERVICE_ACCOUNT_KEY 未設定' }, 500);
    let sa: { client_email: string; private_key: string };
    try {
      sa = JSON.parse(saRaw);
    } catch (e) {
      return json({ error: 'GOOGLE_SERVICE_ACCOUNT_KEY の JSON パース失敗: ' + (e instanceof Error ? e.message : String(e)) }, 500);
    }

    // OAuth アクセストークン取得
    const accessToken = await getAccessToken(sa.client_email, sa.private_key, SHEETS_SCOPE);

    // Sheets API に append
    // insertDataOption=OVERWRITE: 既存グリッドの空白セルに上書き (新規行追加しない)
    // WB 全体のセル数が 10M 上限に近い場合、INSERT_ROWS だと拒否されるため OVERWRITE 必須
    const range = `${SHEET_NAME}!A:P`;
    const url =
      `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/` +
      encodeURIComponent(range) +
      ':append?valueInputOption=USER_ENTERED&insertDataOption=OVERWRITE';

    const appendRes = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: rows }),
    });
    if (!appendRes.ok) {
      const text = await appendRes.text();
      return json({ error: `Sheets API append エラー ${appendRes.status}: ${text}` }, 502);
    }
    const result = await appendRes.json();
    return json({ ok: true, updatedRange: result.updates?.updatedRange, updatedRows: result.updates?.updatedRows ?? rows.length });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

async function getAccessToken(clientEmail: string, privateKeyPem: string, scope: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: clientEmail,
    scope,
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };
  const headerB64 = base64url(new TextEncoder().encode(JSON.stringify(header)));
  const payloadB64 = base64url(new TextEncoder().encode(JSON.stringify(payload)));
  const toSign = `${headerB64}.${payloadB64}`;

  // PEM -> CryptoKey
  const pemBody = privateKeyPem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s/g, '');
  const binary = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    binary,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(toSign),
  );
  const sigB64 = base64url(new Uint8Array(sig));
  const jwt = `${toSign}.${sigB64}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OAuth token 取得失敗 ${res.status}: ${text}`);
  }
  const tok = (await res.json()) as { access_token: string };
  return tok.access_token;
}

function base64url(data: Uint8Array): string {
  let str = '';
  for (let i = 0; i < data.length; i++) str += String.fromCharCode(data[i]);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
