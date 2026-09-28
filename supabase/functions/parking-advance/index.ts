import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import * as XLSX from 'npm:xlsx@0.18.5';

// 立替金精算書(駐車代)の当月分を読む。
//
// 対象ファイルは Google ドライブ上の **.xlsx** (ネイティブのスプレッドシートではない)。
// そのため Sheets API では読めず、 Drive API でダウンロードして xlsx を解析している。
//
// シートは月ごとに増えていき、 名前の付け方が揺れている:
//   「2026年9月度駐車代清算金」「2026年6月度駐車代清算金」「202604」「202506」
// どちらの形でも年月を取り出せるようにしてある。見つからない場合は found:false を返し、
// 画面側で「立替金は入っていません」と出す (勝手に0円として黙って進めない)。

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// 立替金精算書ひな型 (アスクル管理の「立替金精算」タブが表示しているファイル)。
// 🚨 このリポジトリは PUBLIC なので ファイルIDはコードに書かず app_settings から読む。
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const SERVICE_ACCOUNT = JSON.parse(Deno.env.get('GOOGLE_SERVICE_ACCOUNT_KEY')!);

function b64url(s: string): string {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    iss: SERVICE_ACCOUNT.client_email,
    scope: DRIVE_SCOPE,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  }));
  const pemBody = SERVICE_ACCOUNT.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '');
  const binaryDer = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    'pkcs8', binaryDer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${payload}`),
  );
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const jwt = `${header}.${payload}.${sigB64}`;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('Google の認証に失敗しました: ' + JSON.stringify(j));
  return j.access_token;
}

/** シート名から年月を取り出す。取り出せなければ null */
function ymOfSheet(name: string): { year: number; month: number } | null {
  const n = name.replace(/[\s　]/g, '');
  const m1 = n.match(/(\d{4})年(\d{1,2})月/);
  if (m1) return { year: Number(m1[1]), month: Number(m1[2]) };
  const m2 = n.match(/^(\d{4})(\d{2})$/);
  if (m2) {
    const mo = Number(m2[2]);
    if (mo >= 1 && mo <= 12) return { year: Number(m2[1]), month: mo };
  }
  return null;
}

/** "1,100 " や 1100 を数値にする */
function num(v: unknown): number {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').replace(/[,\s　¥￥]/g, '');
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/** シリアル値/文字列の日付を YYYY-MM-DD にする */
function toDate(v: unknown): string {
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  const s = String(v ?? '').trim();
  const m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  // 「2026/0601」のような書き方もある
  const m2 = s.match(/^(\d{4})[\/\-](\d{2})(\d{2})$/);
  if (m2) return `${m2[1]}-${m2[2]}-${m2[3]}`;
  return s;
}

interface AdvanceRow {
  date: string;
  description: string;   // 支払内容
  payee: string;         // 支払先名称
  taxClass: string;      // 支払先の課税区分
  registrationNo: string;
  amount: number;        // 支払金額(税込)
  note: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: '未認証' }, 401);
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();

    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey);
    // サービスロールキー直叩き(動作確認・バッチ用)以外は 管理者ログインを要求する
    if (token !== serviceKey) {
      const { data: userData, error: userErr } = await admin.auth.getUser(token);
      if (userErr || !userData.user) return json({ error: 'ユーザー特定失敗' }, 401);
      const { data: caller } = await admin
        .from('profiles').select('role, active').eq('id', userData.user.id).maybeSingle();
      if (!caller || caller.role !== 'admin' || !caller.active) {
        return json({ error: '管理者権限がありません' }, 403);
      }
    }

    const body = await req.json().catch(() => ({})) as { year?: number; month?: number };
    const year = Number(body.year);
    const month = Number(body.month);
    if (!year || !month) return json({ error: 'year / month が必要です' }, 400);

    const { data: setting } = await admin
      .from('app_settings').select('value').eq('key', 'expense_sheet').maybeSingle();
    const fileId = (setting?.value as { fileId?: string } | null)?.fileId ?? '';
    if (!fileId) {
      return json({ error: '立替金精算書の場所が設定されていません (app_settings: expense_sheet)' }, 500);
    }

    const accessToken = await getAccessToken();
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) {
      return json({ error: `立替金精算書を読めませんでした (${res.status})`, detail: await res.text() }, 502);
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    const wb = XLSX.read(buf, { type: 'array' });

    // 「2026年9月度駐車代清算金」形式と「202509」形式が混在している。
    // 同じ月に当たるシートが2枚あったら、 どちらが正か決められないので止める
    const hits = wb.SheetNames.filter((n) => {
      const ym = ymOfSheet(n);
      return !!ym && ym.year === year && ym.month === month;
    });
    if (hits.length > 1) {
      return json({
        found: false, ambiguous: true, candidates: hits,
        message: `${year}年${month}月度のシートが${hits.length}枚あります。どれを使うか決められません`,
      });
    }
    const hit = hits[0];
    if (!hit) {
      return json({
        found: false,
        sheets: wb.SheetNames,
        message: `${year}年${month}月度のシートが見つかりません`,
      });
    }

    // ヘッダー行(支払日/支払内容/…)を見つけて、その下から読む
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[hit], { header: 1, blankrows: false });
    let headIdx = -1;
    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i]?.[0] ?? '').replace(/[\s　]/g, '') === '支払日') { headIdx = i; break; }
    }
    if (headIdx < 0) {
      return json({ found: false, sheetName: hit, message: 'シートの見出し(支払日)が見つかりません' });
    }

    const out: AdvanceRow[] = [];
    for (let i = headIdx + 1; i < rows.length; i++) {
      const r = rows[i] ?? [];
      const amount = num(r[6]);
      const date = toDate(r[0]);
      // 日付も金額も無い行は空行/合計行とみなして飛ばす
      if (!date && !amount) continue;
      if (!amount) continue;
      out.push({
        date,
        description: String(r[1] ?? '').trim(),
        payee: String(r[2] ?? '').trim(),
        taxClass: String(r[3] ?? '').trim(),
        registrationNo: String(r[4] ?? '').trim(),
        amount,
        note: String(r[7] ?? '').trim(),
      });
    }

    // シートに書いてある「総計」も拾って、 読み取った明細の合計と突き合わせられるようにする
    let sheetTotal: number | null = null;
    for (const r of rows) {
      const label = String(r?.[6] ?? '').replace(/[\s　]/g, '');
      if (label === '総計') { sheetTotal = num(r?.[7]); break; }
    }
    const total = out.reduce((s, r) => s + r.amount, 0);

    return json({
      found: out.length > 0,
      sheetName: hit,
      rows: out,
      total,
      sheetTotal,
      // 読み取り漏れの検知用。 合わない場合は画面で警告する
      totalMatches: sheetTotal === null ? null : sheetTotal === total,
    });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
