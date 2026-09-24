import { describe, expect, it } from 'vitest';

import { ENVELOPE_FRAME_US, LoudnessMeter, splitMeterRange } from '@/domain/loudness';

function frameCount(part: { startUs: number; endUs: number }): number {
  return Math.max(0, Math.ceil((part.endUs - part.startUs) / ENVELOPE_FRAME_US));
}

describe('splitMeterRange (ADR-028)', () => {
  it('keeps short ranges whole and never makes more parts than frames', () => {
    expect(splitMeterRange(1_000, 50_000_000, 4, 30_000_000)).toEqual([{ startUs: 1_000, endUs: 50_000_000 }]);
    expect(splitMeterRange(0, 25_000, 4, 1)).toHaveLength(3);
  });

  it('covers the range exactly, on its own grid, with the same frame total', () => {
    for (const [start, end] of [
      [0, 3_600_000_000],
      [123_457, 1_200_000_001],
      [5_000_003, 185_000_000],
    ] as const) {
      const parts = splitMeterRange(start, end, 4, 30_000_000);
      expect(parts.length).toBeGreaterThan(1);
      expect(parts.length).toBeLessThanOrEqual(4);
      expect(parts[0]!.startUs).toBe(start);
      expect(parts.at(-1)!.endUs).toBe(end);
      for (let i = 1; i < parts.length; i += 1) {
        expect(parts[i]!.startUs).toBe(parts[i - 1]!.endUs);
        expect((parts[i]!.startUs - start) % ENVELOPE_FRAME_US).toBe(0);
      }
      expect(parts.reduce((sum, part) => sum + frameCount(part), 0)).toBe(frameCount({ startUs: start, endUs: end }));
    }
  });

  it('gives the same envelope as the whole range when the parts are put end to end', () => {
    const rate = 44_100;
    const startUs = 1_234_567;
    const endUs = 97_654_321;
    // A deterministic signal with changing loudness, fed in odd-sized chunks
    // on a fixed grid, like a codec's frames: a part decodes the same chunks
    // as the whole range, only starting later.
    const total = Math.ceil(((endUs + 200_000) * rate) / 1e6);
    const signal = new Float32Array(total);
    for (let i = 0; i < total; i += 1) signal[i] = Math.sin(i * 0.031) * (0.2 + 0.8 * Math.abs(Math.sin(i / 20_000)));
    const feed = (meter: LoudnessMeter, fromSample: number, toSample: number) => {
      for (let s = Math.floor(fromSample / 1021) * 1021; s < toSample; s += 1021) {
        const n = Math.min(1021, toSample - s);
        meter.push([signal.subarray(s, s + n)], s, n);
      }
    };
    const whole = new LoudnessMeter(startUs, endUs, rate);
    feed(whole, 0, total);
    const joined: number[] = [];
    for (const part of splitMeterRange(startUs, endUs, 4, 10_000_000)) {
      const meter = new LoudnessMeter(part.startUs, part.endUs, rate);
      // Each part is decoded from a little before its start, like the worker.
      feed(meter, Math.max(0, Math.floor(((part.startUs - 100_000) * rate) / 1e6)), total);
      joined.push(...meter.finish().db);
    }
    expect(joined).toEqual(whole.finish().db);
  });
});
