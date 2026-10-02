import { describe, expect, it } from 'vitest';

import { compareFrameIdentity, expectedSourceFrames } from '../../scripts/lib/av-sync.mjs';
import {
  contrast,
  distance,
  expectedFromSource,
  matchFrames,
  normalise,
  type ExpectedFrame,
  type SourceFrame,
} from '../../scripts/lib/frame-identity.mjs';

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


/** A synthetic source: frame k is a bright bar at row k (distinct frames), or one still picture. */
function sourceFrames(count: number, fps: number, { still = false, flat = false } = {}): SourceFrame[] {
  return Array.from({ length: count }, (_, k) => {
    const pixels = new Uint8Array(36 * 64);
    if (flat) {
      // A dark shot: one gray level with a little sensor noise.
      for (let i = 0; i < pixels.length; i += 1) pixels[i] = 12 + ((i * 7 + k) % 3);
    } else {
      const row = still ? 10 : k % 64;
      for (let x = 0; x < 36; x += 1) pixels[row * 36 + x] = 255;
      // A little fixed texture so normalisation has something to work with.
      for (let i = 0; i < pixels.length; i += 7) pixels[i] = Math.max(pixels[i] ?? 0, 40);
    }
    return { time: k / fps, frame: normalise(pixels), contrast: contrast(pixels) };
  });
}

/** Encode noise on top of a picture. */
function noisy(frame: Float32Array, seed: number): Float32Array {
  let state = seed;
  return frame.map((v) => {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    return v + (state / 2 ** 31 - 0.5) * 0.05;
  });
}

/** A faithful export: each output frame shows its expected source frame. */
function faithful(source: SourceFrame[], expected: ExpectedFrame[]): Float32Array[] {
  return expected.map((e, i) => noisy((source[e.index] as SourceFrame).frame, i + 1));
}

describe('expectedFromSource', () => {
  it('maps the 30 fps output grid onto the source frames, kesit by kesit', () => {
    const times = sourceFrames(360, 30).map((s) => s.time);
    const expected = expectedFromSource(times, [[1.2, 6.5]]);
    expect(expected.length).toBe(159);
    expect(expected[0]?.index).toBe(36);
    expect(expected.at(-1)?.index).toBe(194);
    expect(expectedFromSource(times, [[0.2, 1.5], [2, 4.3]]).map((e) => e.count)).toEqual([
      ...Array(39).fill(39),
      ...Array(69).fill(69),
    ]);
  });

  it('keeps the frame on screen when the next one starts just after the instant (VFR, R06)', () => {
    // A source frame starting 1.3 ms after an output instant is not shown yet; within 1 ms it is.
    const times = [0, 0.0347, 0.0675];
    const [first, second, third] = expectedFromSource(times, [[0, 0.1]]);
    expect(first?.index).toBe(0);
    expect(second?.index).toBe(0); // t = 33.3 ms, the next frame starts 1.4 ms later
    expect(third?.index).toBe(2); // t = 66.7 ms, the frame at 67.5 ms is within the 1 ms slack
  });
});

describe('matchFrames (against the source frames)', () => {
  it('finds no wrong frame in a faithful export', () => {
    const source = sourceFrames(120, 30);
    const expected = expectedFromSource(source.map((s) => s.time), [[0.5, 3.5]]);
    const result = matchFrames(faithful(source, expected), source, expected);
    expect(result.wrong).toBe(0);
    expect(result.undecidable).toBe(0);
  });

  it('finds a frozen kesit end and says how far back it looks', () => {
    const source = sourceFrames(120, 30);
    const expected = expectedFromSource(source.map((s) => s.time), [[0, 3]]);
    const out = faithful(source, expected);
    // Output frames 83..89 show source frame 82 (the phone's stale end).
    for (let i = 83; i < 90; i += 1) out[i] = noisy((source[82] as SourceFrame).frame, 100 + i);
    const result = matchFrames(out, source, expected);
    expect(result.wrong).toBe(7);
    expect(result.byKesit[0]).toMatchObject({ wrongAtStart: 0, wrongInMiddle: 0, wrongAtEnd: 7 });
    expect(result.firstWrong.map((w) => w.sourceOffset)).toEqual([-1, -2, -3, -4, -5, -6, -7]);
    expect(result.firstWrong[0]?.looksLikeMs).toBe(-33);
  });

  it('reads a 60 fps source on the 30 fps grid (every second frame) without false alarms', () => {
    const source = sourceFrames(240, 60);
    const expected = expectedFromSource(source.map((s) => s.time), [[0.5, 3.5]]);
    expect(expected[1]?.index).toBe(32);
    const result = matchFrames(faithful(source, expected), source, expected);
    expect(result.wrong).toBe(0);
  });

  it('calls a still scene undecidable instead of right', () => {
    const source = sourceFrames(60, 30, { still: true });
    const expected = expectedFromSource(source.map((s) => s.time), [[0, 1]]);
    const result = matchFrames(faithful(source, expected), source, expected);
    expect(result.wrong).toBe(0);
    expect(result.undecidable).toBe(30);
  });

  it('calls a flat (dark) shot undecidable, even when its noise looks like another frame (R07)', () => {
    const source = sourceFrames(60, 30, { flat: true });
    const expected = expectedFromSource(source.map((s) => s.time), [[0, 1]]);
    // The export shows frame k+1's noise pattern: on a flat shot that proves nothing.
    const out = expected.map((e, i) => noisy((source[e.index + 1] as SourceFrame).frame, i + 1));
    const result = matchFrames(out, source, expected);
    expect(result.wrong).toBe(0);
    expect(result.undecidable).toBe(30);
  });

  it('locates wrong frames per kesit', () => {
    const source = sourceFrames(120, 30);
    const expected = expectedFromSource(source.map((s) => s.time), [[0, 1], [2, 3]]);
    const out = faithful(source, expected);
    out[29] = noisy((source[27] as SourceFrame).frame, 7); // first kesit's last frame
    out[30] = noisy((source[62] as SourceFrame).frame, 8); // second kesit's first frame shows a later one
    const result = matchFrames(out, source, expected);
    expect(result.byKesit.map((k) => [k.wrongAtStart, k.wrongInMiddle, k.wrongAtEnd])).toEqual([
      [0, 0, 1],
      [1, 0, 0],
    ]);
  });

  it('counts a frame that looks like nothing near its instant as unmatched, not right', () => {
    const source = sourceFrames(120, 30);
    const expected = expectedFromSource(source.map((s) => s.time), [[0, 1], [2, 3]]);
    const out = faithful(source, expected);
    // The second kesit's first frame shows the first kesit's end, 1 s away.
    out[30] = noisy((source[29] as SourceFrame).frame, 9);
    const result = matchFrames(out, source, expected);
    expect(result.unmatched).toBe(1);
    expect(result.byKesit[1]?.unmatched).toBe(1);
  });

  it('counts output frames that are not there as unmatched', () => {
    const source = sourceFrames(60, 30);
    const expected = expectedFromSource(source.map((s) => s.time), [[0, 1]]);
    const result = matchFrames(faithful(source, expected).slice(0, 28), source, expected);
    expect(result.byKesit[0]?.unmatched).toBe(2);
  });

  it('normalises away a level change (an HDR tone map, an encoder offset)', () => {
    const a = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80]);
    const b = a.map((v) => v * 2 + 30);
    expect(distance(normalise(a), normalise(b))).toBeLessThan(1e-6);
  });
});
