import { describe, expect, it } from 'vitest';

import { GifWriter, TRANSPARENT_INDEX, buildGifPalette } from '@/adapters/gif/gifEncode';
import {
  GIF_DEFAULT_DURATION_US,
  GIF_FIXED_BYTES,
  GIF_FRAME_DELAY_CS,
  GIF_MAX_DURATION_US,
  GIF_TEXT_MAX_CHARS,
  GIF_TEXT_MIN_PX,
  cleanGifText,
  estimateGifBytes,
  gifFileName,
  gifFrameTimesUs,
  gifRangeLength,
  initialGifRange,
  layoutGifText,
  mediumIsLarger,
  moveGifEdge,
  moveGifRange,
  normalizeGifRange,
  planGifSize,
  wrapGifText,
  type MeasureGifText,
} from '@/domain/gif';
import { inspectGif } from '@/domain/gifInspect';
import { indexFrame, keepUnchanged, nearestCache, nearestIndex, type GifPalette } from '@/domain/gifPalette';
import { WEB_LOCAL_POLICY } from '@/domain/policy';

const S = 1_000_000;

/**
 * A stand-in for the bundled bold typeface: every letter as wide as its share of an em. Wide letters
 * (W, M, Ğ…) at 0.95 em, the rest at 0.62 em — Inter Bold's own widths are between 0.27 and 0.95.
 */
const measure: MeasureGifText = (text, fontPx) =>
  Array.from(text).reduce((sum, char) => sum + (/[WMĞŞÖÜ@]/u.test(char) ? 0.95 : char === ' ' ? 0.28 : 0.62) * fontPx, 0);

describe('GIF yap: the part', () => {
  it('is at most ten seconds, the policy’s own number', () => {
    expect(GIF_MAX_DURATION_US).toBe(10 * S);
    expect(WEB_LOCAL_POLICY.maxGifDurationUs).toBe(GIF_MAX_DURATION_US);
  });

  it('takes a video that fits in a GIF whole; a longer one starts with its first four seconds', () => {
    expect(initialGifRange(24 * S)).toEqual({ startUs: 0, endUs: GIF_DEFAULT_DURATION_US });
    expect(initialGifRange(10 * S)).toEqual({ startUs: 0, endUs: 10 * S });
    expect(initialGifRange(8 * S)).toEqual({ startUs: 0, endUs: 8 * S });
    expect(initialGifRange(2.5 * S)).toEqual({ startUs: 0, endUs: 2.5 * S });
  });

  it('moves as a whole and stays inside the video', () => {
    const range = { startUs: 0, endUs: 4 * S };
    expect(moveGifRange(range, 10 * S, 24 * S)).toEqual({ startUs: 10 * S, endUs: 14 * S });
    expect(moveGifRange(range, 30 * S, 24 * S)).toEqual({ startUs: 20 * S, endUs: 24 * S });
    expect(moveGifRange(range, -5 * S, 24 * S)).toEqual({ startUs: 0, endUs: 4 * S });
  });

  it('stops an edge at ten seconds and says so; a video’s own end is no cap', () => {
    const range = { startUs: 2 * S, endUs: 6 * S };
    const longer = moveGifEdge(range, 'end', 20 * S, 24 * S);
    expect(longer.range).toEqual({ startUs: 2 * S, endUs: 12 * S });
    expect(longer.capped).toBe(true);
    const earlier = moveGifEdge({ startUs: 14 * S, endUs: 20 * S }, 'start', 0, 24 * S);
    expect(earlier.range).toEqual({ startUs: 10 * S, endUs: 20 * S });
    expect(earlier.capped).toBe(true);
    // An 8-second video: dragging past its end is the end of the video, not the ten-second rule.
    const shortVideo = moveGifEdge({ startUs: 0, endUs: 4 * S }, 'end', 9 * S, 8 * S);
    expect(shortVideo).toEqual({ range: { startUs: 0, endUs: 8 * S }, capped: false });
    expect(moveGifEdge(range, 'start', 0, 24 * S)).toEqual({ range: { startUs: 0, endUs: 6 * S }, capped: false });
  });

  it('never gets shorter than half a second, nor turns inside out', () => {
    const range = { startUs: 2 * S, endUs: 6 * S };
    expect(moveGifEdge(range, 'end', 0, 24 * S).range).toEqual({ startUs: 2 * S, endUs: 2.5 * S });
    expect(moveGifEdge(range, 'start', 9 * S, 24 * S).range).toEqual({ startUs: 5.5 * S, endUs: 6 * S });
  });

  it('normalizes any part to the video', () => {
    expect(normalizeGifRange({ startUs: 0, endUs: 30 * S }, 24 * S)).toEqual({ startUs: 0, endUs: 10 * S });
    expect(normalizeGifRange({ startUs: 22 * S, endUs: 26 * S }, 24 * S)).toEqual({ startUs: 20 * S, endUs: 24 * S });
    expect(normalizeGifRange({ startUs: 0, endUs: 0.1 * S }, 0.3 * S)).toEqual({ startUs: 0, endUs: 0.3 * S });
  });

  it('takes a frame every 8 hundredths of a second: 50 frames for 4 s, 125 for 10 s', () => {
    expect(GIF_FRAME_DELAY_CS).toBe(8);
    const four = gifFrameTimesUs({ startUs: 3 * S, endUs: 7 * S });
    expect(four).toHaveLength(50);
    expect(four[0]).toBe(3 * S);
    expect(four[1]).toBe(3.08 * S);
    expect(four.at(-1)).toBeLessThan(7 * S);
    expect(gifFrameTimesUs({ startUs: 0, endUs: 10 * S })).toHaveLength(125);
    expect(gifFrameTimesUs({ startUs: 0, endUs: 0.05 * S })).toHaveLength(1);
    expect(gifRangeLength({ startUs: 3 * S, endUs: 7 * S })).toBe(4 * S);
  });
});

describe('GIF yap: the size', () => {
  it('is 320 (Küçük) or 480 (Orta) on the long edge, in the video’s own shape', () => {
    expect(planGifSize(1280, 720, 'small')).toEqual({ width: 320, height: 180 });
    expect(planGifSize(1280, 720, 'medium')).toEqual({ width: 480, height: 270 });
    expect(planGifSize(720, 1280, 'small')).toEqual({ width: 180, height: 320 });
    expect(planGifSize(1080, 1080, 'medium')).toEqual({ width: 480, height: 480 });
  });

  it('is never larger than the video (ADR-041)', () => {
    expect(planGifSize(400, 300, 'medium')).toEqual({ width: 400, height: 300 });
    expect(planGifSize(300, 200, 'small')).toEqual({ width: 300, height: 200 });
    expect(planGifSize(300, 200, 'medium')).toEqual({ width: 300, height: 200 });
    expect(mediumIsLarger(300, 200)).toBe(false);
    expect(mediumIsLarger(400, 300)).toBe(true);
    expect(mediumIsLarger(1920, 1080)).toBe(true);
  });

  it('names the file after the video', () => {
    expect(gifFileName('tatil günü.mp4')).toBe('tatil-günü_gif.gif');
    expect(gifFileName('.mp4')).toBe('video_gif.gif');
  });

  it('estimates from frames really encoded: a whole first frame, then what each later one costs', () => {
    expect(estimateGifBytes({ firstFrameBytes: 30_000, laterFrameBytes: 10_000 }, 50)).toBe(GIF_FIXED_BYTES + 30_000 + 49 * 10_000);
    expect(estimateGifBytes({ firstFrameBytes: 30_000, laterFrameBytes: 10_000 }, 1)).toBe(GIF_FIXED_BYTES + 30_000);
  });
});

describe('GIF yap: the text', () => {
  const landscape = { width: 320, height: 180 };
  const portrait = { width: 180, height: 320 };

  it('is cleaned the way it is drawn: spaces collapsed, at most 40 letters (Turkish letters and emoji count once)', () => {
    expect(cleanGifText('  pazartesi \n  sabahı  ')).toBe('pazartesi sabahı');
    expect(cleanGifText('   ')).toBe('');
    const long = 'ğ'.repeat(GIF_TEXT_MAX_CHARS + 5);
    expect(Array.from(cleanGifText(long))).toHaveLength(GIF_TEXT_MAX_CHARS);
    expect(Array.from(cleanGifText('😀'.repeat(50)))).toHaveLength(GIF_TEXT_MAX_CHARS);
  });

  it('is nothing at all when the box is empty', () => {
    expect(layoutGifText('', 'top', landscape, measure)).toBeNull();
    expect(layoutGifText('  ', 'bottom', landscape, measure)).toBeNull();
  });

  it('is one line, as large as the GIF allows, when it is short', () => {
    const layout = layoutGifText('PAZARTESİ', 'top', landscape, measure);
    expect(layout).not.toBeNull();
    expect(layout?.lines).toHaveLength(1);
    expect(layout?.fontPx).toBe(Math.round(180 * 0.14));
    expect(layout?.truncated).toBe(false);
    expect(layout?.lines[0]?.text).toBe('PAZARTESİ');
    // Top: near the top edge; centred.
    expect(layout?.top).toBeLessThan(20);
    expect(layout?.lines[0]?.centerX).toBe(160);
  });

  it('sits at the bottom for the bottom box', () => {
    const layout = layoutGifText('ŞAKA ŞAKA', 'bottom', landscape, measure);
    expect(layout?.bottom).toBeGreaterThan(160);
    expect(layout?.bottom).toBeLessThanOrEqual(180);
  });

  it('wraps to two lines and gets smaller before it would need a third', () => {
    const text = 'pazartesi sabahı işe giderken ben';
    const layout = layoutGifText(text, 'top', landscape, measure);
    expect(layout?.lines.length).toBeLessThanOrEqual(2);
    expect(layout?.truncated).toBe(false);
    for (const line of layout?.lines ?? []) expect(measure(line.text, layout?.fontPx ?? 0)).toBeLessThanOrEqual(layout?.maxWidth ?? 0);
    expect(layout?.lines.map((line) => line.text).join(' ')).toBe(text);
  });

  it('holds 40 letters of ordinary Turkish words even in the narrowest GIF (portrait, 180 wide)', () => {
    const text = 'çok güzel bir gün geçirdik ışıl ışıl ağ';
    expect(Array.from(text)).toHaveLength(39);
    const layout = layoutGifText(text, 'top', portrait, measure);
    expect(layout?.truncated).toBe(false);
    expect(layout?.lines.map((line) => line.text).join(' ')).toBe(text);
    expect(layout?.fontPx).toBeGreaterThanOrEqual(GIF_TEXT_MIN_PX);
  });

  it('cuts a word longer than a line between its letters, never inside a letter', () => {
    const lines = wrapGifText('İĞÜŞÖÇığüşöçİĞÜŞÖÇığüşöç😀😀', 20, 120, measure);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join('')).toBe('İĞÜŞÖÇığüşöçİĞÜŞÖÇığüşöç😀😀');
    for (const line of lines) expect(line).not.toMatch(/[\uD800-\uDBFF]$/);
  });

  it('ends in "…" and says so when even the smallest letters need a third line', () => {
    const layout = layoutGifText('W'.repeat(40), 'top', portrait, measure);
    expect(layout?.truncated).toBe(true);
    expect(layout?.lines).toHaveLength(2);
    expect(layout?.lines[1]?.text.endsWith('…')).toBe(true);
    expect(layout?.fontPx).toBe(GIF_TEXT_MIN_PX);
    for (const line of layout?.lines ?? []) expect(measure(line.text, GIF_TEXT_MIN_PX)).toBeLessThanOrEqual(layout?.maxWidth ?? 0);
  });
});

describe('GIF yap: palette and indices', () => {
  const palette: GifPalette = { colors: new Uint8Array([0, 0, 0, 255, 255, 255, 255, 0, 0, 0, 0, 255]), count: 4 };

  it('maps a colour to its nearest entry, and never to the one left for transparency', () => {
    expect(nearestIndex(palette, 250, 10, 5)).toBe(2);
    expect(nearestIndex(palette, 10, 10, 240)).toBe(3);
    expect(nearestIndex(palette, 0, 0, 0, 0)).not.toBe(0);
  });

  it('indexes a frame', () => {
    const rgba = new Uint8Array([255, 255, 255, 255, 0, 0, 0, 255, 250, 5, 5, 255, 3, 3, 250, 255]);
    const out = new Uint8Array(4);
    indexFrame(rgba, 4, nearestCache(palette), out);
    expect([...out]).toEqual([1, 0, 2, 3]);
  });

  it('leaves a pixel transparent only when it would be drawn in the very same colour', () => {
    const shown = new Uint8Array([1, 1, 2, 3]);
    const next = new Uint8Array([1, 0, 2, 0]);
    expect(keepUnchanged(next, shown, 255)).toBe(2);
    expect([...next]).toEqual([255, 0, 255, 0]);
    expect([...shown]).toEqual([1, 0, 2, 0]);
  });
});

/** A synthetic frame: a horizontal gradient plus a moving square. */
function frame(width: number, height: number, square: number): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const inSquare = x >= square && x < square + 10 && y >= 10 && y < 20;
      rgba[i] = inSquare ? 255 : Math.round((x / width) * 255);
      rgba[i + 1] = inSquare ? 40 : 120;
      rgba[i + 2] = inSquare ? 40 : Math.round((y / height) * 255);
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

describe('GIF yap: the file', () => {
  it('writes a GIF that loops for ever, 8 hundredths a frame, in its own size', () => {
    const frames = [frame(64, 36, 0), frame(64, 36, 5), frame(64, 36, 10)];
    const palette = buildGifPalette(frames, false);
    expect(palette.count).toBeLessThanOrEqual(TRANSPARENT_INDEX);
    const writer = new GifWriter(64, 36, palette);
    for (const f of frames) writer.add(f);
    const result = inspectGif(writer.finish());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.gif).toMatchObject({ width: 64, height: 36, frames: 3, loops: 0, globalColors: 256, durationCs: 24 });
    expect(result.gif.delaysCs).toEqual([8, 8, 8]);
  });

  it('keeps pure white and pure black when there is text', () => {
    const palette = buildGifPalette([frame(32, 32, 0)], true);
    const colors = Array.from({ length: palette.count }, (_, i) => [...palette.colors.subarray(i * 3, i * 3 + 3)].join(','));
    expect(colors).toContain('255,255,255');
    expect(colors).toContain('0,0,0');
  });

  it('costs almost nothing for a frame that did not change', () => {
    const still = frame(64, 64, 0);
    const palette = buildGifPalette([still], false);
    const writer = new GifWriter(64, 64, palette);
    writer.add(still);
    const first = writer.byteLength;
    writer.add(still);
    const second = writer.byteLength - first;
    expect(second).toBeLessThan(first / 10);
  });

  it('reads back only whole GIFs', () => {
    expect(inspectGif(new Uint8Array([1, 2, 3]))).toEqual({ ok: false, reason: 'too_short' });
    expect(inspectGif(new TextEncoder().encode('PNG89a...........'))).toEqual({ ok: false, reason: 'not_a_gif' });
    const palette = buildGifPalette([frame(16, 16, 0)], false);
    const writer = new GifWriter(16, 16, palette);
    writer.add(frame(16, 16, 0));
    const bytes = writer.finish();
    expect(inspectGif(bytes.subarray(0, bytes.length - 20)).ok).toBe(false);
    expect(inspectGif(bytes.subarray(0, bytes.length - 1))).toEqual({ ok: false, reason: 'truncated' });
  });
});
