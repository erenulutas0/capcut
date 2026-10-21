/**
 * "Sesi düzelt" (ADR-049): quiet or uneven sound made audible and even, on the
 * device. Pure and streaming — the export worker runs it on the mixed sound of
 * the download, the loudness worker runs the same code to decide the gains and
 * to make the five-second "after" a person can listen to first.
 *
 * The chain, per sample, every channel with ONE gain (the stereo picture does
 * not move):
 *
 *   1. a light high pass (60 Hz, 12 dB per octave): rumble a voice does not have;
 *   2. the input gain: the whole sound to the target, from the source's own
 *      integrated loudness (`planSoundFix`);
 *   3. a slow level (the speech detector's `MultiLevelNormaliser`, ADR-036): a
 *      quiet stretch of speech is turned up towards the loud ones — never down,
 *      at most `LEVEL.maxGainDb`, and not where nothing rises out of its own
 *      background (a pause, a hum, steady music);
 *   4. a gentle compressor (2:1 above `COMPRESSOR.thresholdDb`, soft knee): the
 *      loudest syllables come down a little;
 *   5. the output gain: what step 2 could not know (3 and 4 change the
 *      loudness), measured by running 1–4 over the whole sound once;
 *   6. a true-peak limiter (5 ms look-ahead, 4× oversampled peaks): nothing
 *      goes over `CEILING_DBTP`.
 *
 * What it does NOT do: remove noise (wind, hum, hiss stay — and are turned up
 * with the voice), repair distorted sound, or touch the picture.
 */

import { MultiLevelNormaliser, type ListeningLevelParams } from './levelNormalise';
import { TruePeakTracker, type R128Result } from './r128';
import { SOUND_FIX_VERSION } from './soundFixVersion';

/** Bumped whenever the chain or its numbers change: a measured plan is only used by the same chain. */
export { SOUND_FIX_VERSION };

/**
 * −16 LUFS integrated: the level of online video and podcasts heard on phones
 * (AES TD1004 recommends −16 to −20 LUFS for streamed and mobile audio; Apple's
 * podcasts ask for −16). Not EBU R128's −23 LUFS, which is broadcast TV
 * through a living-room set: on a phone speaker that is the "too quiet" this
 * card fixes. YouTube and Spotify turn down what is louder than −14, so −16 is
 * never turned down by them, and leaves room under the peak ceiling.
 */
export const TARGET_LUFS = -16;
/**
 * The ceiling of the limiter, before the AAC encoder. The encoder's own
 * ripple adds up to about half a decibel to the peaks (measured, ADR-049); the
 * finished file stays at or under −1 dBTP, the ceiling every platform asks for.
 */
export const CEILING_DBTP = -2;
/** The file's promise, checked with ffmpeg on the finished file. */
export const FILE_TRUE_PEAK_DBTP = -1;

/** The most the input gain may turn the sound up or down. */
export const MAX_INPUT_GAIN_DB = 30;
/** The output gain only corrects; it never does the work of the input gain. */
export const MAX_OUTPUT_GAIN_DB = 12;

/** Below this the sound is silence or nearly (a room, a hiss): there is nothing to turn up. */
export const SILENT_BELOW_LUFS = -60;
/** Within this of the target the sound is already at a good level. */
export const GOOD_WITHIN_LU = 2;
/** A loudness range (EBU Tech 3342) this wide is uneven: some stretches clearly quieter than others. */
export const UNEVEN_FROM_LU = 10;

/**
 * A decoded sample this close to full scale (−0.45 dBFS) or over it counts as cut off. Not 1.0
 * exactly: a recording cut off at full scale and then encoded (AAC) comes back with the codec's
 * ripple around the cut, a little under it and a little over it.
 */
export const CLIPPED_FROM = 0.95;
/**
 * The recording is said to be cut off in places ("patlamış") from this share of its samples at full
 * scale: one in a thousand. Measured on the test sources (21 Oct 2026, decoded as the app decodes
 * them): the clipped speech 13 %, the loud music-like sound 0,0007 %, ordinary, quiet and uneven
 * speech 0. A recording with one short shout cut off in a long video stays under it: then nothing is
 * said, which is honest in the other direction (the screen never claims the sound is clean).
 */
export const CLIPPED_SHARE = 0.001;

export const HIGH_PASS_HZ = 60;

/** Step 3: the slow level (see `MultiLevelNormaliser`), set for listening rather than for the detector. */
export const LEVEL: ListeningLevelParams = {
  blockS: 0.05,
  backS: 0.5,
  aheadS: 0.5,
  // After step 2 the whole sound is at −16 LUFS: the loud syllables of ordinary speech then reach about
  // −10 dBFS per 50 ms, so they are left alone; a stretch whose loudest syllables stay under −12 is raised.
  targetDb: -12,
  maxGainDb: 15,
  minContrastDb: 20,
  clip: false,
  maxRiseDbPerS: 10,
  maxFallDbPerS: 40,
};

export const COMPRESSOR = {
  /** RMS level (all channels together, 0 dBFS = full scale) where the compression starts. */
  thresholdDb: -18,
  ratio: 2,
  kneeDb: 6,
  attackS: 0.005,
  releaseS: 0.12,
} as const;

export const LIMITER = {
  lookaheadS: 0.005,
  releaseS: 0.06,
} as const;

/** What the export is told: the two measured gains (dB), for this version of the chain. */
export interface SoundFixSettings {
  version: typeof SOUND_FIX_VERSION;
  inputGainDb: number;
  outputGainDb: number;
}

const dbToGain = (db: number) => 10 ** (db / 20);

// ------------------------------------------------------------------ high pass

/** RBJ high pass, Q = 1/√2 (Butterworth), per channel, direct form I in doubles. */
class HighPass {
  private readonly b0: number;
  private readonly b1: number;
  private readonly b2: number;
  private readonly a1: number;
  private readonly a2: number;
  private readonly state: Float64Array;

  constructor(sampleRate: number, frequency: number, channels: number) {
    const w = (2 * Math.PI * frequency) / sampleRate;
    const alpha = Math.sin(w) / (2 * Math.SQRT1_2);
    const cos = Math.cos(w);
    const a0 = 1 + alpha;
    this.b0 = (1 + cos) / 2 / a0;
    this.b1 = -(1 + cos) / a0;
    this.b2 = (1 + cos) / 2 / a0;
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
    this.state = new Float64Array(channels * 4);
  }

  /** In place, times `gain` after the filter. */
  process(channels: Float32Array[], frames: number, gain: number): void {
    const { b0, b1, b2, a1, a2, state } = this;
    for (let c = 0; c < channels.length; c += 1) {
      const data = channels[c] as Float32Array;
      const s = c * 4;
      let x1 = state[s]!;
      let x2 = state[s + 1]!;
      let y1 = state[s + 2]!;
      let y2 = state[s + 3]!;
      for (let i = 0; i < frames; i += 1) {
        const x = data[i]!;
        const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        x2 = x1;
        x1 = x;
        y2 = y1;
        y1 = y;
        data[i] = y * gain;
      }
      state[s] = x1;
      state[s + 1] = x2;
      state[s + 2] = y1;
      state[s + 3] = y2;
    }
  }
}

// ------------------------------------------------------------------ compressor

/** Feed-forward, one gain for all channels from their mean square; soft knee. */
class Compressor {
  private readonly attack: number;
  private readonly release: number;
  private envelope = 0;
  /** Gain reduction, dB, the largest seen (for measurements). */
  deepestDb = 0;

  constructor(sampleRate: number) {
    this.attack = 1 - Math.exp(-1 / (COMPRESSOR.attackS * sampleRate));
    this.release = 1 - Math.exp(-1 / (COMPRESSOR.releaseS * sampleRate));
  }

  /** The gain reduction in dB (≤ 0) for a level in dB. */
  static curve(levelDb: number): number {
    const over = levelDb - COMPRESSOR.thresholdDb;
    const knee = COMPRESSOR.kneeDb;
    const slope = 1 / COMPRESSOR.ratio - 1;
    if (over <= -knee / 2) return 0;
    if (over >= knee / 2) return slope * over;
    const into = over + knee / 2;
    return (slope * into * into) / (2 * knee);
  }

  /** In place, times `gain` after the compression. */
  process(channels: Float32Array[], frames: number, gain: number): void {
    const count = channels.length;
    let envelope = this.envelope;
    for (let i = 0; i < frames; i += 1) {
      let square = 0;
      for (let c = 0; c < count; c += 1) {
        const x = channels[c]![i]!;
        square += x * x;
      }
      square /= count;
      envelope += (square > envelope ? this.attack : this.release) * (square - envelope);
      const levelDb = envelope > 1e-12 ? 10 * Math.log10(envelope) : -120;
      const reduction = Compressor.curve(levelDb);
      if (reduction < this.deepestDb) this.deepestDb = reduction;
      const g = (reduction === 0 ? 1 : 10 ** (reduction / 20)) * gain;
      for (let c = 0; c < count; c += 1) channels[c]![i] = channels[c]![i]! * g;
    }
    this.envelope = envelope;
  }
}

// ------------------------------------------------------------------ limiter

/**
 * True-peak limiter with look-ahead. For every sample the gain that keeps its
 * oversampled peak under the ceiling is known `lookahead` samples before it
 * plays; the gain applied is the smallest of those over the look-ahead,
 * averaged over the same length (so it is already down when the peak arrives
 * and never steps), then released slowly. Output sample n is input sample n:
 * `push` holds the look-ahead back, `flush` gives it out.
 */
export class TruePeakLimiter {
  /** Look-ahead, samples. */
  private readonly lookahead: number;
  /** The true-peak tracker answers this many samples late (its filter's delay). */
  private readonly delay = 6;
  private readonly ceiling: number;
  private readonly releaseKeep: number;
  private readonly peaks: TruePeakTracker[];
  private readonly mask: number;
  /** Input ring: the samples waiting for their gain, per channel. */
  private readonly ring: Float32Array[];
  /** The gain each position's own peak needs, a ring over the same positions. */
  private readonly required: Float64Array;
  /** Sliding minimum over `required`: a monotonic deque of positions. */
  private readonly deque: Float64Array;
  private dequeHead = 0;
  private dequeTail = 0;
  /** The last `lookahead + 1` minima and their sum (the average). */
  private readonly minima: Float64Array;
  private minimaSum: number;
  private minimaAt = 0;
  /** Positions fed so far, over the limiter's whole life. */
  private fed = 0;
  /** Outputs still to drop: the look-ahead's priming (and, after a flush, the zeros it fed). */
  private discard: number;
  private gain = 1;
  /** Deepest reduction, dB (≤ 0), for measurements. */
  deepestDb = 0;

  constructor(
    sampleRate: number,
    readonly channelCount: number,
    ceilingDbtp = CEILING_DBTP,
  ) {
    this.lookahead = Math.max(1, Math.round(LIMITER.lookaheadS * sampleRate));
    this.ceiling = dbToGain(ceilingDbtp);
    this.releaseKeep = Math.exp(-1 / (LIMITER.releaseS * sampleRate));
    this.peaks = Array.from({ length: channelCount }, () => new TruePeakTracker());
    let size = 1;
    while (size < this.lookahead + this.delay + 8) size *= 2;
    this.mask = size - 1;
    this.ring = Array.from({ length: channelCount }, () => new Float32Array(size));
    this.required = new Float64Array(size).fill(1);
    this.deque = new Float64Array(size);
    this.minima = new Float64Array(this.lookahead + 1).fill(1);
    this.minimaSum = this.lookahead + 1;
    this.discard = this.latency;
  }

  /** Samples between a sample going in and the same sample coming out. */
  get latency(): number {
    return this.delay + this.lookahead;
  }

  /** Feeds `frames` samples; returns the ones that are ready (planar). Over a stretch, out = in once `flush` is called. */
  push(channels: readonly Float32Array[], frames: number): Float32Array[] {
    const out = Array.from({ length: this.channelCount }, () => new Float32Array(Math.max(0, frames - this.discard)));
    let written = 0;
    for (let i = 0; i < frames; i += 1) {
      if (this.step(channels, i, out, written)) written += 1;
    }
    return out;
  }

  /** Everything still held back; the next `push` starts a new stretch, the gain carrying on. */
  flush(): Float32Array[] {
    const out = Array.from({ length: this.channelCount }, () => new Float32Array(Math.max(0, this.latency - this.discard)));
    const zeros = Array.from({ length: this.channelCount }, () => new Float32Array(this.latency));
    let written = 0;
    for (let i = 0; i < this.latency; i += 1) {
      if (this.step(zeros, i, out, written)) written += 1;
    }
    // The zeros just fed are in the line now: their outputs are dropped at the start of the next stretch.
    this.discard = this.latency;
    return out;
  }

  /** One sample in at position `fed`; position `fed - latency` out to `out[written]` (false while priming). */
  private step(input: readonly Float32Array[], i: number, out: Float32Array[], written: number): boolean {
    const { mask, lookahead } = this;
    const position = this.fed;
    this.fed += 1;
    let peak = 0;
    for (let c = 0; c < this.channelCount; c += 1) {
      const x = (input[c] ?? input[0])![i]!;
      this.ring[c]![position & mask] = x;
      const p = this.peaks[c]!.next(x);
      if (p > peak) peak = p;
    }
    // The peak just measured belongs to the sample `delay` back.
    const peakAt = position - this.delay;
    if (peakAt >= 0) {
      const required = peak > this.ceiling ? this.ceiling / peak : 1;
      this.required[peakAt & mask] = required;
      while (this.dequeTail > this.dequeHead && this.required[this.deque[(this.dequeTail - 1) & mask]! & mask]! >= required) {
        this.dequeTail -= 1;
      }
      this.deque[this.dequeTail & mask] = peakAt;
      this.dequeTail += 1;
    }
    // The minimum over [j, j + lookahead] for j = peakAt - lookahead …
    const j = peakAt - lookahead;
    while (this.dequeTail > this.dequeHead && this.deque[this.dequeHead & mask]! < j) this.dequeHead += 1;
    const minimum = this.dequeTail > this.dequeHead ? this.required[this.deque[this.dequeHead & mask]! & mask]! : 1;
    // … averaged over j - lookahead … j: at position j it is at or under what every peak near it needs.
    this.minimaSum += minimum - this.minima[this.minimaAt]!;
    this.minima[this.minimaAt] = minimum;
    this.minimaAt = this.minimaAt === lookahead ? 0 : this.minimaAt + 1;
    const average = this.minimaSum / (lookahead + 1);
    // Released towards 1, never above the average.
    const released = 1 - (1 - this.gain) * this.releaseKeep;
    this.gain = average < released ? average : released;
    if (this.gain < 1) {
      const db = 20 * Math.log10(this.gain);
      if (db < this.deepestDb) this.deepestDb = db;
    }
    if (this.discard > 0) {
      this.discard -= 1;
      return false;
    }
    const slot = j & mask;
    for (let c = 0; c < this.channelCount; c += 1) out[c]![written] = this.ring[c]![slot]! * this.gain;
    return true;
  }
}

// ------------------------------------------------------------------ the chain

/**
 * Steps 1–4 (high pass, input gain, slow level, compressor): what the loudness
 * worker measures to set the output gain. Output sample n is input sample n;
 * `push` returns what is ready, `flush` the rest.
 */
export class SoundShaper {
  private readonly highPass: HighPass;
  private readonly level: MultiLevelNormaliser;
  private readonly compressor: Compressor;
  private readonly inputGain: number;

  constructor(
    sampleRate: number,
    readonly channelCount: number,
    inputGainDb: number,
    private readonly outputGain = 1,
  ) {
    this.highPass = new HighPass(sampleRate, HIGH_PASS_HZ, channelCount);
    this.level = new MultiLevelNormaliser(sampleRate, LEVEL, channelCount);
    this.compressor = new Compressor(sampleRate);
    this.inputGain = dbToGain(inputGainDb);
  }

  /** Planar in (not changed), planar out. */
  push(channels: readonly Float32Array[], frames: number): Float32Array[] {
    const work = this.copy(channels, frames);
    this.highPass.process(work, frames, this.inputGain);
    return this.finish(this.level.pushChannels(work, frames));
  }

  flush(): Float32Array[] {
    return this.finish(this.level.flushChannels());
  }

  get deepestCompressionDb(): number {
    return this.compressor.deepestDb;
  }

  private copy(channels: readonly Float32Array[], frames: number): Float32Array[] {
    const out: Float32Array[] = [];
    for (let c = 0; c < this.channelCount; c += 1) {
      const source = channels[c] ?? channels[0];
      const copy = new Float32Array(frames);
      if (source) copy.set(source.subarray(0, frames));
      out.push(copy);
    }
    return out;
  }

  private finish(levelled: Float32Array[]): Float32Array[] {
    const frames = levelled[0]?.length ?? 0;
    if (frames > 0) this.compressor.process(levelled, frames, this.outputGain);
    return levelled;
  }
}

/** The whole chain of the export (steps 1–6). Output sample n is input sample n. */
export class SoundFixChain {
  private readonly shaper: SoundShaper;
  private readonly limiter: TruePeakLimiter;

  constructor(sampleRate: number, channelCount: number, settings: SoundFixSettings) {
    this.shaper = new SoundShaper(sampleRate, channelCount, settings.inputGainDb, dbToGain(settings.outputGainDb));
    this.limiter = new TruePeakLimiter(sampleRate, channelCount);
  }

  push(channels: readonly Float32Array[], frames: number): Float32Array[] {
    const shaped = this.shaper.push(channels, frames);
    return this.limiter.push(shaped, shaped[0]?.length ?? 0);
  }

  /** The end of a stretch of sound (a kesit): everything held back. The gains carry on. */
  flush(): Float32Array[] {
    const shaped = this.shaper.flush();
    const head = this.limiter.push(shaped, shaped[0]?.length ?? 0);
    const tail = this.limiter.flush();
    return head.map((channel, c) => {
      const rest = tail[c] ?? new Float32Array(0);
      const joined = new Float32Array(channel.length + rest.length);
      joined.set(channel, 0);
      joined.set(rest, channel.length);
      return joined;
    });
  }

  /** Deepest limiting so far, dB (≤ 0). */
  get deepestLimitingDb(): number {
    return this.limiter.deepestDb;
  }
}

/** A whole sound through the chain at once (tests, scripts). */
export function fixSound(channels: readonly Float32Array[], sampleRate: number, settings: SoundFixSettings): Float32Array[] {
  const chain = new SoundFixChain(sampleRate, channels.length, settings);
  const parts = [chain.push(channels, channels[0]?.length ?? 0), chain.flush()];
  return channels.map((_, c) => {
    const length = parts.reduce((sum, part) => sum + (part[c]?.length ?? 0), 0);
    const out = new Float32Array(length);
    let at = 0;
    for (const part of parts) {
      out.set(part[c] ?? new Float32Array(0), at);
      at += part[c]?.length ?? 0;
    }
    return out;
  });
}

// ------------------------------------------------------------------ deciding

/** How loud the sound is, in the words of the screen. */
export type LevelWord = 'veryQuiet' | 'quiet' | 'good' | 'loud' | 'veryLoud';

export function levelWord(integratedLufs: number): LevelWord {
  const off = integratedLufs - TARGET_LUFS;
  if (off < -12) return 'veryQuiet';
  if (off < -GOOD_WITHIN_LU) return 'quiet';
  if (off <= GOOD_WITHIN_LU) return 'good';
  if (off <= 8) return 'loud';
  return 'veryLoud';
}

/** The input gain for a source of this loudness (step 2). */
export function inputGainFor(sourceLufs: number): number {
  return Math.max(-MAX_INPUT_GAIN_DB, Math.min(MAX_INPUT_GAIN_DB, TARGET_LUFS - sourceLufs));
}

/** The output gain once steps 1–4 (and the limiter) were measured at loudness `shapedLufs` (step 5). */
export function outputGainFor(shapedLufs: number): number {
  if (!Number.isFinite(shapedLufs)) return 0;
  return Math.max(-MAX_OUTPUT_GAIN_DB, Math.min(MAX_OUTPUT_GAIN_DB, TARGET_LUFS - shapedLufs));
}

/**
 * How much of the sound is at full scale (`CLIPPED_FROM`), counted over every sample of every
 * channel as it is decoded, before anything is changed. Streaming: the first measurement pushes
 * every chunk. What was cut off cannot be put back — the chain only turns the whole level, so the
 * screen says so (`wizard.duzelt.clipped`) and never says the distortion was removed.
 */
export class ClipMeter {
  private atFullScale = 0;
  private samples = 0;

  push(channels: readonly Float32Array[], frames: number): void {
    for (const channel of channels) {
      const length = Math.min(frames, channel.length);
      for (let i = 0; i < length; i += 1) {
        const value = channel[i] as number;
        if (value >= CLIPPED_FROM || value <= -CLIPPED_FROM) this.atFullScale += 1;
      }
      this.samples += length;
    }
  }

  /** The share (0–1) of the samples pushed so far that were at full scale; 0 before any. */
  get share(): number {
    return this.samples === 0 ? 0 : this.atFullScale / this.samples;
  }
}

/** Whether a recording with this share of samples at full scale is cut off in places. */
export function isClipped(clippedShare: number): boolean {
  return clippedShare >= CLIPPED_SHARE;
}

/** What the loudness worker found, and what the screen says. */
export interface SoundCheck {
  version: typeof SOUND_FIX_VERSION;
  /** `clippedShare`: the share of its samples at full scale (`ClipMeter`). */
  before: { integratedLufs: number; lraLu: number; truePeakDbtp: number; clippedShare: number };
  /** The chain's own result over the whole sound (steps 1–6, measured before the encoder). */
  after: { integratedLufs: number; lraLu: number; truePeakDbtp: number };
  settings: SoundFixSettings;
  verdict: SoundVerdict;
}

export type SoundVerdict =
  /** Nothing to turn up: silence, or nearly. Nothing is offered for download. */
  | { kind: 'silent' }
  | {
      kind: 'fix';
      before: LevelWord;
      /** The loudness range was wide: quiet stretches are raised. */
      uneven: boolean;
      /** Already at a good level, even and under the peak ceiling: said, and the download still offered. */
      alreadyGood: boolean;
      /** The gains ran out before the target: the result stays quieter than "normal" (said honestly). */
      stillQuiet: boolean;
      /** Cut off at full scale in places (`isClipped`): the level is fixed, the distortion stays (said honestly). */
      clipped: boolean;
    };

export function soundVerdict(
  before: Pick<R128Result, 'integratedLufs' | 'lraLu' | 'truePeakDbtp'>,
  predictedLufs: number,
  clippedShare = 0,
): SoundVerdict {
  if (!(before.integratedLufs >= SILENT_BELOW_LUFS)) return { kind: 'silent' };
  const word = levelWord(before.integratedLufs);
  const uneven = before.lraLu >= UNEVEN_FROM_LU;
  const clipped = isClipped(clippedShare);
  return {
    kind: 'fix',
    before: word,
    uneven,
    alreadyGood: word === 'good' && !uneven && !clipped && before.truePeakDbtp <= FILE_TRUE_PEAK_DBTP,
    stillQuiet: Number.isFinite(predictedLufs) && predictedLufs < TARGET_LUFS - GOOD_WITHIN_LU,
    clipped,
  };
}

/**
 * From the two measurements to what the export is told and what the screen
 * says: `before` is the sound as it is, `rehearsed` is steps 1–4 and the
 * limiter at `inputGainDb` (`SoundRehearsal`). The predicted result is the
 * rehearsal with the output gain added (the limiter's share of a small output
 * gain is left out: measured within half a unit, ADR-049).
 */
export function decideSoundFix(
  before: Pick<R128Result, 'integratedLufs' | 'lraLu' | 'truePeakDbtp'>,
  inputGainDb: number,
  rehearsed: Pick<R128Result, 'integratedLufs' | 'lraLu' | 'truePeakDbtp'>,
  /** From `ClipMeter` over the first measurement. */
  clippedShare = 0,
): SoundCheck {
  const outputGainDb = outputGainFor(rehearsed.integratedLufs);
  const predicted = rehearsed.integratedLufs + outputGainDb;
  return {
    version: SOUND_FIX_VERSION,
    before: { integratedLufs: before.integratedLufs, lraLu: before.lraLu, truePeakDbtp: before.truePeakDbtp, clippedShare },
    after: {
      integratedLufs: predicted,
      lraLu: rehearsed.lraLu,
      truePeakDbtp: Math.min(CEILING_DBTP, rehearsed.truePeakDbtp + outputGainDb),
    },
    settings: { version: SOUND_FIX_VERSION, inputGainDb, outputGainDb },
    verdict: soundVerdict(before, predicted, clippedShare),
  };
}

/** Whether `settings` were made for this chain (an old page's plan is not used by a new worker). */
export function usableSettings(settings: unknown): settings is SoundFixSettings {
  if (!settings || typeof settings !== 'object') return false;
  const s = settings as Partial<SoundFixSettings>;
  return (
    s.version === SOUND_FIX_VERSION &&
    typeof s.inputGainDb === 'number' &&
    Number.isFinite(s.inputGainDb) &&
    Math.abs(s.inputGainDb) <= MAX_INPUT_GAIN_DB &&
    typeof s.outputGainDb === 'number' &&
    Number.isFinite(s.outputGainDb) &&
    Math.abs(s.outputGainDb) <= MAX_OUTPUT_GAIN_DB
  );
}

// ------------------------------------------------------------------ measuring (the loudness worker)

/** How long the before/after the screen plays is. */
export const LISTEN_S = 5;
/** The limiter of the "after" is started this long before it, so its gain is already where it would be. */
const LISTEN_WARMUP_S = 0.3;
/** A 100 ms part counts as sound when it is no more than this far under the whole sound (a far-away second speaker is). */
const LISTEN_SOUNDING_LU = 30;
/** A stretch is worth listening to when this share of its parts is sound (speech has its gaps between syllables). */
const LISTEN_SOUNDING_SHARE = 0.4;

/**
 * Where the five seconds to listen to start, in 100 ms parts of the first
 * measurement: the quietest stretch that is sound most of the time (a quiet
 * speaker is what the change is for), or the loudest one when no stretch is.
 */
export function listenStartPart(parts: ArrayLike<number>, integratedLufs: number, partS = 0.1): number {
  const length = Math.round(LISTEN_S / partS);
  if (parts.length <= length) return 0;
  const sounding = Number.isFinite(integratedLufs) ? 10 ** ((integratedLufs - LISTEN_SOUNDING_LU + 0.691) / 10) : Infinity;
  let best = -1;
  let bestEnergy = Infinity;
  let loudest = 0;
  let loudestEnergy = -1;
  let sum = 0;
  let count = 0;
  for (let j = 0; j < parts.length; j += 1) {
    sum += parts[j] as number;
    if ((parts[j] as number) > sounding) count += 1;
    if (j >= length) {
      sum -= parts[j - length] as number;
      if ((parts[j - length] as number) > sounding) count -= 1;
    }
    if (j < length - 1) continue;
    const start = j - length + 1;
    if (sum > loudestEnergy) {
      loudestEnergy = sum;
      loudest = start;
    }
    if (count >= length * LISTEN_SOUNDING_SHARE && sum < bestEnergy) {
      bestEnergy = sum;
      best = start;
    }
  }
  return best >= 0 ? best : loudest;
}

interface Meter {
  push(channels: readonly Float32Array[], frames: number): void;
}

/**
 * The second measurement: steps 1–4 and the limiter over the whole sound, at
 * the input gain the first measurement decided, measured as a listener's meter
 * would. Its loudness sets the output gain; on the way it keeps the five
 * seconds to listen to (as they were, and after steps 1–4).
 */
export class SoundRehearsal {
  private readonly shaper: SoundShaper;
  private readonly limiter: TruePeakLimiter;
  private readonly listenFrom: number;
  private readonly listenTo: number;
  private readonly shapedFrom: number;
  private readonly before: Float32Array[];
  private readonly shaped: Float32Array[];
  private inputAt = 0;
  private shapedAt = 0;

  constructor(
    readonly sampleRate: number,
    readonly channelCount: number,
    readonly inputGainDb: number,
    private readonly meter: Meter,
    /** First sample of the five seconds to listen to. */
    listenStart: number,
    totalFrames: number,
  ) {
    this.shaper = new SoundShaper(sampleRate, channelCount, inputGainDb);
    this.limiter = new TruePeakLimiter(sampleRate, channelCount);
    const length = Math.round(LISTEN_S * sampleRate);
    this.listenFrom = Math.max(0, Math.min(listenStart, totalFrames - length));
    this.listenTo = Math.max(this.listenFrom, Math.min(totalFrames, this.listenFrom + length));
    this.shapedFrom = Math.max(0, this.listenFrom - Math.round(LISTEN_WARMUP_S * sampleRate));
    this.before = Array.from({ length: channelCount }, () => new Float32Array(this.listenTo - this.listenFrom));
    this.shaped = Array.from({ length: channelCount }, () => new Float32Array(this.listenTo - this.shapedFrom));
  }

  push(channels: readonly Float32Array[], frames: number): void {
    keep(channels, frames, this.inputAt, this.listenFrom, this.before);
    this.inputAt += frames;
    this.afterShaper(this.shaper.push(channels, frames));
  }

  /** Measured to the end. */
  end(): void {
    this.afterShaper(this.shaper.flush());
    const tail = this.limiter.flush();
    this.meter.push(tail, tail[0]?.length ?? 0);
  }

  /** The five seconds before and after (planar, `sampleRate`), given the output gain. Call after `end`. */
  listen(outputGainDb: number): { before: Float32Array[]; after: Float32Array[]; startS: number } {
    const gain = dbToGain(outputGainDb);
    const scaled = this.shaped.map((channel) => channel.map((value) => value * gain));
    // The "after": the kept stretch with the output gain, through a limiter of its own.
    const limiter = new TruePeakLimiter(this.sampleRate, this.channelCount);
    const head = limiter.push(scaled, scaled[0]?.length ?? 0);
    const rest = limiter.flush();
    const skip = this.listenFrom - this.shapedFrom;
    const after = head.map((channel, c) => {
      const joined = new Float32Array(channel.length + (rest[c]?.length ?? 0));
      joined.set(channel, 0);
      joined.set(rest[c] ?? new Float32Array(0), channel.length);
      return joined.slice(skip, skip + (this.listenTo - this.listenFrom));
    });
    return { before: this.before, after, startS: this.listenFrom / this.sampleRate };
  }

  get deepestCompressionDb(): number {
    return this.shaper.deepestCompressionDb;
  }

  get deepestLimitingDb(): number {
    return this.limiter.deepestDb;
  }

  private afterShaper(shaped: Float32Array[]): void {
    const frames = shaped[0]?.length ?? 0;
    if (frames === 0) return;
    keep(shaped, frames, this.shapedAt, this.shapedFrom, this.shaped);
    this.shapedAt += frames;
    const limited = this.limiter.push(shaped, frames);
    this.meter.push(limited, limited[0]?.length ?? 0);
  }
}

/** Copies the part of a chunk (whose first sample is `at`) that falls into `into` (whose first sample is `from`). */
function keep(channels: readonly Float32Array[], frames: number, at: number, from: number, into: Float32Array[]): void {
  const length = into[0]?.length ?? 0;
  const start = Math.max(at, from);
  const end = Math.min(at + frames, from + length);
  if (end <= start) return;
  for (let c = 0; c < into.length; c += 1) {
    const source = channels[c] ?? channels[0];
    if (source) (into[c] as Float32Array).set(source.subarray(start - at, end - at), start - from);
  }
}
