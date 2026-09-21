/**
 * Loudness envelope framing (ADR-018): decoded PCM in, dBFS per 10 ms out.
 *
 * Pure so the framing math can be unit-tested without a browser, and so the
 * worker that feeds it stays a thin decode loop. The same numbers must come
 * out as ffmpeg's `asetnsamples=480,astats=metadata=1:reset=1` on a 48 kHz
 * source (the evaluation measures cuts with ffmpeg, the app with this), so
 * the definition is deliberately plain: mono mix = mean of the channels, RMS
 * over the samples of the frame, 20·log10, digital silence clamped to the
 * floor.
 */

import { FLOOR_DB, type LoudnessEnvelope } from './silence';
import { US_PER_SECOND, type Micros } from './time';

export const ENVELOPE_FRAME_US: Micros = 10_000;

/** Mean square → dBFS, with silence (and anything below the floor) clamped. */
export function meanSquareToDb(meanSquare: number): number {
  if (!(meanSquare > 0)) return FLOOR_DB;
  const db = 10 * Math.log10(meanSquare);
  return db < FLOOR_DB ? FLOOR_DB : db;
}

/**
 * Accumulates one source range `[startUs, endUs)` into fixed frames.
 *
 * Frame k covers source samples `[boundary(k), boundary(k+1))`, where the
 * boundary is the sample nearest to `startUs + k·frameUs`. Rounding the
 * boundary per frame (instead of using an integer frame size) keeps 44.1 kHz
 * sources on the same 10 ms grid without drift.
 *
 * Samples arrive in any chunking; those outside the range are ignored. A
 * frame that received no samples at all (the audio track ended before the
 * moment did) is reported as silence: nothing plays there.
 */
export class LoudnessMeter {
  readonly frameCount: number;
  private readonly sums: Float64Array;
  private readonly counts: Uint32Array;
  private readonly firstSample: number;
  private readonly endSample: number;
  /** Highest source sample seen so far (exclusive); drives honest progress. */
  private reached: number;

  constructor(
    readonly startUs: Micros,
    readonly endUs: Micros,
    readonly sampleRate: number,
    readonly frameUs: Micros = ENVELOPE_FRAME_US,
  ) {
    this.frameCount = Math.max(0, Math.ceil((endUs - startUs) / frameUs));
    this.sums = new Float64Array(this.frameCount);
    this.counts = new Uint32Array(this.frameCount);
    this.firstSample = this.boundary(0);
    this.endSample = Math.round((endUs * sampleRate) / US_PER_SECOND);
    this.reached = this.firstSample;
  }

  /** First source sample of frame `k` (frame `frameCount` ends at the range end). */
  boundary(k: number): number {
    if (k >= this.frameCount) return Math.round((this.endUs * this.sampleRate) / US_PER_SECOND);
    return Math.round(((this.startUs + k * this.frameUs) * this.sampleRate) / US_PER_SECOND);
  }

  /** Frame that holds source sample `s` (assumes `s` inside the range). */
  private frameOf(s: number): number {
    // Estimate, then correct for the per-frame rounding of the boundaries.
    const samplesPerFrame = (this.frameUs * this.sampleRate) / US_PER_SECOND;
    let k = Math.floor((s - this.firstSample) / samplesPerFrame);
    k = Math.max(0, Math.min(this.frameCount - 1, k));
    while (k > 0 && s < this.boundary(k)) k -= 1;
    while (k < this.frameCount - 1 && s >= this.boundary(k + 1)) k += 1;
    return k;
  }

  /**
   * Adds planar PCM. `firstSample` is the source-clock index of the chunk's
   * first sample (`round(timestamp · sampleRate)`).
   */
  push(channels: readonly Float32Array[], firstSample: number, sampleCount: number): void {
    const channelCount = channels.length;
    if (channelCount === 0 || sampleCount <= 0 || this.frameCount === 0) return;
    const from = Math.max(firstSample, this.firstSample);
    const to = Math.min(firstSample + sampleCount, this.endSample);
    if (to <= from) return;

    const scale = 1 / channelCount;
    let k = this.frameOf(from);
    let frameEnd = this.boundary(k + 1);
    let sum = 0;
    let count = 0;
    for (let s = from; s < to; s += 1) {
      if (s >= frameEnd) {
        this.sums[k] = (this.sums[k] ?? 0) + sum;
        this.counts[k] = (this.counts[k] ?? 0) + count;
        sum = 0;
        count = 0;
        while (s >= frameEnd && k < this.frameCount - 1) {
          k += 1;
          frameEnd = this.boundary(k + 1);
        }
      }
      const i = s - firstSample;
      let mono = 0;
      for (let c = 0; c < channelCount; c += 1) mono += channels[c]?.[i] ?? 0;
      mono *= scale;
      sum += mono * mono;
      count += 1;
    }
    this.sums[k] = (this.sums[k] ?? 0) + sum;
    this.counts[k] = (this.counts[k] ?? 0) + count;
    if (to > this.reached) this.reached = to;
  }

  /** Frames the decode has fully passed; used for progress only. */
  get framesDone(): number {
    if (this.reached >= this.endSample) return this.frameCount;
    return this.frameOf(this.reached);
  }

  finish(): LoudnessEnvelope {
    const db: number[] = new Array<number>(this.frameCount);
    for (let k = 0; k < this.frameCount; k += 1) {
      const count = this.counts[k] ?? 0;
      db[k] = count === 0 ? FLOOR_DB : meanSquareToDb((this.sums[k] ?? 0) / count);
    }
    return { startUs: this.startUs, frameUs: this.frameUs, db };
  }
}
