import { describe, expect, it } from 'vitest';

import {
  copyStartCandidates,
  fastCutEligibility,
  frameRateMatchesPlan,
  planSegmentCut,
  type FastCutSourceFacts,
} from '@/domain/fastPath';
import type { RenderPlan, RenderSegment } from '@/domain/renderPlan';

function segment(overrides: Partial<RenderSegment> = {}): RenderSegment {
  return {
    clipId: 'c1',
    assetId: 'a1',
    startFrame: 0,
    endFrame: 300,
    sourceInUs: 1_000_000,
    sourceOutUs: 11_000_000,
    crop: { x: 0, y: 0, width: 1920, height: 1080 },
    fit: 'cover',
    gain: 1,
    muted: false,
    ...overrides,
  };
}

type PlanPart = Pick<RenderPlan, 'width' | 'height' | 'captions' | 'segments'>;

function plan(overrides: Partial<PlanPart> = {}): PlanPart {
  return { width: 1920, height: 1080, captions: null, segments: [segment()], ...overrides };
}

function facts(overrides: Partial<FastCutSourceFacts> = {}): FastCutSourceFacts {
  return {
    codec: 'avc',
    isobmff: true,
    hdr: false,
    sps: { chromaFormatIdc: 1, bitDepthLuma: 8, bitDepthChroma: 8, frameMbsOnly: true },
    lengthSize: 4,
    displayWidth: 1920,
    displayHeight: 1080,
    squarePixels: true,
    fullRange: false,
    wideGamut: false,
    needsReorderFix: false,
    ...overrides,
  };
}

describe('fastCutEligibility', () => {
  it('allows a 1080p H.264 source exported whole-frame at 1080p', () => {
    expect(fastCutEligibility(plan(), facts(), 'auto')).toEqual({ ok: true });
  });

  it('refuses with the first reason that applies, in a fixed order', () => {
    const reason = (p: PlanPart, f: FastCutSourceFacts, mode: 'auto' | 'encode' = 'auto') => {
      const result = fastCutEligibility(p, f, mode);
      return result.ok ? 'ok' : result.reason;
    };
    expect(reason(plan(), facts(), 'encode')).toBe('requested_encode');
    const captions = { language: 'tr', style: {} as never, cues: [] };
    expect(reason(plan({ captions }), facts())).toBe('captions');
    expect(reason(plan(), facts({ hdr: true }))).toBe('hdr');
    expect(reason(plan(), facts({ codec: 'hevc' }))).toBe('codec');
    expect(reason(plan(), facts({ isobmff: false }))).toBe('codec');
    // HDR is named even when the codec would also refuse: tone mapping is the real reason.
    expect(reason(plan(), facts({ hdr: true, codec: 'hevc' }))).toBe('hdr');
  });

  it('separates a user crop, a different frame shape and a different size', () => {
    const zoomed = plan({ segments: [segment({ crop: { x: 100, y: 50, width: 1600, height: 900 } })] });
    expect(fastCutEligibility(zoomed, facts(), 'auto')).toEqual({ ok: false, reason: 'crop' });

    // Vertical phone video in a 16:9 frame: the editor's cover crop is the framing.
    const vertical = facts({ displayWidth: 1080, displayHeight: 1920 });
    const covered = plan({ segments: [segment({ crop: { x: 0, y: 656, width: 1080, height: 608 } })] });
    expect(fastCutEligibility(covered, vertical, 'auto')).toEqual({ ok: false, reason: 'aspect' });

    // 4K source, 1080p download: same shape, other size.
    const uhd = facts({ displayWidth: 3840, displayHeight: 2160 });
    const uhdPlan = plan({ segments: [segment({ crop: { x: 0, y: 0, width: 3840, height: 2160 } })] });
    expect(fastCutEligibility(uhdPlan, uhd, 'auto')).toEqual({ ok: false, reason: 'resolution' });

    // 720p source at 720p is fine; 720p source in a 1080p download is not.
    const hd = facts({ displayWidth: 1280, displayHeight: 720 });
    const hdSegments = [segment({ crop: { x: 0, y: 0, width: 1280, height: 720 } })];
    expect(fastCutEligibility(plan({ width: 1280, height: 720, segments: hdSegments }), hd, 'auto')).toEqual({ ok: true });
    expect(fastCutEligibility(plan({ segments: hdSegments }), hd, 'auto')).toEqual({ ok: false, reason: 'resolution' });
  });

  it('allows a rotated phone video whose display size is the frame (rotation is carried, not drawn)', () => {
    const rotated = facts({ displayWidth: 1080, displayHeight: 1920 });
    const vertical = plan({
      width: 1080,
      height: 1920,
      segments: [segment({ crop: { x: 0, y: 0, width: 1080, height: 1920 } })],
    });
    expect(fastCutEligibility(vertical, rotated, 'auto')).toEqual({ ok: true });
  });

  it('refuses bitstreams the copy cannot carry', () => {
    const sps = { chromaFormatIdc: 1, bitDepthLuma: 8, bitDepthChroma: 8, frameMbsOnly: true };
    const refuse = (f: Partial<FastCutSourceFacts>) => fastCutEligibility(plan(), facts(f), 'auto');
    expect(refuse({ sps: null })).toEqual({ ok: false, reason: 'bitstream' });
    expect(refuse({ sps: { ...sps, bitDepthLuma: 10, bitDepthChroma: 10 } })).toEqual({ ok: false, reason: 'bitstream' });
    expect(refuse({ sps: { ...sps, chromaFormatIdc: 2 } })).toEqual({ ok: false, reason: 'bitstream' });
    expect(refuse({ sps: { ...sps, frameMbsOnly: false } })).toEqual({ ok: false, reason: 'bitstream' });
    expect(refuse({ lengthSize: 2 })).toEqual({ ok: false, reason: 'bitstream' });
    expect(refuse({ squarePixels: false })).toEqual({ ok: false, reason: 'pixel_aspect' });
    expect(refuse({ fullRange: true })).toEqual({ ok: false, reason: 'color' });
    expect(refuse({ wideGamut: true })).toEqual({ ok: false, reason: 'color' });
    expect(refuse({ needsReorderFix: true })).toEqual({ ok: false, reason: 'reorder' });
  });
});

describe('frameRateMatchesPlan', () => {
  const grid = (count: number, step: number, from = 0) =>
    Array.from({ length: count }, (_, i) => Math.round(from + i * step));

  it('accepts a source whose frames sit on the 30 fps grid, in any clock', () => {
    expect(frameRateMatchesPlan(grid(300, 512), 15360, 30, 1)).toBe(true);
    expect(frameRateMatchesPlan(grid(300, 20), 600, 30, 1)).toBe(true);
    expect(frameRateMatchesPlan(grid(300, 3000, 4500), 90000, 30, 1)).toBe(true);
    // 12288 / 30 = 409.6 ticks: rounded frame times alternate 409/410.
    expect(frameRateMatchesPlan(grid(300, 409.6), 12288, 30, 1)).toBe(true);
  });

  it('refuses 60, 29.97, 25 fps and a variable rate (the full encode puts them on the grid)', () => {
    expect(frameRateMatchesPlan(grid(300, 1500), 90000, 30, 1)).toBe(false);
    expect(frameRateMatchesPlan(grid(300, 1001), 30000, 30, 1)).toBe(false);
    expect(frameRateMatchesPlan(grid(250, 24), 600, 30, 1)).toBe(false);
    const vfr = [...grid(30, 20), ...grid(30, 21, 600)];
    expect(frameRateMatchesPlan(vfr, 600, 30, 1)).toBe(false);
    // One dropped frame (a 2-frame gap) is not the grid either.
    expect(frameRateMatchesPlan([0, 512, 1536, 2048], 15360, 30, 1)).toBe(false);
  });

  it('accepts a single frame', () => {
    expect(frameRateMatchesPlan([0], 15360, 30, 1)).toBe(true);
    expect(frameRateMatchesPlan([], 15360, 30, 1)).toBe(true);
  });
});

/** A decode-order packet list: `gops` GOPs, each in the pattern `order` (presentation offsets). */
function stream(gops: number, order: number[]) {
  const pts: number[] = [];
  const key: boolean[] = [];
  const size = order.length;
  for (let g = 0; g < gops; g += 1) {
    for (const [i, offset] of order.entries()) {
      pts.push(g * size + offset);
      key.push(i === 0);
    }
  }
  return { pts, key };
}

describe('copyStartCandidates / planSegmentCut', () => {
  it('no B-frames: re-encodes up to the next IDR, copies to the last marked frame', () => {
    const { pts, key } = stream(4, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    // Marked frames 3..26: IDRs at 0, 10, 20, 30.
    const candidates = copyStartCandidates(pts, key, 3, 26);
    expect(candidates).toEqual([10, 20]);
    const result = planSegmentCut(pts, 10, 3, 26);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cut.head).toEqual([3, 4, 5, 6, 7, 8, 9]);
    expect(result.cut.copyFrom).toBe(10);
    // Without B-frames every packet boundary is safe: the copy runs to frame 26.
    expect(result.cut.copyTo).toBe(27);
    expect(result.cut.tail).toEqual([]);
    expect(result.cut.frames).toHaveLength(24);
  });

  it('IBBP: stops the copy where every shown picture is decoded, re-encodes the rest', () => {
    // Decode order I0 P3 B1 B2 P6 B4 B5 P9 B7 B8 per GOP of 10 (display 0..9).
    const order = [0, 3, 1, 2, 6, 4, 5, 9, 7, 8];
    const { pts, key } = stream(3, order);
    const result = planSegmentCut(pts, 10, 5, 24);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cut.head).toEqual([5, 6, 7, 8, 9]);
    // Copy I10 P13 B11 B12 P16 B14 B15 P19 B17 B18 I20 P23 B21 B22 -> shows 10..23.
    expect(result.cut.copyFrom).toBe(10);
    expect(result.cut.copyTo).toBe(24);
    expect(result.cut.tail).toEqual([24]);
    expect(result.cut.head.length + (result.cut.copyTo - result.cut.copyFrom) + result.cut.tail.length).toBe(20);
  });

  it('a cut exactly on an IDR copies everything (method copy)', () => {
    const order = [0, 3, 1, 2, 6, 4, 5, 9, 7, 8];
    const { pts, key } = stream(3, order);
    expect(copyStartCandidates(pts, key, 10, 19)).toEqual([10]);
    const result = planSegmentCut(pts, 10, 10, 19);
    expect(result.ok && result.cut.head.length === 0 && result.cut.tail.length === 0).toBe(true);
  });

  it('leading B-frames after an IDR (GoPro pattern): the copy starts at the first shown picture', () => {
    // Per GOP of 8: IDR shown 3rd, then B-frames shown before it (ADR-014 §3).
    const order = [3, 1, 0, 2, 7, 5, 4, 6];
    const { pts, key } = stream(3, order);
    // Key packets at 0, 8, 16; the second GOP shows 8..15 and starts at pts 8.
    expect(copyStartCandidates(pts, key, 5, 21)).toEqual([8, 16]);
    const result = planSegmentCut(pts, 8, 5, 21);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cut.head).toEqual([5, 6, 7]);
    expect(result.cut.frames[0]).toBe(5);
    expect(result.cut.frames[result.cut.frames.length - 1]).toBe(21);
  });

  it('timestamps alone cannot see an open GOP: the IDR check in the worker must', () => {
    // Open GOP: key I9 (decode index 7) is followed by B7, B8 that reference
    // the previous GOP. In presentation times it looks clean, so it IS a
    // candidate here; `isIdrPacket` (a non-IDR I slice) refuses it later.
    const pts = [0, 3, 1, 2, 6, 4, 5, 9, 7, 8, 12, 10, 11];
    const key = pts.map((_, i) => i === 0 || i === 7);
    expect(copyStartCandidates(pts, key, 1, 12)).toEqual([7]);
  });

  it('a key packet with a picture decoded before it but shown after its first picture is never a start', () => {
    // I0 P5 B1 B2 | K3 B4: P5 (decoded before K) is shown after K's picture 3.
    const pts = [0, 5, 1, 2, 3, 4];
    const key = [true, false, false, false, true, false];
    expect(copyStartCandidates(pts, key, 1, 5)).toEqual([]);
  });

  it('without a usable IDR the whole moment is re-encoded', () => {
    const { pts } = stream(1, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const result = planSegmentCut(pts, null, 2, 8);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cut.head).toEqual([2, 3, 4, 5, 6, 7, 8]);
    expect(result.cut.copyTo - result.cut.copyFrom).toBe(0);
  });

  it('an IDR whose first picture is after the last marked frame copies nothing', () => {
    const { pts } = stream(2, [0, 1, 2, 3, 4]);
    const result = planSegmentCut(pts, 5, 1, 3);
    expect(result.ok && result.cut.copyTo === result.cut.copyFrom && result.cut.head.length === 3).toBe(true);
  });

  it('refuses duplicate timestamps and marked frames that do not exist', () => {
    expect(planSegmentCut([0, 1, 1, 2], 0, 0, 2)).toEqual({ ok: false, reason: 'timing' });
    expect(planSegmentCut([0, 2, 4], 0, 1, 4)).toEqual({ ok: false, reason: 'timing' });
  });

  it('keeps every marked frame exactly once over many cut positions', () => {
    const order = [0, 4, 2, 1, 3, 8, 6, 5, 7, 12, 10, 9, 11]; // pyramid, GOP 13
    const { pts, key } = stream(5, order);
    for (let first = 0; first < 40; first += 3) {
      for (let last = first; last < 60; last += 7) {
        const start = copyStartCandidates(pts, key, first, last)[0] ?? null;
        const result = planSegmentCut(pts, start, first, last);
        expect(result.ok).toBe(true);
        if (!result.ok) continue;
        const copied = pts.slice(result.cut.copyFrom, result.cut.copyTo);
        const all = [...result.cut.head, ...copied, ...result.cut.tail].sort((a, b) => a - b);
        expect(all).toEqual(Array.from({ length: last - first + 1 }, (_, i) => first + i));
        // Copied pictures are one contiguous run between head and tail.
        if (copied.length > 0) {
          expect(Math.max(...result.cut.head, -1)).toBeLessThan(Math.min(...copied));
          expect(Math.max(...copied)).toBeLessThan(Math.min(...result.cut.tail, Infinity));
        }
      }
    }
  });
});
