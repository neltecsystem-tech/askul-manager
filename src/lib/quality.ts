// 品質実績シート（月次KPI）のパーサと型

export interface QualityCountRow {
  name: string;
  values: (number | null)[]; // 月別
  total: number | null; // 通期
}

export interface QualityRateRow extends QualityCountRow {
  target: number | null; // 目標値
  prevFy: number | null; // 17期実績(前期)
}

export interface QualityData {
  months: string[]; // ['6月度','7月度',...,'5月度']
  delivered: (number | null)[]; // 配完個数(月別)
  deliveredTotal: number | null;
  counts: QualityCountRow[]; // 不良配送件数(区分別)
  countTotal: QualityCountRow | null; // 合計行
  rates: QualityRateRow[]; // 実績値(不良率, 区分別)
  rateAll: QualityRateRow | null; // ALL行
}

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  if (!s || s.startsWith('#')) return null; // #DIV/0! など
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function txt(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

function stripMonth(s: string): string {
  return s.replace(/(件数|個数|実績)$/, '');
}

// xlsx の sheet_to_json(header:1) で得た2次元配列を受け取る
export function parseQualitySheet(grid: unknown[][]): QualityData | null {
  const findRow = (pred: (r: unknown[]) => boolean) =>
    grid.findIndex((r) => Array.isArray(r) && pred(r));

  const badHeaderIdx = findRow((r) => txt(r[0]).includes('不良配送'));
  if (badHeaderIdx < 0) return null;

  // 月カラムの特定（不良配送ヘッダー: 6月度件数 ... 通期件数）
  const header = grid[badHeaderIdx];
  const monthCols: number[] = [];
  const months: string[] = [];
  let tsujiCol = -1;
  for (let c = 1; c < header.length; c++) {
    const t = txt(header[c]);
    if (!t) continue;
    if (t.includes('通期')) {
      tsujiCol = c;
      break;
    }
    months.push(stripMonth(t));
    monthCols.push(c);
  }
  if (monthCols.length === 0) return null;

  const valuesOf = (r: unknown[]) => monthCols.map((c) => num(r[c]));

  // 配完個数（ヘッダー行の次が値）
  const delIdx = findRow((r) => txt(r[0]).includes('配完個数'));
  const delRow = delIdx >= 0 ? grid[delIdx + 1] : null;
  const delivered = delRow ? valuesOf(delRow) : monthCols.map(() => null);
  const deliveredTotal = delRow && tsujiCol >= 0 ? num(delRow[tsujiCol]) : null;

  // 不良配送件数（区分別 + 合計）
  const counts: QualityCountRow[] = [];
  let countTotal: QualityCountRow | null = null;
  for (let i = badHeaderIdx + 1; i < grid.length; i++) {
    const r = grid[i];
    if (!Array.isArray(r)) continue;
    const name = txt(r[0]);
    if (!name) continue;
    const row: QualityCountRow = {
      name,
      values: valuesOf(r),
      total: tsujiCol >= 0 ? num(r[tsujiCol]) : null,
    };
    if (name === '合計') {
      countTotal = row;
      break;
    }
    counts.push(row);
  }

  // 実績値（不良率 + 目標値 + 17期実績）
  const rates: QualityRateRow[] = [];
  let rateAll: QualityRateRow | null = null;
  const rateHeaderIdx = findRow((r) => txt(r[0]).includes('実績値'));
  if (rateHeaderIdx >= 0) {
    const rh = grid[rateHeaderIdx];
    let targetCol = -1;
    let prevCol = -1;
    let rTsuji = tsujiCol;
    for (let c = 1; c < rh.length; c++) {
      const t = txt(rh[c]);
      if (t.includes('目標')) targetCol = c;
      else if (t.includes('17期') || t.includes('前期')) prevCol = c;
      else if (t.includes('通期')) rTsuji = c;
    }
    for (let i = rateHeaderIdx + 1; i < grid.length; i++) {
      const r = grid[i];
      if (!Array.isArray(r)) continue;
      const name = txt(r[0]);
      if (!name) continue;
      const row: QualityRateRow = {
        name,
        values: valuesOf(r),
        total: rTsuji >= 0 ? num(r[rTsuji]) : null,
        target: targetCol >= 0 ? num(r[targetCol]) : null,
        prevFy: prevCol >= 0 ? num(r[prevCol]) : null,
      };
      if (name === 'ALL') {
        rateAll = row;
        break;
      }
      rates.push(row);
    }
  }

  return { months, delivered, deliveredTotal, counts, countTotal, rates, rateAll };
}
