import Encoding from 'encoding-japanese';

// BtoBプラットフォーム請求書(インフォマート)の
// 「アップロードフォーマット設定 → 請求書(自社作成)データ」に取り込むCSVを作る。
//
// 列名は先方の [項目名] と同じ文字列にしてある (2026-09-25 に実画面の項目一覧で確認)。
// フォーマット設定画面では「貴社データの番号」を項目に割り当てるので、
// 同じ名前にしておくと対応付けで迷わない。
//
// 先方の項目には 伝票情報・軽減8%/8%/5%/0%/非課税/免税/不課税 の内訳や
// 宛先コード・社員コード・顧客コード・EDI情報などもあるが、
// アスクルの請求は「10%課税のみ・伝票なし」なので出していない (割り当てなしでよい)。
//
// 🚨 Shift_JIS で出す (UTF-8 だと取り込みで文字化けする)。日付は YYYY/MM/DD。
//
// おもて情報は全行に繰り返す。 支払先コード と おもての請求金額 が必須項目で、
// 行ごとに項目を割り当てる形式のため、 2行目以降が空だと弾かれる可能性が高い。
// (1行目だけにする形式だった場合は REPEAT_HEADER を false にする)
const REPEAT_HEADER = true;

// 適格請求書発行事業者 登録番号 (株式会社NELTEC)
export const NELTEC_REGISTRATION_NO = 'T8011601022911';

export const BTOB_COLUMNS = [
  // ── おもて情報 ──
  '請求書番号', '支払先コード', '事業者登録番号', '件名', '支払期限',
  '前回請求金額', '入金額', '調整金額', '繰越金額',
  '今回請求金額（税抜）', '今回消費税額', '今回請求金額（税込）', 'おもての請求金額',
  '10%請求金額（税抜）', '10%消費税額', '10%請求金額（税込）',
  '締日', '備考',
  // ── 明細情報 ──
  '明細日付', '明細番号', '商品コード', '明細項目', '数量', '単価', '単位',
  '金額', '消費税額', '請求金額',
  '税区分（課税／非課税／免税／不課税）', '税率', '税額入力形式（税抜／税込／手入力）',
  '部門コード', '部門名', '明細備考',
] as const;

/** おもて情報の列数 (明細だけ差し替える時の境目) */
const HEADER_COLS = 18;

export interface BtobInvoiceHeader {
  invoiceNo: string;      // 請求書番号
  partnerCode: string;    // 支払先コード (BtoBプラットフォーム側の支払先マスタのコード)
  subject: string;        // 件名
  dueDate: string;        // 支払期限 (YYYY-MM-DD / YYYY/MM/DD)
  closingDate: string;    // 締日
  note?: string;          // 備考
  registrationNo?: string; // 事業者登録番号 (既定=NELTEC)
}

export interface BtobInvoiceLine {
  date: string;           // 明細日付
  productCode?: string;   // 商品コード (先方マスタ。無ければ空)
  item: string;           // 明細項目
  quantity: number;
  unitPrice: number;
  unit: string;           // 単位
  amount: number;         // 金額 (税抜)
  tax: number;            // 消費税額
  taxRate: number;        // 税率 (10 など)
  departmentCode?: string;
  departmentName?: string;
  note?: string;
}

// 日付は YYYY/MM/DD にそろえる。画面側は YYYY-MM-DD で持っているが、
// 国内の会計システムはスラッシュ区切りを前提にしていることが多い。
const ymd = (v: string): string => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v.replace(/-/g, '/') : v);

const esc = (v: string | number | undefined | null): string => {
  const s = v === undefined || v === null ? '' : String(v);
  // 金額は桁区切りを入れない (取り込み側で数値として読ませるため)
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

interface Totals { net: number; tax: number; gross: number }

/** 1行ぶん(おもて + 明細)を作る。おもてを載せるかは withHeader で切り替える。 */
function row(h: BtobInvoiceHeader, t: Totals, l: BtobInvoiceLine, withHeader: boolean): string[] {
  const head = withHeader
    ? [
        h.invoiceNo, h.partnerCode, h.registrationNo ?? NELTEC_REGISTRATION_NO,
        h.subject, ymd(h.dueDate),
        '0', '0', '0', '0',                    // 前回請求/入金/調整/繰越 (繰越は使わない)
        String(t.net), String(t.tax), String(t.gross),
        String(t.gross),                       // おもての請求金額 (必須)
        String(t.net), String(t.tax), String(t.gross), // 10% の内訳 (全額10%課税)
        ymd(h.closingDate), h.note ?? '',
      ]
    : new Array(HEADER_COLS).fill('');
  return [
    ...head,
    ymd(l.date), '', l.productCode ?? '', l.item,
    String(l.quantity), String(l.unitPrice), l.unit,
    String(l.amount), String(l.tax), String(l.amount + l.tax),
    '課税', String(l.taxRate), '税抜',
    l.departmentCode ?? '', l.departmentName ?? '', l.note ?? '',
  ];
}

/**
 * CSV本文を作る。明細番号は 1 から振り直す。
 * 合計は明細の積み上げにする(おもての金額と内訳が必ず一致するように)。
 */
export function buildBtobInvoiceCsv(header: BtobInvoiceHeader, lines: BtobInvoiceLine[]): string {
  const totals = lines.reduce<Totals>(
    (acc, l) => ({ net: acc.net + l.amount, tax: acc.tax + l.tax, gross: acc.gross + l.amount + l.tax }),
    { net: 0, tax: 0, gross: 0 },
  );
  const out: string[] = [BTOB_COLUMNS.map(esc).join(',')];
  lines.forEach((l, i) => {
    const cells = row(header, totals, l, REPEAT_HEADER || i === 0);
    cells[HEADER_COLS + 1] = String(i + 1); // 明細番号
    out.push(cells.map(esc).join(','));
  });
  return out.join('\r\n') + '\r\n';
}

/** Shift_JIS に変換して Blob にする。 */
export function toShiftJisBlob(csv: string): Blob {
  const sjis = Encoding.convert(Encoding.stringToCode(csv), { to: 'SJIS', from: 'UNICODE' });
  return new Blob([new Uint8Array(sjis)], { type: 'text/csv' });
}

/**
 * 支払期限。BtoBプラットフォームの支払先設定に合わせて締日から出す。
 *   20日締め  → 1ヵ月後の20日   (設定1)
 *   末日締め  → 1ヵ月後の末日   (設定2)
 * 締日が月末なら翌月末、そうでなければ翌月の同じ日 (その月に無い日は月末に丸める)。
 */
export function dueDateFromClosing(closingDate: string): string {
  const d = new Date(closingDate);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = d.getMonth();
  const day = d.getDate();
  const lastOfThis = new Date(y, m + 1, 0).getDate();
  const lastOfNext = new Date(y, m + 2, 0).getDate();
  const target = day === lastOfThis ? lastOfNext : Math.min(day, lastOfNext);
  const due = new Date(y, m + 1, target);
  return `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}`;
}

/** 請求書番号。締め年月 + 通し記号。同じ月を作り直しても同じ番号になるようにする。 */
export function defaultInvoiceNo(closingDate: string, prefix = 'AS'): string {
  const d = new Date(closingDate);
  return `${prefix}-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
}
