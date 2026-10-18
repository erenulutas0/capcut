/**
 * Level normalisation in front of the speech detector (ADR-036, 7 Oct 2026).
 *
 * Why: the speech detector (Silero) adapts to the level it has been hearing.
 * When quiet speech follows loud sound in the same file — a second speaker
 * far from the microphone, a camera that moved away, a clip cut together
 * from two recordings — it scores the quiet part as "no speech" and those
 * minutes never reach the recogniser (the October spike's stress finding:
 * 178 s of 567 s found; on the realistic set of 7 Oct the same thing).
 *
 * What: a slow automatic gain. The sound is cut into short blocks; each
 * block is turned up so that the LOUDEST block near it (a little behind,
 * more ahead) reaches a fixed level. Speech with its own short pauses keeps
 * one gain (the window bridges the pauses); a long quiet stretch is turned
 * up, but never by more than `maxGainDb`, and nothing is ever turned down.
 *
 * Only the detector hears this copy. It answers one question — where is
 * the speech — and the answer is a list of times; what the recogniser is
 * given is cut from the sound as it was decoded.
 *
 * Pure and streaming: `push` returns exactly as many samples as it was
 * given so far minus the look-ahead still held back; `flush` returns the
 * rest. Sample `n` out is sample `n` in, turned up.
 */

export interface LevelParams {
  /** Length of one block. */
  blockS: number;
  /** How far back the loudest-block search reaches. Short, so a quiet reply right after a loud voice is turned up at once. */
  backS: number;
  /** How far ahead it reaches. Longer than a pause inside a sentence. */
  aheadS: number;
  /** Where the loudest nearby block is brought to (RMS, dBFS). */
  targetDb: number;
  /** The most a block is ever turned up. */
  maxGainDb: number;
  /**
   * The gain only moves where the sound near a block has at least this much
   * contrast between its loudest and its quietest block. Speech always has
   * it (syllables and the gaps between them); a pause, a hum or a room does
   * not — there the gain HOLDS its last value instead of climbing, so the
   * noise of a pause is never turned up louder than the speech around it.
   * 0 = no such rule.
   */
  minContrastDb: number;
}

export const DEFAULT_LEVEL: LevelParams = {
  blockS: 0.05,
  backS: 0.3,
  aheadS: 1.5,
  targetDb: -20,
  maxGainDb: 40,
  minContrastDb: 20,
};

/** Blocks quieter than this count as this for the contrast rule (digital silence has no level). */
const CONTRAST_FLOOR = 10 ** (-100 / 20);

const fromDb = (db: number) => 10 ** (db / 20);

/**
 * What a listener's copy needs beyond the detector's (ADR-049, "Sesi düzelt"):
 * the same slow gain, for every channel at once (one gain from all of them, so
 * the picture of a stereo sound does not move), allowed above full scale (a
 * limiter after it decides the peaks), and moving at most this fast.
 */
export interface ListeningLevelParams extends LevelParams {
  /** Clamp to ±1 as the detector's copy does (default true). */
  clip?: boolean;
  /** The fastest the gain may rise, dB per second (default: no limit). */
  maxRiseDbPerS?: number;
  /** The fastest the gain may fall, dB per second (default: no limit). */
  maxFallDbPerS?: number;
}

/**
 * The slow gain over planar channels. With one channel, clamping on and no
 * speed limits it is exactly the detector's `LevelNormaliser`, sample for
 * sample (the mono class below is this one).
 */
export class MultiLevelNormaliser {
  private readonly block: number;
  private readonly back: number;
  private readonly ahead: number;
  private readonly target: number;
  private readonly maxGain: number;
  private readonly minContrast: number;
  private readonly clip: boolean;
  /** Per-block gain ratios for the speed limits (Infinity: none). */
  private readonly maxRise: number;
  private readonly maxFall: number;
  /** Samples waiting for their gain, per channel: whole blocks first, then the block being filled. */
  private held: Float32Array[];
  private heldLength = 0;
  /** RMS of every completed block still inside some window, oldest first; `firstLevel` is the index of the oldest. */
  private levels: number[] = [];
  private firstLevel = 0;
  /** Index of the next block to be given its gain and sent out. */
  private nextOut = 0;
  private completed = 0;
  private fillSum = 0;
  private fillCount = 0;
  private lastGain: number | null = null;

  constructor(
    sampleRate: number,
    params: Partial<ListeningLevelParams> = {},
    readonly channelCount = 1,
  ) {
    const p = { ...DEFAULT_LEVEL, ...params };
    this.block = Math.max(1, Math.round(p.blockS * sampleRate));
    this.back = Math.max(0, Math.round(p.backS / p.blockS));
    this.ahead = Math.max(0, Math.round(p.aheadS / p.blockS));
    this.target = fromDb(p.targetDb);
    this.maxGain = fromDb(Math.max(0, p.maxGainDb));
    this.minContrast = fromDb(Math.max(0, p.minContrastDb));
    this.clip = params.clip !== false;
    this.maxRise = params.maxRiseDbPerS === undefined ? Infinity : fromDb(params.maxRiseDbPerS * p.blockS);
    this.maxFall = params.maxFallDbPerS === undefined ? Infinity : fromDb(params.maxFallDbPerS * p.blockS);
    this.held = Array.from({ length: channelCount }, () => new Float32Array(this.block * (this.ahead + 4)));
  }

  /** The gain the loudest block near this one asks for (before any speed limit). */
  private gainFor(index: number, lastKnown: number): number {
    let loudest = 0;
    let quietest = Infinity;
    const from = Math.max(this.firstLevel, index - this.back);
    const to = Math.min(lastKnown, index + this.ahead);
    for (let k = from; k <= to; k += 1) {
      const level = this.levels[k - this.firstLevel] as number;
      if (level > loudest) loudest = level;
      if (level < quietest) quietest = level;
    }
    if (this.minContrast > 1) {
      // Nothing here rises out of its own background: hold (1 before any speech was seen).
      if (loudest < Math.max(quietest, CONTRAST_FLOOR) * this.minContrast) return this.lastGain ?? 1;
    } else if (loudest <= 0) {
      return this.maxGain;
    }
    return Math.min(this.maxGain, Math.max(1, this.target / loudest));
  }

  /** Sends out every block whose whole window is known (`all`: whatever is left, at the end). */
  private drain(all: boolean): Float32Array[] {
    const lastKnown = this.completed - 1;
    const ready = all ? this.completed : Math.max(this.nextOut, this.completed - this.ahead);
    const count = ready - this.nextOut;
    const tail = all ? this.fillCount : 0;
    const length = Math.max(0, count) * this.block + tail;
    const out = this.held.map(() => new Float32Array(length));
    const clip = this.clip;
    let at = 0;
    for (let index = this.nextOut; index < ready; index += 1) {
      let gain = this.gainFor(index, lastKnown);
      if (this.lastGain !== null) {
        if (gain > this.lastGain * this.maxRise) gain = this.lastGain * this.maxRise;
        else if (gain < this.lastGain / this.maxFall) gain = this.lastGain / this.maxFall;
      }
      const from = this.lastGain ?? gain;
      // The gain glides across the block, so no step is ever heard (or detected) at a block edge.
      for (let c = 0; c < this.channelCount; c += 1) {
        const source = this.held[c] as Float32Array;
        const target = out[c] as Float32Array;
        for (let i = 0; i < this.block; i += 1) {
          const g = from + ((gain - from) * (i + 1)) / this.block;
          const value = (source[at + i] as number) * g;
          target[at + i] = clip ? (value > 1 ? 1 : value < -1 ? -1 : value) : value;
        }
      }
      this.lastGain = gain;
      at += this.block;
    }
    if (tail > 0) {
      const gain = this.lastGain ?? 1;
      for (let c = 0; c < this.channelCount; c += 1) {
        const source = this.held[c] as Float32Array;
        const target = out[c] as Float32Array;
        for (let i = 0; i < tail; i += 1) {
          const value = (source[at + i] as number) * gain;
          target[at + i] = clip ? (value > 1 ? 1 : value < -1 ? -1 : value) : value;
        }
      }
      at += tail;
    }
    this.nextOut = ready;
    // Keep what has not gone out, and only the levels a later window can still reach.
    for (const channel of this.held) channel.copyWithin(0, at, this.heldLength);
    this.heldLength -= at;
    if (all) this.fillCount = 0;
    const keepFrom = Math.max(this.firstLevel, this.nextOut - this.back);
    if (keepFrom > this.firstLevel) {
      this.levels.splice(0, keepFrom - this.firstLevel);
      this.firstLevel = keepFrom;
    }
    return out;
  }

  /** Planar input, `frames` samples per channel; returns what is ready, planar, in order. */
  pushChannels(channels: readonly Float32Array[], frames: number): Float32Array[] {
    if (this.heldLength + frames > (this.held[0]?.length ?? 0)) {
      const size = Math.max((this.held[0]?.length ?? 0) * 2, this.heldLength + frames);
      this.held = this.held.map((channel) => {
        const grown = new Float32Array(size);
        grown.set(channel.subarray(0, this.heldLength));
        return grown;
      });
    }
    for (let c = 0; c < this.channelCount; c += 1) {
      (this.held[c] as Float32Array).set((channels[c] ?? channels[0] ?? new Float32Array(frames)).subarray(0, frames), this.heldLength);
    }
    const start = this.heldLength;
    this.heldLength += frames;
    const divisor = this.block * this.channelCount;
    for (let i = 0; i < frames; i += 1) {
      for (let c = 0; c < this.channelCount; c += 1) {
        const value = (this.held[c] as Float32Array)[start + i] as number;
        this.fillSum += value * value;
      }
      this.fillCount += 1;
      if (this.fillCount === this.block) {
        this.levels.push(Math.sqrt(this.fillSum / divisor));
        this.completed += 1;
        this.fillSum = 0;
        this.fillCount = 0;
      }
    }
    return this.drain(false);
  }

  /** Everything still held back (the end of a stretch of sound); the gain carries on into the next. */
  flushChannels(): Float32Array[] {
    return this.drain(true);
  }
}

/** The detector's mono copy (ADR-036). */
export class LevelNormaliser {
  private readonly inner: MultiLevelNormaliser;

  constructor(sampleRate: number, params: Partial<LevelParams> = {}) {
    this.inner = new MultiLevelNormaliser(sampleRate, params, 1);
  }

  push(samples: Float32Array): Float32Array {
    return this.inner.pushChannels([samples], samples.length)[0] as Float32Array;
  }

  flush(): Float32Array {
    return this.inner.flushChannels()[0] as Float32Array;
  }
}

/** The whole of a sound at once (tests, measurement scripts). */
export function normaliseLevel(samples: Float32Array, sampleRate: number, params: Partial<LevelParams> = {}): Float32Array {
  const normaliser = new LevelNormaliser(sampleRate, params);
  const head = normaliser.push(samples);
  const tail = normaliser.flush();
  const out = new Float32Array(head.length + tail.length);
  out.set(head, 0);
  out.set(tail, head.length);
  return out;
}
