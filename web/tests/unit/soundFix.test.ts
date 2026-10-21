import { describe, expect, it } from 'vitest';

import { R128Meter, TruePeakTracker, measureR128 } from '@/domain/r128';
import {
  CEILING_DBTP,
  CLIPPED_SHARE,
  ClipMeter,
  LISTEN_S,
  SoundRehearsal,
  TARGET_LUFS,
  TruePeakLimiter,
  decideSoundFix,
  fixSound,
  inputGainFor,
  isClipped,
  levelWord,
  listenStartPart,
  soundVerdict,
  usableSettings,
  SOUND_FIX_VERSION,
} from '@/domain/soundFix';

const RATE = 48_000;

/** A repeatable noise source. */
function noise(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647 - 0.5;
  };
}

/**
 * Something with the shape of speech: syllables (bursts of band-limited noise, ~4 per second) in
 * phrases of two seconds with pauses between them. `levels` gives the RMS level (dBFS) of each
 * stretch of `stretchS` seconds.
 */
function speechLike(seconds: number, levels: readonly number[], stretchS = seconds, seed = 7): Float32Array[] {
  const random = noise(seed);
  const n = Math.round(seconds * RATE);
  const left = new Float32Array(n);
  let low = 0;
  for (let i = 0; i < n; i += 1) {
    const t = i / RATE;
    const level = levels[Math.min(levels.length - 1, Math.floor(t / stretchS))] as number;
    const phrase = t % 2.5 < 2 ? 1 : 0;
    const syllable = Math.max(0, Math.sin(2 * Math.PI * 4 * t)) ** 2;
    low += 0.15 * (random() - low);
    left[i] = low * phrase * syllable * 10 ** (level / 20) * 9;
  }
  return [left, Float32Array.from(left)];
}

/** Dense, steady and loud: no pauses, the way mastered music is. */
function loudMusic(seconds: number): Float32Array[] {
  const random = noise(3);
  const n = Math.round(seconds * RATE);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const t = i / RATE;
    const tone = 0.3 * Math.sin(2 * Math.PI * 110 * t) + 0.2 * Math.sin(2 * Math.PI * 440 * t);
    left[i] = tone + 0.25 * random();
    right[i] = tone + 0.25 * random();
  }
  return [left, right];
}

/** The page's two measurements and the export's chain, in a row, as the app runs them. */
function fixWhole(channels: Float32Array[]) {
  const before = measureR128(channels, RATE);
  const inputGainDb = inputGainFor(before.integratedLufs);
  const meter = new R128Meter(RATE, 2);
  const rehearsal = new SoundRehearsal(RATE, 2, inputGainDb, meter, 0, channels[0]!.length);
  for (let at = 0; at < channels[0]!.length; at += 4096) {
    const end = Math.min(channels[0]!.length, at + 4096);
    rehearsal.push(channels.map((channel) => channel.subarray(at, end)), end - at);
  }
  rehearsal.end();
  const check = decideSoundFix(before, inputGainDb, meter.result());
  const out = fixSound(channels, RATE, check.settings);
  return { before, check, out, after: measureR128(out, RATE), rehearsal };
}

describe('the loudness meter (BS.1770-4)', () => {
  it('reads EBU Tech 3341 case 1: a 1 kHz sine at −23 dBFS on both channels is −23 LUFS', () => {
    const n = RATE * 20;
    const sine = Float32Array.from({ length: n }, (_, i) => 10 ** (-23 / 20) * Math.sin((2 * Math.PI * 1000 * i) / RATE));
    const result = measureR128([sine, sine], RATE);
    expect(result.integratedLufs).toBeCloseTo(-23, 1);
    expect(result.lraLu).toBeLessThan(0.5);
  });

  it('leaves pauses out of the integrated loudness (the gates)', () => {
    const n = RATE * 20;
    const sine = Float32Array.from({ length: n }, (_, i) =>
      i < n / 2 ? 10 ** (-23 / 20) * Math.sin((2 * Math.PI * 1000 * i) / RATE) : 0,
    );
    expect(Math.abs(measureR128([sine, sine], RATE).integratedLufs + 23)).toBeLessThan(0.1);
  });

  it('says silence is silence (no block over the absolute gate)', () => {
    const silence = new Float32Array(RATE * 5);
    const result = measureR128([silence, silence], RATE);
    expect(result.integratedLufs).toBe(Number.NEGATIVE_INFINITY);
    expect(result.truePeakDbtp).toBe(Number.NEGATIVE_INFINITY);
  });

  it('a wide loudness range for a sound with a loud and a quiet half', () => {
    const uneven = speechLike(40, [-20, -40], 20);
    expect(measureR128(uneven, RATE).lraLu).toBeGreaterThan(12);
    const even = speechLike(40, [-20]);
    expect(measureR128(even, RATE).lraLu).toBeLessThan(8);
  });

  it('finds the peak between the samples (true peak, 4× oversampled)', () => {
    // A quarter of the sample rate, 45° off: every sample is at 0.707 of the real peak.
    const tracker = new TruePeakTracker();
    let peak = 0;
    let samplePeak = 0;
    for (let i = 0; i < 2000; i += 1) {
      const x = 0.5 * Math.sin((Math.PI * i) / 2 + Math.PI / 4);
      samplePeak = Math.max(samplePeak, Math.abs(x));
      peak = Math.max(peak, tracker.next(x));
    }
    expect(20 * Math.log10(samplePeak / 0.5)).toBeCloseTo(-3, 0);
    expect(Math.abs(20 * Math.log10(peak / 0.5))).toBeLessThan(0.6);
  });
});

describe('the true-peak limiter', () => {
  it('passes a sound under the ceiling unchanged and in place, whatever the chunking', () => {
    const quiet = speechLike(3, [-30])[0]!;
    const limiter = new TruePeakLimiter(RATE, 1);
    const parts: Float32Array[] = [];
    for (let at = 0; at < quiet.length; at += 1000) parts.push(limiter.push([quiet.subarray(at, at + 1000)], Math.min(1000, quiet.length - at))[0]!);
    parts.push(limiter.flush()[0]!);
    const out = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
    let at = 0;
    for (const part of parts) {
      out.set(part, at);
      at += part.length;
    }
    expect(out.length).toBe(quiet.length);
    let diff = 0;
    for (let i = 0; i < out.length; i += 1) diff = Math.max(diff, Math.abs(out[i]! - quiet[i]!));
    expect(diff).toBeLessThan(1e-7);
  });

  it('keeps every true peak under the ceiling, and gives back as much as it was given across stretches', () => {
    const loud = loudMusic(4).map((channel) => channel.map((value) => value * 4));
    const limiter = new TruePeakLimiter(RATE, 2);
    const first = limiter.push(loud.map((c) => c.subarray(0, RATE * 2)), RATE * 2);
    const firstTail = limiter.flush();
    const second = limiter.push(loud.map((c) => c.subarray(RATE * 2)), RATE * 2);
    const secondTail = limiter.flush();
    expect(first[0]!.length + firstTail[0]!.length).toBe(RATE * 2);
    expect(second[0]!.length + secondTail[0]!.length).toBe(RATE * 2);
    const joined = [0, 1].map((c) => {
      const out = new Float32Array(RATE * 4);
      out.set(first[c]!, 0);
      out.set(firstTail[c]!, first[c]!.length);
      out.set(second[c]!, RATE * 2);
      out.set(secondTail[c]!, RATE * 2 + second[c]!.length);
      return out;
    });
    expect(measureR128(joined, RATE).truePeakDbtp).toBeLessThanOrEqual(CEILING_DBTP + 0.1);
    expect(limiter.deepestDb).toBeLessThan(-6);
  });
});

describe('Sesi düzelt: the chain hits the target', () => {
  const cases: Array<[string, Float32Array[]]> = [
    ['quiet speech (−35 dBFS)', speechLike(30, [-35])],
    ['uneven speech (−18 then −38 dBFS)', speechLike(40, [-18, -38], 10)],
    ['loud music', loudMusic(20)],
    ['clipped speech', speechLike(20, [-3]).map((c) => c.map((v) => Math.max(-1, Math.min(1, v * 3))))],
  ];
  for (const [name, sound] of cases) {
    it(`${name}: ${TARGET_LUFS} LUFS within half a unit, peaks under the ceiling, as long as it was`, () => {
      const { out, after, check } = fixWhole(sound);
      expect(out[0]!.length).toBe(sound[0]!.length);
      expect(Math.abs(after.integratedLufs - TARGET_LUFS)).toBeLessThan(0.5);
      expect(after.truePeakDbtp).toBeLessThanOrEqual(CEILING_DBTP + 0.1);
      // What the screen is told comes true.
      expect(Math.abs(check.after.integratedLufs - after.integratedLufs)).toBeLessThan(0.5);
      expect(check.verdict.kind).toBe('fix');
    });
  }

  it('makes uneven speech more even (a smaller loudness range)', () => {
    const { before, after, check } = fixWhole(speechLike(40, [-18, -38], 10));
    expect(before.lraLu - after.lraLu).toBeGreaterThan(5);
    expect(check.verdict.kind === 'fix' && check.verdict.uneven).toBe(true);
  });

  it('turns nothing up in silence and says so', () => {
    const silence = [new Float32Array(RATE * 5), new Float32Array(RATE * 5)];
    const before = measureR128(silence, RATE);
    expect(soundVerdict(before, before.integratedLufs).kind).toBe('silent');
  });

  it('keeps the five seconds to listen to: the "before" as it was, the "after" at the target', () => {
    const sound = speechLike(30, [-35]);
    const { rehearsal, check } = fixWhole(sound);
    const listen = rehearsal.listen(check.settings.outputGainDb);
    expect(listen.before[0]!.length).toBe(LISTEN_S * RATE);
    expect(listen.after[0]!.length).toBe(LISTEN_S * RATE);
    expect(Array.from(listen.before[0]!.subarray(0, 100))).toEqual(Array.from(sound[0]!.subarray(0, 100)));
    expect(measureR128(listen.after, RATE).integratedLufs).toBeGreaterThan(TARGET_LUFS - 3);
  });

  it('picks the quiet stretch to listen to', () => {
    const before = measureR128(speechLike(40, [-18, -38], 20), RATE);
    const start = listenStartPart(before.parts, before.integratedLufs);
    expect(start * 0.1).toBeGreaterThanOrEqual(20);
  });
});

describe('Sesi düzelt: words and checks', () => {
  it('says how loud in five words', () => {
    expect(levelWord(-40)).toBe('veryQuiet');
    expect(levelWord(-24)).toBe('quiet');
    expect(levelWord(-16.5)).toBe('good');
    expect(levelWord(-11)).toBe('loud');
    expect(levelWord(-5)).toBe('veryLoud');
  });

  it('a sound already at a good level, even and under the ceiling is said to be good', () => {
    expect(soundVerdict({ integratedLufs: -16.4, lraLu: 5, truePeakDbtp: -3 }, -16)).toMatchObject({ kind: 'fix', alreadyGood: true });
    expect(soundVerdict({ integratedLufs: -16.4, lraLu: 14, truePeakDbtp: -3 }, -16)).toMatchObject({ alreadyGood: false, uneven: true });
    expect(soundVerdict({ integratedLufs: -16.4, lraLu: 5, truePeakDbtp: 0 }, -16)).toMatchObject({ alreadyGood: false });
  });

  it('says honestly when the gains run out before the target', () => {
    expect(soundVerdict({ integratedLufs: -58, lraLu: 3, truePeakDbtp: -40 }, -24)).toMatchObject({ kind: 'fix', stillQuiet: true });
  });

  it('the export only takes settings made for its own chain', () => {
    expect(usableSettings({ version: SOUND_FIX_VERSION, inputGainDb: 12, outputGainDb: -1 })).toBe(true);
    expect(usableSettings({ version: SOUND_FIX_VERSION + 1, inputGainDb: 12, outputGainDb: -1 })).toBe(false);
    expect(usableSettings({ version: SOUND_FIX_VERSION, inputGainDb: 80, outputGainDb: 0 })).toBe(false);
    expect(usableSettings({ version: SOUND_FIX_VERSION, inputGainDb: Number.NaN, outputGainDb: 0 })).toBe(false);
    expect(usableSettings(null)).toBe(false);
  });
});

describe('Sesi düzelt: a recording cut off at full scale is said to be (ClipMeter)', () => {
  /** Speech recorded 20 dB too loud and cut off at ±0.99, the way `patlamis-konusma.mp4` is made. */
  function clippedSpeech(): Float32Array[] {
    return speechLike(20, [-18]).map((channel) => channel.map((value) => Math.max(-0.99, Math.min(0.99, value * 10))));
  }

  function shareOf(channels: Float32Array[], chunk = 4096): number {
    const meter = new ClipMeter();
    for (let at = 0; at < channels[0]!.length; at += chunk) {
      const end = Math.min(channels[0]!.length, at + chunk);
      meter.push(channels.map((channel) => channel.subarray(at, end)), end - at);
    }
    return meter.share;
  }

  it('finds the cut-off speech, and nothing in clean speech, quiet speech or loud music', () => {
    const clipped = shareOf(clippedSpeech());
    expect(clipped).toBeGreaterThan(CLIPPED_SHARE * 10);
    expect(isClipped(clipped)).toBe(true);
    for (const clean of [speechLike(20, [-18]), speechLike(20, [-40]), loudMusic(10)]) {
      expect(shareOf(clean)).toBeLessThan(CLIPPED_SHARE);
      expect(isClipped(shareOf(clean))).toBe(false);
    }
  });

  it('a few loud peaks are not a cut-off recording; the share does not depend on the chunking', () => {
    const sound = speechLike(10, [-18]);
    for (const at of [1000, 50_000, 200_000]) sound[0]![at] = 1;
    expect(isClipped(shareOf(sound))).toBe(false);
    const clipped = clippedSpeech();
    expect(shareOf(clipped, 333)).toBeCloseTo(shareOf(clipped, 48_000), 12);
    expect(new ClipMeter().share).toBe(0);
  });

  it('the check carries the share, and a cut-off sound is never "already good"', () => {
    const before = { integratedLufs: -16.4, lraLu: 5, truePeakDbtp: -3 };
    const check = decideSoundFix(before, 0, before, 0.02);
    expect(check.before.clippedShare).toBe(0.02);
    expect(check.verdict).toMatchObject({ kind: 'fix', clipped: true, alreadyGood: false });
    expect(decideSoundFix(before, 0, before, 0).verdict).toMatchObject({ clipped: false, alreadyGood: true });
    expect(soundVerdict(before, -16)).toMatchObject({ clipped: false });
  });
});
