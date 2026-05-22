import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SPREADSHEET_ID = '1Wh280_jyUFOCjsd1XrBNMbEXCiVwcJ1pvGdYEEi8LOY';
const SHEET_NAME = 'フォームの回答 1';
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

    const body = await req.json() as {
      event_date?: string;
      driver_name?: string;
      type?: string;
      amount?: number | string;
      reason?: string;
      inputter?: string;
    };

    const event_date = (body.event_date || '').trim();
    const driver_name = (body.driver_name || '').trim();
    const type = (body.type || '').trim();
    const amount = body.amount;
    const reason = (body.reason || '').trim();
    const inputter = (body.inputter || '').trim();

    if (!event_date || !driver_name || !type || amount == null || amount === '' || !reason || !inputter) {
      return json({ error: '必須項目が未入力' }, 400);
    }

    // YYYY-MM-DD → YYYY/MM/DD
    const formattedDate = event_date.replace(/-/g, '/');

    // タイムスタンプ生成 (JST, YYYY/MM/DD HH:MM:SS)
    const now = new Date();
    const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const ts =
      jst.getUTCFullYear() + '/' +
      String(jst.getUTCMonth() + 1).padStart(2, '0') + '/' +
      String(jst.getUTCDate()).padStart(2, '0') + ' ' +
      String(jst.getUTCHours()).padStart(2, '0') + ':' +
      String(jst.getUTCMinutes()).padStart(2, '0') + ':' +
      String(jst.getUTCSeconds()).padStart(2, '0');

    const row = [ts, formattedDate, driver_name, type, String(amount), reason, inputter];

    // サービスアカウントキー読み込み
    const saRaw = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_KEY');
    if (!saRaw) return json({ error: 'GOOGLE_SERVICE_ACCOUNT_KEY 未設定' }, 500);
    let sa: { client_email: string; private_key: string };
    try {
      sa = JSON.parse(saRaw);
    } catch (e) {
      return json({ error: 'GOOGLE_SERVICE_ACCOUNT_KEY の JSON パース失敗: ' + (e instanceof Error ? e.message : String(e)) }, 500);
    }

    const accessToken = await getAccessToken(sa.client_email, sa.private_key, SHEETS_SCOPE);

    // append は使わない (Forms連携シートで末尾検出が不安定で同じ行に上書きされ続けるため)
    // 代わりに: A列全件読み取り → 末尾の非空行を明示計算 → values.update で その行に書き込み

    // 1. A 列全体を取得して 末尾の非空行を計算
    const getUrl =
      `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/` +
      encodeURIComponent(`${SHEET_NAME}!A:A`);
    const getRes = await fetch(getUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!getRes.ok) {
      return json({ error: `末尾検出失敗 ${getRes.status}: ${await getRes.text()}` }, 502);
    }
    const getData = (await getRes.json()) as { values?: string[][] };
    const aColumn = getData.values ?? [];
    let lastNonEmpty = 0;
    aColumn.forEach((r, i) => {
      if (r && r[0]) lastNonEmpty = i + 1;
    });
    const targetRow = lastNonEmpty + 1;

    // 2. その行に直接 update で書き込み (append ではなく)
    const updateRange = `${SHEET_NAME}!A${targetRow}:G${targetRow}`;
    const updateUrl =
      `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/` +
      encodeURIComponent(updateRange) +
      '?valueInputOption=USER_ENTERED';

    const updateRes = await fetch(updateUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: [row] }),
    });
    if (!updateRes.ok) {
      const text = await updateRes.text();
      return json({ error: `Sheets API update エラー ${updateRes.status}: ${text}` }, 502);
    }
    const result = await updateRes.json();
    return json({
      ok: true,
      timestamp: ts,
      updatedRange: result.updatedRange ?? updateRange,
      updatedRows: result.updatedRows ?? 1,
    });
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
