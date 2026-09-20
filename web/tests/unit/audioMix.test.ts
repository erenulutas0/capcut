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
