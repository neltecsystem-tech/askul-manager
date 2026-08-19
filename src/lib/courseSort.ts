/**
 * コースの並び順。
 *
 * コース名は「1〜13」の数字と「あ〜き」のかなが混在している。
 * DBの order('sort_order').order('name') だけだと name が文字列比較になり、
 *   1, 10, 11, 12, 13, 2, 3, ... , あ, い
 * という並びになってしまう（10 が 2 より前に来る）。
 *
 * 正しくは
 *   1, 2, 3, ... , 13, あ, い, う, ...
 * なので、数字は数値として比較し、数字を数字以外より前に置く。
 *
 * sort_order が設定されていればそれを最優先する（手で並べ替えたいときのため）。
 * 現状は全コース 0 なので、実質この名前順で決まる。
 */

/** "12" のような純粋な数字なら数値、そうでなければ null */
function numOf(name: string): number | null {
  const s = String(name ?? '').trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** コース名だけを比べる。数字が先、その中は数値順。以降はかな・英字などの通常順。 */
export function compareCourseName(a: string, b: string): number {
  const na = numOf(a);
  const nb = numOf(b);
  if (na !== null && nb !== null) return na - nb;   // 1 < 2 < 10 < 13
  if (na !== null) return -1;                        // 数字は先
  if (nb !== null) return 1;
  // かな・漢字・英字は日本語の辞書順（あ→い→う…）
  return String(a ?? '').localeCompare(String(b ?? ''), 'ja');
}

type HasNameOrder = { name?: string | null; sort_order?: number | null };

/** sort_order → コース名 の順で比べる。配列の .sort() にそのまま渡せる。 */
export function compareCourse(a: HasNameOrder, b: HasNameOrder): number {
  const sa = a?.sort_order ?? 0;
  const sb = b?.sort_order ?? 0;
  if (sa !== sb) return sa - sb;
  return compareCourseName(a?.name ?? '', b?.name ?? '');
}

/** 元の配列を壊さずに並べ替えて返す */
export function sortCourses<T extends HasNameOrder>(rows: readonly T[]): T[] {
  return [...rows].sort(compareCourse);
}
