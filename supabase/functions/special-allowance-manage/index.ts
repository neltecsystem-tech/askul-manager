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

type Row = {
  row: number; // 実シート行番号 (1始まり, ヘッダー=1)
  timestamp: string;
  event_date: string;
  driver_name: string;
  type: string;
  amount: string;
  reason: string;
  inputter: string;
};

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
      action?: string;
      row?: number;
      timestamp?: string;
      event_date?: string;
      driver_name?: string;
      type?: string;
      amount?: number | string;
      reason?: string;
      inputter?: string;
    };
    const action = (body.action || 'list').trim();

    const saRaw = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_KEY');
    if (!saRaw) return json({ error: 'GOOGLE_SERVICE_ACCOUNT_KEY 未設定' }, 500);
    let sa: { client_email: string; private_key: string };
    try {
      sa = JSON.parse(saRaw);
    } catch (e) {
      return json({ error: 'GOOGLE_SERVICE_ACCOUNT_KEY の JSON パース失敗: ' + (e instanceof Error ? e.message : String(e)) }, 500);
    }
    const accessToken = await getAccessToken(sa.client_email, sa.private_key, SHEETS_SCOPE);

    // 共通: A:G 全件取得
    const allRows = await readAll(accessToken);

    if (action === 'list') {
      return json({ ok: true, rows: allRows });
    }

    // update / delete は行番号 + timestamp の二重照合でズレ事故を防止
    const targetRow = Number(body.row);
    const expectedTs = (body.timestamp || '').trim();
    if (!targetRow || targetRow < 2 || !expectedTs) {
      return json({ error: '対象行が不正です' }, 400);
    }
    const found = allRows.find((r) => r.row === targetRow);
    if (!found || found.timestamp !== expectedTs) {
      return json({ error: '一覧が更新されています。再読み込みしてからやり直してください。' }, 409);
    }

    if (action === 'delete') {
      const sheetId = await getSheetId(accessToken);
      await deleteRow(accessToken, sheetId, targetRow);
      return json({ ok: true, deletedRow: targetRow });
    }

    if (action === 'update') {
      const event_date = (body.event_date || '').trim();
      const driver_name = (body.driver_name || '').trim();
      const type = (body.type || '').trim();
      const amount = body.amount;
      const reason = (body.reason || '').trim();
      const inputter = (body.inputter || '').trim();
      if (!event_date || !driver_name || !type || amount == null || amount === '' || !reason || !inputter) {
        return json({ error: '必須項目が未入力' }, 400);
      }
      const num = Number(String(amount).replace(/,/g, ''));
      if (!isFinite(num) || num <= 0) {
        return json({ error: '金額は正の数値を入力してください' }, 400);
      }
      const formattedDate = event_date.replace(/-/g, '/');

      // 重複チェック: 自分以外の行で 同じ日付 かつ 同じ氏名 が存在したら拒否
      const dup = allRows.find(
        (r) => r.row !== targetRow &&
          normDate(r.event_date) === normDate(formattedDate) &&
          r.driver_name === driver_name,
      );
      if (dup) {
        return json({ error: `同じ日付・氏名の登録が既にあります (${formattedDate} / ${driver_name})` }, 409);
      }

      // timestamp(A列) は保持、B:G を更新
      const range = `${SHEET_NAME}!B${targetRow}:G${targetRow}`;
      const url =
        `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/` +
        encodeURIComponent(range) + '?valueInputOption=USER_ENTERED';
      const res = await fetchWithRetry(url, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [[formattedDate, driver_name, type, String(num), reason, inputter]] }),
      });
      if (!res.ok) {
        if (res.status === 429 || res.status === 503) {
          return json({ error: 'ただいまアクセスが混み合っています。しばらくしてから、もう一度お試しください。' }, 503);
        }
        return json({ error: `更新失敗 ${res.status}: ${await res.text()}` }, 502);
      }
      return json({ ok: true, updatedRow: targetRow });
    }

    return json({ error: `未対応のaction: ${action}` }, 400);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function normDate(s: string): string {
  // "2026/07/20" / "2026-07-20" / "2026/7/20" を YYYY/M/D 桁揃えなしで正規化
  const m = s.replace(/-/g, '/').match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (!m) return s.trim();
  return `${m[1]}/${Number(m[2])}/${Number(m[3])}`;
}

async function readAll(accessToken: string): Promise<Row[]> {
  const getUrl =
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/` +
    encodeURIComponent(`${SHEET_NAME}!A:G`);
  const res = await fetchWithRetry(getUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`取得失敗 ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { values?: string[][] };
  const values = data.values ?? [];
  const rows: Row[] = [];
  for (let i = 1; i < values.length; i++) { // i=0 はヘッダー
    const r = values[i] ?? [];
    const ts = (r[0] ?? '').trim();
    if (!ts) continue; // 空行スキップ
    rows.push({
      row: i + 1,
      timestamp: ts,
      event_date: r[1] ?? '',
      driver_name: r[2] ?? '',
      type: r[3] ?? '',
      amount: r[4] ?? '',
      reason: r[5] ?? '',
      inputter: r[6] ?? '',
    });
  }
  return rows;
}

async function getSheetId(accessToken: string): Promise<number> {
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}?fields=sheets.properties(sheetId,title)`;
  const res = await fetchWithRetry(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`シート情報取得失敗 ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { sheets?: { properties?: { sheetId: number; title: string } }[] };
  const sheet = (data.sheets ?? []).find((s) => s.properties?.title === SHEET_NAME);
  if (!sheet?.properties) throw new Error(`シート「${SHEET_NAME}」が見つかりません`);
  return sheet.properties.sheetId;
}

async function deleteRow(accessToken: string, sheetId: number, row: number): Promise<void> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}:batchUpdate`;
  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [{
        deleteDimension: {
          range: { sheetId, dimension: 'ROWS', startIndex: row - 1, endIndex: row },
        },
      }],
    }),
  });
  if (!res.ok) throw new Error(`削除失敗 ${res.status}: ${await res.text()}`);
}

async function fetchWithRetry(url: string, init: RequestInit, maxRetries = 4): Promise<Response> {
  let res: Response | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    res = await fetch(url, init);
    if (res.status !== 429 && res.status !== 503) return res;
    if (attempt === maxRetries) return res;
    await res.body?.cancel();
    const delay = 1000 * Math.pow(2, attempt) + Math.floor(Math.random() * 500);
    await new Promise((r) => setTimeout(r, delay));
  }
  return res!;
}

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
