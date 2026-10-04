import { describe, expect, it } from 'vitest';

import { MonoResampler, downmixToMono } from '@/domain/resample';
import {
  DEFAULT_VAD,
  MAX_SPAN_S,
  VAD_FRAME_S,
  quietestFrameTime,
  spansFromProbs,
  splitLongSpans,
} from '@/domain/speechSpans';

/** Probabilities for a list of [fromSeconds, toSeconds, probability] stretches (0 elsewhere). */
function probsFor(totalS: number, stretches: Array<[number, number, number]>): Float32Array {
  const probs = new Float32Array(Math.floor(totalS / VAD_FRAME_S));
  for (const [from, to, p] of stretches) {
    for (let i = Math.round(from / VAD_FRAME_S); i < Math.round(to / VAD_FRAME_S) && i < probs.length; i += 1) probs[i] = p;
  }
  return probs;
}

describe('speech spans from the detector (the spike\'s rules)', () => {
  it('uses Silero\'s published defaults', () => {
    expect(DEFAULT_VAD).toEqual({ threshold: 0.5, negThreshold: 0.35, minSpeechS: 0.25, minSilenceS: 0.5, padS: 0.2 });
    expect(VAD_FRAME_S).toBeCloseTo(0.032, 6);
  });

  it('finds nothing in silence', () => {
    expect(spansFromProbs(probsFor(15, []), VAD_FRAME_S, 15)).toEqual([]);
    expect(spansFromProbs(probsFor(15, [[0, 15, 0.3]]), VAD_FRAME_S, 15)).toEqual([]);
  });

  it('pads a span by 0.2 s on both sides, inside the sound', () => {
    const [span] = spansFromProbs(probsFor(10, [[2, 5, 0.9]]), VAD_FRAME_S, 10);
    expect(span!.start).toBeCloseTo(2 - 0.2, 1);
    expect(span!.end).toBeCloseTo(5 + 0.2, 1);
    const [atStart] = spansFromProbs(probsFor(10, [[0, 3, 0.9]]), VAD_FRAME_S, 10);
    expect(atStart!.start).toBe(0);
  });

  it('a pause under 0.5 s does not end a span; a longer one does', () => {
    expect(spansFromProbs(probsFor(10, [[1, 3, 0.9], [3.3, 5, 0.9]]), VAD_FRAME_S, 10)).toHaveLength(1);
    const two = spansFromProbs(probsFor(10, [[1, 3, 0.9], [4.5, 6, 0.9]]), VAD_FRAME_S, 10);
    expect(two).toHaveLength(2);
    expect(two[0]!.end).toBeLessThanOrEqual(two[1]!.start);
  });

  it('drops a click shorter than 0.25 s', () => {
    expect(spansFromProbs(probsFor(10, [[4, 4.15, 0.95]]), VAD_FRAME_S, 10)).toEqual([]);
  });

  it('hysteresis: a dip that stays above 0.35 does not start the silence clock', () => {
    const one = spansFromProbs(probsFor(10, [[1, 3, 0.9], [3, 4, 0.4], [4, 6, 0.9]]), VAD_FRAME_S, 10);
    expect(one).toHaveLength(1);
  });

  it('neighbours whose padding would overlap share the gap half and half', () => {
    // A 0.6 s pause: 0.2 s of padding from each side would leave 0.2 s; they must not cross.
    const [a, b] = spansFromProbs(probsFor(12, [[1, 4, 0.9], [4.6, 8, 0.9]]), VAD_FRAME_S, 12);
    expect(a!.end).toBeLessThanOrEqual(b!.start + 1e-9);
    expect(b!.start - a!.end).toBeLessThan(0.35);
  });

  it('a span still open at the end runs to the end', () => {
    const [span] = spansFromProbs(probsFor(6, [[4, 6, 0.9]]), VAD_FRAME_S, 6);
    expect(span!.end).toBe(6);
  });
});

describe('long spans are cut at their quietest point', () => {
  it('a span up to 30 s goes to the recogniser whole', () => {
    expect(splitLongSpans([{ start: 2, end: 31.5 }], null)).toEqual([{ start: 2, end: 31.5 }]);
    expect(MAX_SPAN_S).toBe(30);
  });

  it('cuts in the second half of the window, one second spare, at the lowest probability', () => {
    const probs = probsFor(80, [[0, 80, 0.9]]);
    // The quietest frame of [15, 29] s is at 22 s; of the next window, at 40 s.
    probs[Math.round(22 / VAD_FRAME_S)] = 0.55;
    probs[Math.round(40 / VAD_FRAME_S)] = 0.52;
    const quietestAt = (from: number, to: number) => quietestFrameTime(probs, VAD_FRAME_S, from, to);
    const pieces = splitLongSpans([{ start: 0, end: 70 }], quietestAt);
    expect(pieces[0]!.end).toBeCloseTo(22, 1);
    expect(pieces[1]!.start).toBe(pieces[0]!.end);
    expect(pieces[1]!.end).toBeCloseTo(40, 1);
    // No piece is longer than the window, and together they cover the span exactly.
    for (const piece of pieces) expect(piece.end - piece.start).toBeLessThanOrEqual(30);
    expect(pieces[0]!.start).toBe(0);
    expect(pieces[pieces.length - 1]!.end).toBe(70);
    for (let i = 1; i < pieces.length; i += 1) expect(pieces[i]!.start).toBe(pieces[i - 1]!.end);
  });

  it('always moves forward, whatever the cut function answers', () => {
    const pieces = splitLongSpans([{ start: 0, end: 100 }], () => 0);
    expect(pieces.length).toBeLessThan(10);
    for (const piece of pieces) {
      expect(piece.end).toBeGreaterThan(piece.start);
      expect(piece.end - piece.start).toBeLessThanOrEqual(30);
    }
  });
});

function sine(rate: number, hz: number, seconds: number, amplitude = 0.5): Float32Array {
  const out = new Float32Array(Math.round(rate * seconds));
  for (let i = 0; i < out.length; i += 1) out[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / rate);
  return out;
}

function resampleAll(input: Float32Array, rate: number, chunk: number): Float32Array {
  const resampler = new MonoResampler(rate, 16_000);
  const parts: Float32Array[] = [];
  for (let at = 0; at < input.length; at += chunk) parts.push(resampler.push(input.subarray(at, at + chunk)));
  parts.push(resampler.flush());
  const out = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const rms = (data: Float32Array, from: number, to: number) => {
  let sum = 0;
  for (let i = from; i < to; i += 1) sum += (data[i] as number) ** 2;
  return Math.sqrt(sum / (to - from));
};

describe('resampling to 16 kHz mono', () => {
  it.each([48_000, 44_100, 32_000, 22_050, 8_000, 16_000])('%i Hz: the length is the sound\'s length', (rate) => {
    const out = resampleAll(sine(rate, 440, 1.5), rate, 4096);
    expect(out.length).toBe(24_000);
  });

  it.each([48_000, 44_100])('%i Hz: a 1 kHz tone keeps its level and its pitch', (rate) => {
    const out = resampleAll(sine(rate, 1000, 1), rate, 1024);
    expect(rms(out, 2000, 14_000)).toBeCloseTo(0.5 / Math.SQRT2, 2);
    // 1 kHz at 16 kHz: 2000 zero crossings per second.
    let crossings = 0;
    for (let i = 2001; i < 14_000; i += 1) if ((out[i - 1] as number) < 0 !== (out[i] as number) < 0) crossings += 1;
    expect(crossings).toBeGreaterThan(1495);
    expect(crossings).toBeLessThan(1505);
  });

  it('removes what 16 kHz cannot carry (no aliasing of a 10 kHz tone)', () => {
    const out = resampleAll(sine(48_000, 10_000, 1), 48_000, 1024);
    // More than 60 dB down.
    expect(rms(out, 2000, 14_000)).toBeLessThan((0.5 / Math.SQRT2) * 0.001);
  });

  it('keeps time: a click stays where it was', () => {
    const input = new Float32Array(48_000);
    input[24_000] = 1;
    const out = resampleAll(input, 48_000, 777);
    let peak = 0;
    for (let i = 0; i < out.length; i += 1) if (Math.abs(out[i] as number) > Math.abs(out[peak] as number)) peak = i;
    expect(peak).toBe(8000);
  });

  it('gives the same samples whatever the chunk size', () => {
    const input = sine(44_100, 700, 0.8);
    const whole = resampleAll(input, 44_100, input.length);
    for (const chunk of [1, 127, 1024, 4410]) {
      const pieces = resampleAll(input, 44_100, chunk);
      expect(pieces.length).toBe(whole.length);
      for (let i = 0; i < whole.length; i += 97) expect(pieces[i]).toBeCloseTo(whole[i] as number, 6);
    }
  });

  it('down-mixes by averaging the channels', () => {
    const out = new Float32Array(3);
    downmixToMono([Float32Array.from([1, 0, -1]), Float32Array.from([0, 0, 1])], 3, out);
    expect(Array.from(out)).toEqual([0.5, 0, 0]);
    downmixToMono([Float32Array.from([0.25, 0.5, 0.75])], 3, out);
    expect(Array.from(out)).toEqual([0.25, 0.5, 0.75]);
  });
});
