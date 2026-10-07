/**
 * A long list drawn a window at a time (ADR-036: the transcript panel with
 * up to 3000 lines), as pure arithmetic: where every row sits, which rows a
 * scroll position shows, and which lines a search finds.
 *
 * Rows have different heights (a line of text wraps to one, two or three
 * rows of type; a row being edited is taller), so every position comes from
 * the heights: measured ones where a row has been on screen, an estimate
 * where it has not. Nothing here touches the DOM.
 */

/** Up to this many rows a list is simply drawn whole (the browser's own find-in-page then sees every line). */
export const WINDOW_FROM_ROWS = 200;

/** Rows kept drawn above and below what is visible, in pixels: fast scrolling does not show a blank. */
export const OVERSCAN_PX = 600;

/**
 * Top of every row, and the list's whole height as the last entry
 * (`offsets.length === count + 1`). `gap` is the space under each row.
 */
export function rowOffsets(count: number, heightOf: (index: number) => number, gap: number): Float64Array {
  const offsets = new Float64Array(count + 1);
  let at = 0;
  for (let index = 0; index < count; index += 1) {
    offsets[index] = at;
    at += Math.max(0, heightOf(index)) + gap;
  }
  offsets[count] = at;
  return offsets;
}

/** The row whose box holds pixel `y` (the last row that starts at or before it). */
export function rowAt(offsets: Float64Array, y: number): number {
  const count = offsets.length - 1;
  if (count <= 0) return 0;
  let low = 0;
  let high = count - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if ((offsets[mid] as number) <= y) low = mid;
    else high = mid - 1;
  }
  return low;
}

export interface RowRange {
  /** First and last row drawn, inclusive; `first > last` when the list is empty. */
  first: number;
  last: number;
}

/** The rows to draw for a scroll position: what is visible plus `overscan` pixels on each side. */
export function visibleRows(offsets: Float64Array, scrollTop: number, viewport: number, overscan: number = OVERSCAN_PX): RowRange {
  const count = offsets.length - 1;
  if (count <= 0) return { first: 0, last: -1 };
  const first = rowAt(offsets, Math.max(0, scrollTop - overscan));
  const last = rowAt(offsets, Math.max(0, scrollTop + Math.max(0, viewport) + overscan));
  return { first, last: Math.min(count - 1, Math.max(first, last)) };
}

/** Lower case without accents or the Turkish dotted/dotless difference: "Istanbul" finds "İstanbul". */
export function foldForSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i')
    .toLowerCase();
}

/** Indices of the lines whose text holds `query` (folded); none for a blank query. */
export function searchLines(texts: readonly string[], query: string): number[] {
  const needle = foldForSearch(query.trim());
  if (!needle) return [];
  const found: number[] = [];
  texts.forEach((text, index) => {
    if (foldForSearch(text).includes(needle)) found.push(index);
  });
  return found;
}

/** The match to go to from `from` (a row index) in direction `step` (+1 / −1), wrapping round; -1 when there is none. */
export function nextMatch(matches: readonly number[], from: number, step: 1 | -1): number {
  if (matches.length === 0) return -1;
  if (step === 1) {
    const later = matches.find((index) => index > from);
    return later ?? (matches[0] as number);
  }
  for (let k = matches.length - 1; k >= 0; k -= 1) {
    if ((matches[k] as number) < from) return matches[k] as number;
  }
  return matches[matches.length - 1] as number;
}
