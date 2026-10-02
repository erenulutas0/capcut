import { describe, expect, it } from 'vitest';

import { compareFrameIdentity, expectedSourceFrames } from '../../scripts/lib/av-sync.mjs';
import { distance, kesitFrameCounts, matchFrames, normalise } from '../../scripts/lib/frame-identity.mjs';

/** ADR-033: which source frame each output frame shows (the pure parts of the tooling). */

describe('expectedSourceFrames (barcode clips)', () => {
  it('is the kesit frames in order for a 30 fps source', () => {
    const [kesit] = expectedSourceFrames([[1.2, 6.5]]);
    expect(kesit?.frames.length).toBe(159);
    expect(kesit?.frames[0]).toBe(36);
    expect(kesit?.frames.at(-1)).toBe(194);
    expect(kesit?.frames.every((f, i) => f === 36 + i)).toBe(true);
  });

  it('is the whole clip when there is no kesit', () => {
    const [whole] = expectedSourceFrames([]);
    expect(whole?.frames.length).toBe(360);
    expect(whole?.frames.at(-1)).toBe(359);
  });

  it('shows a 24 fps frame twice where the 30 fps grid needs it, never one from the future', () => {
    const kesits = expectedSourceFrames([[0.4, 3.3], [9.5, 12]], { sourceFps: 24 });
    expect(kesits.map((k) => k.frames.length)).toEqual([87, 75]);
    const first = kesits[0]?.frames ?? [];
    // 0.4 s is 24 fps frame 9.6: frame 9 is on screen.
    expect(first[0]).toBe(9);
    for (let i = 0; i < first.length; i += 1) {
      const t = 0.4 + i / 30;
      expect(first[i]).toBe(Math.floor((t + 0.001) * 24));
    }
    // The clip's last frame (287) ends the second kesit.
    expect(kesits[1]?.frames.at(-1)).toBe(287);
  });
});

describe('compareFrameIdentity', () => {
  it('locates stale frames at a kesit end, apart from start and middle', () => {
    const expected = expectedSourceFrames([[1.2, 6.5]]);
    const shown = [...(expected[0]?.frames ?? [])];
    // O on the phone: the last two frames showed source frame 192.
    shown[157] = 192;
    shown[158] = 192;
    const result = compareFrameIdentity(shown, expected);
    expect(result.wrong).toBe(2);
    expect(result.byKesit[0]).toMatchObject({ wrongAtStart: 0, wrongInMiddle: 0, wrongAtEnd: 2 });
    expect(result.firstWrong[0]).toMatchObject({ outputFrame: 157, shows: 192, expected: 193 });
  });

  it('counts a missing output frame as wrong', () => {
    const expected = expectedSourceFrames([[0, 1]]);
    const shown = (expected[0]?.frames ?? []).slice(0, 29);
    const result = compareFrameIdentity(shown, expected);
    expect(result.wrong).toBe(1);
    expect(result.firstWrong[0]).toMatchObject({ outputFrame: 29, shows: null });
  });

  it('tells the first kesit end from the second kesit start', () => {
    const expected = expectedSourceFrames([[0, 2], [5, 7]]);
    const shown = expected.flatMap((k) => k.frames);
    shown[59] = 58; // first kesit's last frame stale
    shown[60] = 59; // second kesit's first frame from the first kesit
    const result = compareFrameIdentity(shown, expected);
    expect(result.byKesit.map((k) => [k.wrongAtStart, k.wrongAtEnd])).toEqual([
      [0, 1],
      [1, 0],
    ]);
  });
});

/** A synthetic "video": frame k is a bright bar at row k (distinct frames), or one still picture. */
function movingFrames(count: number, { still = false } = {}): Float32Array[] {
  return Array.from({ length: count }, (_, k) => {
    const pixels = new Uint8Array(36 * 64);
    const row = still ? 10 : k % 64;
    for (let x = 0; x < 36; x += 1) pixels[row * 36 + x] = 255;
    // A little fixed texture so normalisation has something to work with.
    for (let i = 0; i < pixels.length; i += 7) pixels[i] = Math.max(pixels[i] ?? 0, 40);
    return normalise(pixels);
  });
}

/** The output: the reference plus a little encode noise. */
function noisy(frames: Float32Array[], seed = 1): Float32Array[] {
  let state = seed;
  const random = () => {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    return state / 2 ** 31 - 0.5;
  };
  return frames.map((frame) => frame.map((v) => v + random() * 0.05));
}

describe('matchFrames (reference identity)', () => {
  it('finds no wrong frame in a faithful export', () => {
    const ref = movingFrames(60);
    const result = matchFrames(noisy(ref), ref, [60]);
    expect(result.wrong).toBe(0);
    expect(result.undecidable).toBe(0);
  });

  it('finds a frozen kesit end and says how far back it looks', () => {
    const ref = movingFrames(90);
    const out = noisy(ref);
    // Frames 83..89 show frame 82 (the phone's stale end).
    for (let i = 83; i < 90; i += 1) out[i] = noisy([ref[82] as Float32Array], i)[0] as Float32Array;
    const result = matchFrames(out, ref, [90]);
    expect(result.wrong).toBe(7);
    expect(result.byKesit[0]).toMatchObject({ wrongAtStart: 0, wrongInMiddle: 0, wrongAtEnd: 7 });
    expect(result.firstWrong.map((w) => w.looksLike)).toEqual([-1, -2, -3, -4, -5, -6, -7]);
  });

  it('calls a still scene undecidable instead of right', () => {
    const ref = movingFrames(30, { still: true });
    const result = matchFrames(noisy(ref), ref, [30]);
    expect(result.wrong).toBe(0);
    expect(result.undecidable).toBe(30);
  });

  it('locates wrong frames per kesit', () => {
    const ref = movingFrames(60);
    const out = noisy(ref);
    out[29] = noisy([ref[27] as Float32Array], 3)[0] as Float32Array;
    out[30] = noisy([ref[29] as Float32Array], 4)[0] as Float32Array;
    const result = matchFrames(out, ref, [30, 30]);
    expect(result.byKesit.map((k) => [k.wrongAtStart, k.wrongInMiddle, k.wrongAtEnd])).toEqual([
      [0, 0, 1],
      [1, 0, 0],
    ]);
  });

  it('counts output frames the reference does not have as unmatched', () => {
    const ref = movingFrames(20);
    const result = matchFrames(noisy(movingFrames(22)), ref, [22]);
    expect(result.byKesit[0]?.unmatched).toBe(2);
  });

  it('normalises away a level change (an HDR tone map, an encoder offset)', () => {
    const a = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80]);
    const b = a.map((v) => v * 2 + 30);
    expect(distance(normalise(a), normalise(b))).toBeLessThan(1e-6);
  });

  it('counts kesit frames the way the render plan rounds them', () => {
    expect(kesitFrameCounts([[1.2, 6.5]])).toEqual([159]);
    expect(kesitFrameCounts([[0.2, 1.5], [2, 4.3]])).toEqual([39, 69]);
    expect(kesitFrameCounts([[0, 3], [8, 11.5]])).toEqual([90, 105]);
  });
});
