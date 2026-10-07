import { describe, expect, it } from 'vitest';

import {
  OVERSCAN_PX,
  WINDOW_FROM_ROWS,
  foldForSearch,
  nextMatch,
  rowAt,
  rowOffsets,
  searchLines,
  visibleRows,
} from '@/domain/virtualList';

const GAP = 2;
/** 3000 rows whose heights differ (one, two or three lines of type). */
const heights = Array.from({ length: 3000 }, (_, index) => 48 + (index % 3) * 22);
const offsets = rowOffsets(heights.length, (index) => heights[index] as number, GAP);

describe('a long list drawn a window at a time', () => {
  it('places every row under the one before it, with the gap, and knows the whole height', () => {
    expect(offsets.length).toBe(3001);
    expect(offsets[0]).toBe(0);
    expect(offsets[1]).toBe(48 + GAP);
    expect(offsets[2]).toBe(48 + GAP + 70 + GAP);
    expect(offsets[3000]).toBe(heights.reduce((sum, height) => sum + height + GAP, 0));
    expect(rowOffsets(0, () => 10, GAP)).toEqual(new Float64Array([0]));
  });

  it('finds the row at a pixel (binary search agrees with a walk)', () => {
    for (const y of [0, 1, 49, 50, 51, 12_345.6, 100_000, (offsets[3000] as number) - 1, (offsets[3000] as number) + 500]) {
      let walk = 0;
      while (walk < 2999 && (offsets[walk + 1] as number) <= y) walk += 1;
      expect(rowAt(offsets, y)).toBe(walk);
    }
    expect(rowAt(offsets, -5)).toBe(0);
  });

  it('draws what is visible plus the overscan, never the whole list', () => {
    const range = visibleRows(offsets, 50_000, 600);
    const first = rowAt(offsets, 50_000 - OVERSCAN_PX);
    const last = rowAt(offsets, 50_000 + 600 + OVERSCAN_PX);
    expect(range).toEqual({ first, last });
    expect(range.last - range.first).toBeLessThan(60);
    // Every visible pixel belongs to a drawn row.
    expect(offsets[range.first] as number).toBeLessThanOrEqual(50_000);
    expect(offsets[range.last + 1] as number).toBeGreaterThanOrEqual(50_600);
  });

  it('stays inside the list at both ends and says "nothing" for an empty list', () => {
    expect(visibleRows(offsets, 0, 600).first).toBe(0);
    expect(visibleRows(offsets, 10_000_000, 600)).toEqual({ first: 2999, last: 2999 });
    expect(visibleRows(offsets, (offsets[3000] as number) - 600, 600).last).toBe(2999);
    const empty = visibleRows(rowOffsets(0, () => 0, GAP), 0, 600);
    expect(empty.first).toBeGreaterThan(empty.last);
  });

  it('draws a list of up to 200 rows whole', () => {
    expect(WINDOW_FROM_ROWS).toBe(200);
  });
});

describe('search over every line, drawn or not', () => {
  const texts = ['Hello and welcome', 'to İstanbul, the city', 'of cafés and ISTANBUL nights', '(anlaşılamadı)', 'welcome back'];

  it('ignores case, accents and the Turkish dotted / dotless i', () => {
    expect(foldForSearch('İstanbul IŞIK café')).toBe('istanbul isik cafe');
    expect(searchLines(texts, 'istanbul')).toEqual([1, 2]);
    expect(searchLines(texts, 'ISTANBUL')).toEqual([1, 2]);
    expect(searchLines(texts, 'ıstanbul')).toEqual([1, 2]);
    expect(searchLines(texts, 'cafe')).toEqual([2]);
    expect(searchLines(texts, '  welcome ')).toEqual([0, 4]);
  });

  it('finds the places that could not be written by their label, and nothing for a blank query', () => {
    expect(searchLines(texts, 'anlaşılamadı')).toEqual([3]);
    expect(searchLines(texts, '')).toEqual([]);
    expect(searchLines(texts, '   ')).toEqual([]);
    expect(searchLines(texts, 'zebra')).toEqual([]);
  });

  it('steps through the results in both directions and wraps round', () => {
    const matches = [3, 40, 2000];
    expect(nextMatch(matches, -1, 1)).toBe(3);
    expect(nextMatch(matches, 3, 1)).toBe(40);
    expect(nextMatch(matches, 2000, 1)).toBe(3);
    expect(nextMatch(matches, 41, 1)).toBe(2000);
    expect(nextMatch(matches, 3000, -1)).toBe(2000);
    expect(nextMatch(matches, 40, -1)).toBe(3);
    expect(nextMatch(matches, 3, -1)).toBe(2000);
    expect(nextMatch([], 0, 1)).toBe(-1);
  });
});
