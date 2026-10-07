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
  minContrastDb: 0,
};

/** Blocks quieter than this count as this for the contrast rule (digital silence has no level). */
const CONTRAST_FLOOR = 10 ** (-90 / 20);

const fromDb = (db: number) => 10 ** (db / 20);

export class LevelNormaliser {
  private readonly block: number;
  private readonly back: number;
  private readonly ahead: number;
  private readonly target: number;
  private readonly maxGain: number;
  private readonly minContrast: number;
  /** Samples waiting for their gain: whole blocks first, then the block being filled. */
  private held: Float32Array;
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

  constructor(sampleRate: number, params: Partial<LevelParams> = {}) {
    const p = { ...DEFAULT_LEVEL, ...params };
    this.block = Math.max(1, Math.round(p.blockS * sampleRate));
    this.back = Math.max(0, Math.round(p.backS / p.blockS));
    this.ahead = Math.max(0, Math.round(p.aheadS / p.blockS));
    this.target = fromDb(p.targetDb);
    this.maxGain = fromDb(Math.max(0, p.maxGainDb));
    this.minContrast = fromDb(Math.max(0, p.minContrastDb));
    this.held = new Float32Array(this.block * (this.ahead + 4));
  }

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
  private drain(all: boolean): Float32Array {
    const lastKnown = this.completed - 1;
    const ready = all ? this.completed : Math.max(this.nextOut, this.completed - this.ahead);
    const count = ready - this.nextOut;
    const tail = all ? this.fillCount : 0;
    const out = new Float32Array(Math.max(0, count) * this.block + tail);
    let at = 0;
    for (let index = this.nextOut; index < ready; index += 1) {
      const gain = this.gainFor(index, lastKnown);
      const from = this.lastGain ?? gain;
      // The gain glides across the block, so no step is ever heard (or detected) at a block edge.
      for (let i = 0; i < this.block; i += 1) {
        const g = from + ((gain - from) * (i + 1)) / this.block;
        const value = (this.held[at + i] as number) * g;
        out[at + i] = value > 1 ? 1 : value < -1 ? -1 : value;
      }
      this.lastGain = gain;
      at += this.block;
    }
    if (tail > 0) {
      const gain = this.lastGain ?? 1;
      for (let i = 0; i < tail; i += 1) {
        const value = (this.held[at + i] as number) * gain;
        out[at + i] = value > 1 ? 1 : value < -1 ? -1 : value;
      }
      at += tail;
    }
    this.nextOut = ready;
    // Keep what has not gone out, and only the levels a later window can still reach.
    this.held.copyWithin(0, at, this.heldLength);
    this.heldLength -= at;
    if (all) this.fillCount = 0;
    const keepFrom = Math.max(this.firstLevel, this.nextOut - this.back);
    if (keepFrom > this.firstLevel) {
      this.levels.splice(0, keepFrom - this.firstLevel);
      this.firstLevel = keepFrom;
    }
    return out;
  }

  push(samples: Float32Array): Float32Array {
    if (this.heldLength + samples.length > this.held.length) {
      const grown = new Float32Array(Math.max(this.held.length * 2, this.heldLength + samples.length));
      grown.set(this.held.subarray(0, this.heldLength));
      this.held = grown;
    }
    this.held.set(samples, this.heldLength);
    this.heldLength += samples.length;
    for (let i = 0; i < samples.length; i += 1) {
      const value = samples[i] as number;
      this.fillSum += value * value;
      this.fillCount += 1;
      if (this.fillCount === this.block) {
        this.levels.push(Math.sqrt(this.fillSum / this.block));
        this.completed += 1;
        this.fillSum = 0;
        this.fillCount = 0;
      }
    }
    return this.drain(false);
  }

  flush(): Float32Array {
    return this.drain(true);
  }
}

/**
 * One speech span at full level for the recogniser: turned up (never down)
 * so that its loudest block reaches `targetDb`, by at most `maxGainDb`.
 * A span is short (≤ 30 s) and is one voice at one distance, so one gain
 * for the whole span is enough and nothing pumps.
 */
export function atFullLevel(
  samples: Float32Array,
  sampleRate: number,
  params: Pick<LevelParams, 'blockS' | 'targetDb' | 'maxGainDb'> = DEFAULT_LEVEL,
): Float32Array {
  const block = Math.max(1, Math.round(params.blockS * sampleRate));
  let loudest = 0;
  for (let at = 0; at + block <= samples.length; at += block) {
    let sum = 0;
    for (let i = at; i < at + block; i += 1) sum += (samples[i] as number) * (samples[i] as number);
    const level = Math.sqrt(sum / block);
    if (level > loudest) loudest = level;
  }
  if (loudest <= 0) return samples;
  const gain = Math.min(fromDb(Math.max(0, params.maxGainDb)), Math.max(1, fromDb(params.targetDb) / loudest));
  if (gain === 1) return samples;
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    const value = (samples[i] as number) * gain;
    out[i] = value > 1 ? 1 : value < -1 ? -1 : value;
  }
  return out;
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
