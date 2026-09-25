import Encoding from 'encoding-japanese';

// BtoBプラットフォーム請求書(インフォマート)の「請求書標準フォーマット」CSV を作る。
//
// 列は30列。前半(1〜14)が請求書1件ぶん、後半(15〜30)が明細1行ぶん。
// 先方のテンプレートは Shift_JIS だったので、出力もそれに合わせる
// (UTF-8 で出すと取り込み時に文字化けする可能性がある)。
//
// 🚨 前半の請求書項目を「1行目だけに入れる」か「全行に繰り返す」かは、
//    先方の仕様書が手元に無いため確認できていない。ここでは一般的な
//    「1行目だけ」で出している。弾かれた場合は REPEAT_HEADER を true にする。
//    (2026-09-25: 実データ1件で通るか試す前提で実装)
const REPEAT_HEADER = false;

export const BTOB_COLUMNS = [
  '請求書番号', '発行先コード', '件名', '入金期限', '前回請求金額', '入金額', '調整金額', '繰越金額',
  '今回請求金額（税抜）', '今回消費税額', '今回請求金額（税込）', 'おもての請求金額', '締日', '備考',
  '明細日付', '明細番号', '商品コード', '明細項目', '数量', '単価', '単位', '金額', '消費税額', '請求金額',
  '税区分（課税／非課税／免税／不課税）', '税率', '税額入力形式（税抜／税込／手入力）',
  '部門コード', '部門名', '備考',
] as const;

export interface BtobInvoiceHeader {
  invoiceNo: string;      // 請求書番号
  partnerCode: string;    // 発行先コード (BtoBプラットフォーム側の取引先コード)
  subject: string;        // 件名
  dueDate: string;        // 入金期限 (YYYY/MM/DD)
  closingDate: string;    // 締日 (YYYY/MM/DD)
  note?: string;          // 備考
}

export interface BtobInvoiceLine {
  date: string;           // 明細日付 (YYYY/MM/DD)
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

/** 30列ぶんの配列を作る。ヘッダ項目を載せるかは withHeader で切り替える。 */
function row(h: BtobInvoiceHeader, totals: { net: number; tax: number; gross: number }, l: BtobInvoiceLine, withHeader: boolean): string[] {
  const head = withHeader
    ? [
        h.invoiceNo, h.partnerCode, h.subject, ymd(h.dueDate),
        '0', '0', '0', '0',                                  // 繰越は使わない (前回請求/入金/調整/繰越)
        String(totals.net), String(totals.tax), String(totals.gross),
        String(totals.gross),                                // おもての請求金額
        ymd(h.closingDate), h.note ?? '',
      ]
    : ['', '', '', '', '', '', '', '', '', '', '', '', '', ''];
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
  const totals = lines.reduce(
    (acc, l) => ({ net: acc.net + l.amount, tax: acc.tax + l.tax, gross: acc.gross + l.amount + l.tax }),
    { net: 0, tax: 0, gross: 0 },
  );
  const out: string[] = [BTOB_COLUMNS.map(esc).join(',')];
  lines.forEach((l, i) => {
    const cells = row(header, totals, l, REPEAT_HEADER || i === 0);
    cells[15] = String(i + 1); // 明細番号
    out.push(cells.map(esc).join(','));
  });
  return out.join('\r\n') + '\r\n';
}

/** Shift_JIS に変換して Blob にする。 */
export function toShiftJisBlob(csv: string): Blob {
  const sjis = Encoding.convert(Encoding.stringToCode(csv), { to: 'SJIS', from: 'UNICODE' });
  return new Blob([new Uint8Array(sjis)], { type: 'text/csv' });
}

/** 請求書番号。締め年月 + 通し記号。同じ月を作り直しても同じ番号になるようにする。 */
export function defaultInvoiceNo(closingDate: string, prefix = 'AS'): string {
  const d = new Date(closingDate);
  return `${prefix}-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
}
