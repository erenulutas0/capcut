import { describe, expect, it } from 'vitest';

import { DEFAULT_LEVEL, LevelNormaliser, atFullLevel, normaliseLevel } from '@/domain/levelNormalise';

const RATE = 16_000;
const fromDb = (db: number) => 10 ** (db / 20);
const toDb = (value: number) => 20 * Math.log10(Math.max(value, 1e-12));

/** Something with the shape of speech: 150 ms bursts of a 200 Hz tone, 100 ms gaps, at `peakDb`; `floorDb` hiss throughout. */
function talk(seconds: number, peakDb: number, floorDb = -120, seed = 1): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE));
  let state = seed >>> 0;
  const noise = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 31 - 1;
  };
  const peak = fromDb(peakDb);
  const floor = fromDb(floorDb);
  for (let i = 0; i < out.length; i += 1) {
    const inBurst = (i / RATE) % 0.25 < 0.15;
    out[i] = (inBurst ? peak * Math.sin((2 * Math.PI * 200 * i) / RATE) : 0) + floor * noise();
  }
  return out;
}
function hiss(seconds: number, levelDb: number, seed = 7): Float32Array {
  return talk(seconds, -200, levelDb, seed);
}
function join(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
/** RMS of the loudest 50 ms block in [fromS, toS), dBFS. */
function loudestDb(samples: Float32Array, fromS: number, toS: number): number {
  const block = RATE / 20;
  let loudest = 0;
  for (let at = Math.round(fromS * RATE); at + block <= Math.round(toS * RATE); at += block) {
    let sum = 0;
    for (let i = at; i < at + block; i += 1) sum += (samples[i] as number) ** 2;
    loudest = Math.max(loudest, Math.sqrt(sum / block));
  }
  return toDb(loudest);
}

describe('level normalisation in front of the speech detector', () => {
  it('gives back exactly the samples it was given, in order, however they arrive', () => {
    const input = join(talk(2.3, -12), talk(3.1, -50), hiss(1.7, -70));
    const whole = normaliseLevel(input, RATE);
    expect(whole.length).toBe(input.length);
    for (const size of [1, 37, 512, 4096, 16_001]) {
      const normaliser = new LevelNormaliser(RATE);
      const parts: Float32Array[] = [];
      for (let at = 0; at < input.length; at += size) parts.push(normaliser.push(input.subarray(at, Math.min(input.length, at + size))));
      parts.push(normaliser.flush());
      const stitched = join(...parts);
      expect(stitched.length).toBe(input.length);
      let worst = 0;
      for (let i = 0; i < input.length; i += 1) worst = Math.max(worst, Math.abs((stitched[i] as number) - (whole[i] as number)));
      expect(worst).toBeLessThan(1e-6);
    }
  });

  it('never turns anything down: speech that is loud enough comes out as it went in', () => {
    const input = talk(4, -6);
    const out = normaliseLevel(input, RATE);
    let worst = 0;
    for (let i = 0; i < input.length; i += 1) worst = Math.max(worst, Math.abs((out[i] as number) - (input[i] as number)));
    expect(worst).toBeLessThan(1e-6);
  });

  it('turns quiet speech that follows loud speech up to the same level (the stress case: a 40 dB drop)', () => {
    const input = join(talk(4, -8), talk(6, -48));
    expect(loudestDb(input, 5.5, 9.5)).toBeLessThan(-48);
    const out = normaliseLevel(input, RATE);
    // The loud part: untouched. The quiet part, once the loud part is out of reach behind it: at the target.
    expect(loudestDb(out, 0.5, 3)).toBeCloseTo(loudestDb(input, 0.5, 3), 1);
    expect(loudestDb(out, 5.5, 9.5)).toBeGreaterThan(DEFAULT_LEVEL.targetDb - 1.5);
    expect(loudestDb(out, 5.5, 9.5)).toBeLessThan(DEFAULT_LEVEL.targetDb + 1.5);
  });

  it('turns quiet speech BEFORE loud speech up as well, and is back down before the loud part arrives (no clipping)', () => {
    const input = join(talk(6, -45), talk(3, -4));
    const out = normaliseLevel(input, RATE);
    expect(loudestDb(out, 0.5, 4)).toBeGreaterThan(DEFAULT_LEVEL.targetDb - 1.5);
    let peak = 0;
    for (let i = Math.round(6 * RATE); i < out.length; i += 1) peak = Math.max(peak, Math.abs(out[i] as number));
    expect(peak).toBeLessThanOrEqual(fromDb(-4) + 1e-3);
  });

  it('never turns anything up by more than the cap', () => {
    const input = talk(5, -72);
    const out = normaliseLevel(input, RATE);
    expect(loudestDb(out, 1, 4) - loudestDb(input, 1, 4)).toBeCloseTo(DEFAULT_LEVEL.maxGainDb, 0);
  });

  it('leaves a steady quiet sound alone: a room is not turned into a roar (the contrast rule)', () => {
    expect(DEFAULT_LEVEL.minContrastDb).toBeGreaterThan(0);
    const room = hiss(8, -62);
    const out = normaliseLevel(room, RATE);
    expect(loudestDb(out, 1, 7)).toBeCloseTo(loudestDb(room, 1, 7), 1);
  });

  it('holds the gain through a pause: the hiss between two quiet sentences is turned up no more than the sentences are', () => {
    const input = join(talk(4, -44, -80), hiss(5, -80), talk(4, -44, -80));
    const out = normaliseLevel(input, RATE);
    const speechGain = loudestDb(out, 0.5, 3.5) - loudestDb(input, 0.5, 3.5);
    const pauseGain = loudestDb(out, 5.5, 7) - loudestDb(input, 5.5, 7);
    expect(speechGain).toBeGreaterThan(20);
    expect(pauseGain).toBeLessThanOrEqual(speechGain + 0.5);
  });

  it('without the contrast rule a pause climbs to the cap (what the rule is there to stop)', () => {
    const input = join(talk(4, -44, -80), hiss(5, -80), talk(4, -44, -80));
    const out = normaliseLevel(input, RATE, { minContrastDb: 0 });
    expect(loudestDb(out, 5.5, 7) - loudestDb(input, 5.5, 7)).toBeGreaterThan(DEFAULT_LEVEL.maxGainDb - 1);
  });

  it('keeps digital silence silent and every sample finite and inside ±1', () => {
    const input = join(new Float32Array(RATE * 3), talk(2, -30), new Float32Array(RATE * 3), talk(1, 0));
    const out = normaliseLevel(input, RATE);
    let leadIn = 0;
    for (let i = 0; i < RATE * 2; i += 1) leadIn = Math.max(leadIn, Math.abs(out[i] as number));
    expect(leadIn).toBe(0);
    let peak = 0;
    let finite = true;
    for (let i = 0; i < out.length; i += 1) {
      if (!Number.isFinite(out[i] as number)) finite = false;
      peak = Math.max(peak, Math.abs(out[i] as number));
    }
    expect(finite).toBe(true);
    expect(peak).toBeLessThanOrEqual(1);
  });

  it('changes the gain smoothly: a constant input never jumps at a block edge', () => {
    // A constant (DC) quiet stretch between two loud bursts: whatever the gain does, it does it gradually.
    const input = new Float32Array(RATE * 6).fill(0.001);
    for (let i = 0; i < RATE; i += 1) input[i] = 0.5 * Math.sin((2 * Math.PI * 200 * i) / RATE);
    for (let i = RATE * 5; i < RATE * 6; i += 1) input[i] = 0.5 * Math.sin((2 * Math.PI * 200 * i) / RATE);
    const out = normaliseLevel(input, RATE, { minContrastDb: 0 });
    let worst = 0;
    for (let i = RATE + 1; i < RATE * 5; i += 1) worst = Math.max(worst, Math.abs((out[i] as number) - (out[i - 1] as number)));
    // The whole climb (×100) spread over at least one 50 ms block: under 0.1 / 800 per sample.
    expect(worst).toBeLessThan(0.1 / 700);
  });
});

describe('one speech span at full level for the recogniser', () => {
  it('turns a quiet span up so that its loudest moment is at the target', () => {
    const quiet = talk(3, -50);
    const out = atFullLevel(quiet, RATE);
    expect(loudestDb(out, 0, 3)).toBeCloseTo(DEFAULT_LEVEL.targetDb, 0);
  });

  it('gives a loud span back untouched (the same array) and never turns anything down', () => {
    const loud = talk(2, -6);
    expect(atFullLevel(loud, RATE)).toBe(loud);
  });

  it('gives silence back as it is and stays inside the cap and inside ±1', () => {
    const silence = new Float32Array(RATE);
    expect(atFullLevel(silence, RATE)).toBe(silence);
    const faint = talk(2, -95, -200);
    const out = atFullLevel(faint, RATE);
    expect(loudestDb(out, 0, 2) - loudestDb(faint, 0, 2)).toBeCloseTo(DEFAULT_LEVEL.maxGainDb, 0);
    const click = talk(2, -40);
    click[100] = 0.9;
    expect(Math.max(...Array.from(atFullLevel(click, RATE), Math.abs))).toBeLessThanOrEqual(1);
  });
});
