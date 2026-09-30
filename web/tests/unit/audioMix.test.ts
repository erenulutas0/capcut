import { describe, expect, it } from 'vitest';

import {
  PcmRingBuffer,
  clampBuffers,
  interleave,
  mixStreamInto,
  musicEnvelope,
} from '@/domain/audioMix';

function ramp(length: number, start = 0): Float32Array {
  const data = new Float32Array(length);
  for (let i = 0; i < length; i += 1) data[i] = start + i;
  return data;
}

describe('PcmRingBuffer', () => {
  it('reads exact frames and returns silence outside the window', () => {
    const buffer = new PcmRingBuffer(1);
    buffer.append([ramp(4, 10)], 100, 4);

    expect(buffer.frameAt(100, 0)).toBe(10);
    expect(buffer.frameAt(103, 0)).toBe(13);
    expect(buffer.frameAt(99, 0)).toBe(0);
    expect(buffer.frameAt(104, 0)).toBe(0);
  });

  it('interpolates linearly between frames', () => {
    const buffer = new PcmRingBuffer(1);
    buffer.append([new Float32Array([0, 1])], 0, 2);
    expect(buffer.sampleAt(0.5, 0)).toBeCloseTo(0.5, 6);
    expect(buffer.sampleAt(0.25, 0)).toBeCloseTo(0.25, 6);
  });

  it('reads across two appended blocks', () => {
    const buffer = new PcmRingBuffer(1);
    buffer.append([new Float32Array([1, 2])], 0, 2);
    buffer.append([new Float32Array([3, 4])], 2, 2);
    expect(buffer.frameAt(2, 0)).toBe(3);
    expect(buffer.sampleAt(1.5, 0)).toBeCloseTo(2.5, 6);
  });

  it('drops consumed blocks so memory stays bounded', () => {
    const buffer = new PcmRingBuffer(1);
    buffer.append([ramp(10)], 0, 10);
    buffer.append([ramp(10, 10)], 10, 10);
    expect(buffer.firstFrame).toBe(0);

    buffer.trimBefore(10);
    expect(buffer.firstFrame).toBe(10);
    // Trimmed frames read as silence rather than stale data.
    expect(buffer.frameAt(5, 0)).toBe(0);
    expect(buffer.frameAt(12, 0)).toBe(12);
  });

  it('wraps the channel index for mono sources feeding a stereo mix', () => {
    const buffer = new PcmRingBuffer(1);
    buffer.append([new Float32Array([0.5])], 0, 1);
    expect(buffer.frameAt(0, 0)).toBe(0.5);
    expect(buffer.frameAt(0, 1)).toBe(0.5);
  });
});

describe('mixStreamInto', () => {
  it('copies a same-rate stream through with gain', () => {
    const buffer = new PcmRingBuffer(1);
    buffer.append([new Float32Array([1, 1, 1, 1])], 0, 4);
    const out = [new Float32Array(4), new Float32Array(4)];

    mixStreamInto(out, 4, buffer, 0, 1, 0.5);
    expect(Array.from(out[0]!)).toEqual([0.5, 0.5, 0.5, 0.5]);
    expect(Array.from(out[1]!)).toEqual([0.5, 0.5, 0.5, 0.5]);
  });

  it('adds rather than overwrites, so two streams mix', () => {
    const a = new PcmRingBuffer(1);
    a.append([new Float32Array([0.4, 0.4])], 0, 2);
    const b = new PcmRingBuffer(1);
    b.append([new Float32Array([0.1, 0.1])], 0, 2);

    const out = [new Float32Array(2)];
    mixStreamInto(out, 2, a, 0, 1, 1);
    mixStreamInto(out, 2, b, 0, 1, 1);
    expect(out[0]![0]).toBeCloseTo(0.5, 6);
  });

  it('resamples with the source/output rate ratio', () => {
    const buffer = new PcmRingBuffer(1);
    buffer.append([new Float32Array([0, 1, 2, 3])], 0, 4);
    const out = [new Float32Array(4)];

    // 24 kHz source into a 48 kHz output: half a source frame per output frame.
    mixStreamInto(out, 4, buffer, 0, 0.5, 1);
    expect(Array.from(out[0]!)).toEqual([0, 0.5, 1, 1.5]);
  });

  it('applies a per-frame gain curve', () => {
    const buffer = new PcmRingBuffer(1);
    buffer.append([new Float32Array([1, 1, 1])], 0, 3);
    const out = [new Float32Array(3)];
    mixStreamInto(out, 3, buffer, 0, 1, new Float32Array([0, 0.5, 1]));
    expect(Array.from(out[0]!)).toEqual([0, 0.5, 1]);
  });

  it('does nothing at zero gain', () => {
    const buffer = new PcmRingBuffer(1);
    buffer.append([new Float32Array([1, 1])], 0, 2);
    const out = [new Float32Array(2)];
    mixStreamInto(out, 2, buffer, 0, 1, 0);
    expect(Array.from(out[0]!)).toEqual([0, 0]);
  });
});

describe('musicEnvelope', () => {
  const music = {
    sourceInUs: 5_000_000,
    sourceOutUs: 15_000_000,
    timelineStartUs: 0,
    fadeInUs: 1_000_000,
    fadeOutUs: 1_000_000,
    gain: 1,
  };

  it('is silent before the timeline start and after the selection', () => {
    const delayed = { ...music, timelineStartUs: 2_000_000 };
    // 48 kHz: frame 48000 == output second 1, which is before the start.
    const before = musicEnvelope(delayed, 48_000, 1, 48_000);
    expect(before[0]).toBe(0);

    const after = musicEnvelope(music, 48_000 * 11, 1, 48_000);
    expect(after[0]).toBe(0);
  });

  it('ramps in and out linearly and holds at full gain between', () => {
    const fadeInHalf = musicEnvelope(music, 24_000, 1, 48_000);
    expect(fadeInHalf[0]).toBeCloseTo(0.5, 5);

    const middle = musicEnvelope(music, 48_000 * 5, 1, 48_000);
    expect(middle[0]).toBeCloseTo(1, 6);

    const fadeOutHalf = musicEnvelope(music, 48_000 * 9 + 24_000, 1, 48_000);
    expect(fadeOutHalf[0]).toBeCloseTo(0.5, 5);
  });

  it('scales the whole envelope by the track gain', () => {
    const quiet = musicEnvelope({ ...music, gain: 0.25 }, 48_000 * 5, 1, 48_000);
    expect(quiet[0]).toBeCloseTo(0.25, 6);
  });

  it('is entirely silent when the track is muted to zero gain', () => {
    const silent = musicEnvelope({ ...music, gain: 0 }, 0, 16, 48_000);
    expect(Array.from(silent).every((value) => value === 0)).toBe(true);
  });
});

describe('output shaping', () => {
  it('limits values that would otherwise clip', () => {
    const out = [new Float32Array([1.4, -1.9, 0.2])];
    clampBuffers(out, 3);
    expect(out[0]![0]).toBe(1);
    expect(out[0]![1]).toBe(-1);
    // Values already inside the range are left alone (float32 precision aside).
    expect(out[0]![2]).toBeCloseTo(0.2, 6);
  });

  it('interleaves planar channels in WebCodecs f32 order', () => {
    const planar = [new Float32Array([1, 3]), new Float32Array([2, 4])];
    expect(Array.from(interleave(planar, 2))).toEqual([1, 2, 3, 4]);
  });
});

/**
 * ADR-029: `mixStreamInto` no longer calls `sampleAt` per frame (that
 * allocated for every sample). The mix must stay bit for bit what the
 * per-frame form gave, so it is compared with it here, value by value
 * (`Object.is`: also -0 and NaN), over the shapes the export produces.
 */
describe('mixStreamInto is the per-frame sampleAt mix, bit for bit', () => {
  /** The mix as it was written before ADR-029. */
  function referenceMix(
    out: Float32Array[],
    outFrames: number,
    buffer: PcmRingBuffer,
    positionStart: number,
    positionStep: number,
    gains: Float32Array | number,
  ): void {
    const constantGain = typeof gains === 'number' ? gains : null;
    if (constantGain === 0) return;
    const gainCurve = constantGain === null ? (gains as Float32Array) : null;
    for (let channel = 0; channel < out.length; channel += 1) {
      const destination = out[channel];
      if (!destination) continue;
      let position = positionStart;
      for (let i = 0; i < outFrames; i += 1) {
        const gain = constantGain ?? gainCurve?.[i] ?? 0;
        if (gain !== 0) {
          destination[i] = (destination[i] ?? 0) + buffer.sampleAt(position, channel) * gain;
        }
        position += positionStep;
      }
    }
  }

  /** Deterministic pseudo-random numbers (mulberry32). */
  function random(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function expectSame(actual: Float32Array[], expected: Float32Array[]): void {
    for (let channel = 0; channel < expected.length; channel += 1) {
      const a = actual[channel]!;
      const e = expected[channel]!;
      for (let i = 0; i < e.length; i += 1) {
        if (!Object.is(a[i], e[i])) {
          throw new Error(`channel ${channel} frame ${i}: ${a[i]} vs ${e[i]}`);
        }
      }
    }
  }

  it('matches over random decoded streams, rates, gaps, gains and positions', () => {
    const next = random(29);
    // A 48 kHz output fed from 48, 44.1, 32, 22.05 and 96 kHz and odd ratios.
    const steps = [1, 44_100 / 48_000, 32_000 / 48_000, 22_050 / 48_000, 2, 0.5, 1.37];
    let compared = 0;
    for (let trial = 0; trial < 400; trial += 1) {
      const sourceChannels = 1 + Math.floor(next() * 2);
      const outChannels = 1 + Math.floor(next() * 2);
      const buffer = new PcmRingBuffer(sourceChannels);
      // Blocks of 1024 frames like AAC, sometimes of other lengths, with
      // gaps, and now and then shorter in storage than they say.
      let frame = Math.floor(next() * 5000) - 1000;
      const blocks = 1 + Math.floor(next() * 6);
      for (let b = 0; b < blocks; b += 1) {
        const count = next() < 0.2 ? 1 + Math.floor(next() * 1500) : 1024;
        const stored = next() < 0.05 ? Math.max(0, count - 7) : count;
        const channels: Float32Array[] = [];
        for (let c = 0; c < sourceChannels; c += 1) {
          const data = new Float32Array(stored);
          for (let i = 0; i < stored; i += 1) {
            const r = next();
            // Mostly speech-level values; some full scale, exact 0 and -0.
            data[i] = r < 0.02 ? 0 : r < 0.03 ? -0 : r < 0.04 ? 1 : r < 0.05 ? -1 : (next() * 2 - 1) * 0.4;
          }
          channels.push(data);
        }
        buffer.append(channels, frame, count);
        frame += count + (next() < 0.15 ? Math.floor(next() * 300) : 0);
      }
      if (next() < 0.2) buffer.trimBefore(buffer.firstFrame + Math.floor(next() * 1024));

      const outFrames = next() < 0.1 ? Math.floor(next() * 50) : 4096;
      const step = steps[Math.floor(next() * steps.length)]!;
      const start = buffer.firstFrame - 50 + (next() < 0.5 ? next() * 3000 : 0) + (next() < 0.3 ? 0.5 : 0);
      let gains: Float32Array | number;
      if (next() < 0.5) {
        gains = next() < 0.1 ? 0 : next() * 1.5;
      } else {
        // A music envelope: zeros, a ramp, full gain; sometimes shorter than the chunk.
        const length = next() < 0.1 ? Math.floor(outFrames / 2) : outFrames;
        gains = new Float32Array(length);
        for (let i = 0; i < length; i += 1) gains[i] = i < length / 4 ? 0 : Math.min(1, i / length);
      }

      const expected = Array.from({ length: outChannels }, () => {
        const channel = new Float32Array(outFrames);
        for (let i = 0; i < outFrames; i += 1) channel[i] = next() < 0.5 ? 0 : (next() * 2 - 1) * 0.3;
        return channel;
      });
      const actual = expected.map((channel) => channel.slice());
      referenceMix(expected, outFrames, buffer, start, step, gains);
      mixStreamInto(actual, outFrames, buffer, start, step, gains);
      expectSame(actual, expected);
      compared += outFrames * outChannels;
    }
    expect(compared).toBeGreaterThan(1_000_000);
  });

  it('matches at the edges: empty buffer, negative and non-finite positions, no channels', () => {
    const one = new PcmRingBuffer(1);
    one.append([new Float32Array([0.25, -0.5, 0.75])], 0, 3);
    const none = new PcmRingBuffer(0);
    none.append([], 0, 4);
    const cases: { buffer: PcmRingBuffer; start: number; step: number }[] = [
      { buffer: new PcmRingBuffer(2), start: 0, step: 1 },
      { buffer: one, start: -2.5, step: 0.5 },
      { buffer: one, start: Number.NaN, step: 1 },
      { buffer: one, start: Number.POSITIVE_INFINITY, step: 1 },
      { buffer: one, start: Number.NEGATIVE_INFINITY, step: 1 },
      { buffer: none, start: 0, step: 1 },
    ];
    for (const { buffer, start, step } of cases) {
      const expected = [new Float32Array(8), new Float32Array(8)];
      const actual = [new Float32Array(8), new Float32Array(8)];
      referenceMix(expected, 8, buffer, start, step, 0.9);
      mixStreamInto(actual, 8, buffer, start, step, 0.9);
      expectSame(actual, expected);
    }
  });
});
