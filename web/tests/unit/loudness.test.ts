import { describe, expect, it } from 'vitest';

import { LoudnessMeter, meanSquareToDb } from '@/domain/loudness';
import { FLOOR_DB } from '@/domain/silence';

const S = 1_000_000;

function constant(value: number, length: number): Float32Array {
  return new Float32Array(length).fill(value);
}

describe('meanSquareToDb', () => {
  it('maps full-scale to 0 dB and clamps silence to the floor', () => {
    expect(meanSquareToDb(1)).toBeCloseTo(0, 9);
    expect(meanSquareToDb(0.25 * 0.25)).toBeCloseTo(-12.0412, 3);
    expect(meanSquareToDb(0)).toBe(FLOOR_DB);
    expect(meanSquareToDb(Number.NaN)).toBe(FLOOR_DB);
    expect(meanSquareToDb(1e-20)).toBe(FLOOR_DB);
  });
});

describe('LoudnessMeter', () => {
  it('frames a 48 kHz range into 480-sample frames', () => {
    const meter = new LoudnessMeter(0, 1 * S, 48_000);
    expect(meter.frameCount).toBe(100);
    expect(meter.boundary(1)).toBe(480);
    expect(meter.boundary(100)).toBe(48_000);
  });

  it('keeps 44.1 kHz frames on the 10 ms grid without drift', () => {
    const meter = new LoudnessMeter(0, 10 * S, 44_100);
    expect(meter.frameCount).toBe(1000);
    expect(meter.boundary(1)).toBe(441);
    expect(meter.boundary(999)).toBe(440_559);
    // 22.05 kHz has a fractional frame size (220.5): boundaries round per frame.
    const half = new LoudnessMeter(0, 1 * S, 22_050);
    expect(half.boundary(1)).toBe(221);
    expect(half.boundary(2)).toBe(441);
  });

  it('measures RMS of the mono mix per frame', () => {
    const meter = new LoudnessMeter(0, 20_000, 48_000);
    // Frame 0: square wave ±0.5 (RMS 0.5, −6.02 dB). Frame 1: digital silence.
    const left = new Float32Array(960);
    for (let i = 0; i < 480; i += 1) left[i] = i % 2 === 0 ? 0.5 : -0.5;
    meter.push([left], 0, 960);
    const { db, frameUs, startUs } = meter.finish();
    expect(frameUs).toBe(10_000);
    expect(startUs).toBe(0);
    expect(db[0]).toBeCloseTo(-6.0206, 3);
    expect(db[1]).toBe(FLOOR_DB);
  });

  it('downmixes by the mean of the channels (opposite phase cancels)', () => {
    const meter = new LoudnessMeter(0, 10_000, 48_000);
    meter.push([constant(0.5, 480), constant(-0.5, 480)], 0, 480);
    expect(meter.finish().db[0]).toBe(FLOOR_DB);

    const same = new LoudnessMeter(0, 10_000, 48_000);
    same.push([constant(0.5, 480), constant(0.5, 480)], 0, 480);
    expect(same.finish().db[0]).toBeCloseTo(-6.0206, 3);
  });

  it('gives the same result however the samples are chunked', () => {
    const signal = new Float32Array(4800);
    for (let i = 0; i < signal.length; i += 1) signal[i] = Math.sin(i / 7) * (i / signal.length);
    const whole = new LoudnessMeter(0, 100_000, 48_000);
    whole.push([signal], 0, signal.length);

    const chunked = new LoudnessMeter(0, 100_000, 48_000);
    for (let at = 0; at < signal.length; at += 333) {
      const part = signal.subarray(at, Math.min(signal.length, at + 333));
      chunked.push([part], at, part.length);
    }
    const a = whole.finish().db;
    const b = chunked.finish().db;
    expect(b).toHaveLength(a.length);
    a.forEach((value, index) => expect(b[index]).toBeCloseTo(value, 6));
  });

  it('ignores samples outside the range and aligns to the source clock', () => {
    // Range 1.000–1.020 s; the chunk starts 0.5 s earlier (decoders hand out
    // whole packets that begin before the requested time).
    const meter = new LoudnessMeter(1 * S, 1 * S + 20_000, 48_000);
    const chunk = new Float32Array(48_000);
    // Loud only inside the second frame of the range: samples 48 480–48 959.
    for (let i = 48_480 - 24_000; i < 48_960 - 24_000; i += 1) chunk[i] = 0.5;
    meter.push([chunk], 24_000, chunk.length);
    const { db, startUs } = meter.finish();
    expect(startUs).toBe(1 * S);
    expect(db[0]).toBe(FLOOR_DB);
    expect(db[1]).toBeCloseTo(-6.0206, 3);
  });

  it('includes a partial last frame and reports missing audio as silence', () => {
    const meter = new LoudnessMeter(0, 25_000, 48_000);
    expect(meter.frameCount).toBe(3);
    // Audio ends after 1.5 frames.
    meter.push([constant(0.5, 720)], 0, 720);
    const { db } = meter.finish();
    expect(db[0]).toBeCloseTo(-6.0206, 3);
    expect(db[1]).toBeCloseTo(-6.0206, 3);
    expect(db[2]).toBe(FLOOR_DB);
  });

  it('reports progress in frames the decode has passed', () => {
    const meter = new LoudnessMeter(0, 100_000, 48_000);
    expect(meter.framesDone).toBe(0);
    meter.push([constant(0.1, 2400)], 0, 2400);
    expect(meter.framesDone).toBe(5);
    meter.push([constant(0.1, 2400)], 2400, 2400);
    expect(meter.framesDone).toBe(10);
  });
});
