/**
 * Loudness as people hear it, measured on the device (ADR-049): ITU-R BS.1770-4
 * integrated loudness (LUFS), EBU Tech 3342 loudness range (LRA) and the
 * 4×-oversampled true peak (dBTP) — the numbers ffmpeg's `ebur128` filter
 * reports, so the evaluation measures the app's files with ffmpeg and the app
 * measures the video with this.
 *
 * Not the envelope of `loudness.ts` (ADR-018): that one is a plain RMS per
 * 10 ms for finding pauses. A listener's "loud" weights the frequencies the
 * ear is sensitive to (the K filter) and ignores pauses (the gates); only
 * that number can be brought to a target and checked by anybody else's meter.
 *
 * Pure and streaming: `push` takes planar PCM in any chunking; memory is one
 * number per 100 ms (36 000 for an hour) plus the filter state.
 */

/** Blocks quieter than this are not sound at all (BS.1770-4 §2.8). */
export const ABSOLUTE_GATE_LUFS = -70;
/** Blocks this far below the mean of the loud ones are pauses (BS.1770-4). */
export const RELATIVE_GATE_LU = -10;
/** The loudness range's own relative gate (EBU Tech 3342). */
export const LRA_RELATIVE_GATE_LU = -20;

/** Gating blocks are 400 ms long and start every 100 ms: four 100 ms parts each. */
export const SUB_BLOCK_S = 0.1;
const BLOCK_PARTS = 4;
/** Short-term loudness (3 s) for the loudness range: thirty 100 ms parts. */
const SHORT_TERM_PARTS = 30;

export interface BiquadCoefficients {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/**
 * The two stages of the K filter for any sample rate (BS.1770-4 Annex 1; the
 * analogue prototype re-derived per rate, as libebur128 and ffmpeg do): a high
 * shelf of +4 dB above ~1.7 kHz, then a high pass at ~38 Hz.
 */
export function kWeighting(sampleRate: number): [BiquadCoefficients, BiquadCoefficients] {
  const shelfF0 = 1681.974450955533;
  const shelfGainDb = 3.999843853973347;
  const shelfQ = 0.7071752369554196;
  const k1 = Math.tan((Math.PI * shelfF0) / sampleRate);
  const vh = 10 ** (shelfGainDb / 20);
  const vb = vh ** 0.4996667741545416;
  const a0Shelf = 1 + k1 / shelfQ + k1 * k1;
  const shelf: BiquadCoefficients = {
    b0: (vh + (vb * k1) / shelfQ + k1 * k1) / a0Shelf,
    b1: (2 * (k1 * k1 - vh)) / a0Shelf,
    b2: (vh - (vb * k1) / shelfQ + k1 * k1) / a0Shelf,
    a1: (2 * (k1 * k1 - 1)) / a0Shelf,
    a2: (1 - k1 / shelfQ + k1 * k1) / a0Shelf,
  };
  const passF0 = 38.13547087602444;
  const passQ = 0.5003270373238773;
  const k2 = Math.tan((Math.PI * passF0) / sampleRate);
  const a0Pass = 1 + k2 / passQ + k2 * k2;
  const pass: BiquadCoefficients = {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (k2 * k2 - 1)) / a0Pass,
    a2: (1 - k2 / passQ + k2 * k2) / a0Pass,
  };
  return [shelf, pass];
}

/**
 * The interpolation filter of BS.1770-4 Annex 2: four phases of twelve taps,
 * phase k giving the value k/4 of the way to the next sample (with the
 * filter's own delay). The largest magnitude over all phases is the true peak.
 */
export const TRUE_PEAK_PHASES: readonly (readonly number[])[] = [
  [
    0.001708984375, 0.010986328125, -0.0196533203125, 0.033203125, -0.0594482421875, 0.1373291015625,
    0.97216796875, -0.102294921875, 0.047607421875, -0.0266113281250, 0.014892578125, -0.00830078125,
  ],
  [
    -0.0291748046875, 0.029296875, -0.0517578125, 0.089111328125, -0.16650390625, 0.465087890625,
    0.77978515625, -0.2003173828125, 0.1015625, -0.0582275390625, 0.0330810546875, -0.0189208984375,
  ],
  [
    -0.0189208984375, 0.0330810546875, -0.0582275390625, 0.1015625, -0.2003173828125, 0.77978515625,
    0.465087890625, -0.16650390625, 0.089111328125, -0.0517578125, 0.029296875, -0.0291748046875,
  ],
  [
    -0.00830078125, 0.014892578125, -0.0266113281250, 0.047607421875, -0.102294921875, 0.97216796875,
    0.1373291015625, -0.0594482421875, 0.033203125, -0.0196533203125, 0.010986328125, 0.001708984375,
  ],
];
export const TRUE_PEAK_TAPS = 12;

/** The filter flattened phase after phase, for the inner loops. */
const PHASE_TAPS = Float64Array.from(TRUE_PEAK_PHASES.flat());

/**
 * The true peak of one channel, sample by sample: `next(x)` takes the next
 * input sample and returns the largest magnitude of the four interpolated
 * values that sample completes (about six samples behind it, the filter's
 * delay). Shared by the meter and the limiter (`soundFix.ts`).
 */
export class TruePeakTracker {
  /** The last twelve samples, newest at `pos` (a ring written backwards twice, so a window is contiguous). */
  private readonly history = new Float64Array(TRUE_PEAK_TAPS * 2);
  private pos = 0;

  next(x: number): number {
    const history = this.history;
    this.pos = this.pos === 0 ? TRUE_PEAK_TAPS - 1 : this.pos - 1;
    const at = this.pos;
    history[at] = x;
    history[at + TRUE_PEAK_TAPS] = x;
    let peak = 0;
    for (let phase = 0; phase < 4; phase += 1) {
      const base = phase * TRUE_PEAK_TAPS;
      let y = 0;
      for (let j = 0; j < TRUE_PEAK_TAPS; j += 1) y += PHASE_TAPS[base + j]! * history[at + j]!;
      const magnitude = y < 0 ? -y : y;
      if (magnitude > peak) peak = magnitude;
    }
    return peak;
  }

  reset(): void {
    this.history.fill(0);
    this.pos = 0;
  }
}

export interface R128Result {
  /** Integrated loudness, LUFS; `-Infinity` when no block reaches the absolute gate (silence). */
  integratedLufs: number;
  /** Loudness range, LU (0 when there is too little sound to say). */
  lraLu: number;
  /** True peak over all channels, dBTP; `-Infinity` for digital silence. */
  truePeakDbtp: number;
  /** Plain sample peak, dBFS. */
  samplePeakDbfs: number;
  /** Seconds measured. */
  durationS: number;
  /**
   * The K-weighted mean square of every 100 ms, summed over the channels: the
   * material of every number above, kept for finding a quiet stretch to play
   * back (`loudestOrQuietestWindow`).
   */
  parts: Float64Array;
}

/** Mean square (channels summed) → LUFS. */
export function energyToLufs(energy: number): number {
  return energy > 0 ? -0.691 + 10 * Math.log10(energy) : Number.NEGATIVE_INFINITY;
}

function lufsToEnergy(lufs: number): number {
  return 10 ** ((lufs + 0.691) / 10);
}

/** BS.1770-4 gated integrated loudness of 400 ms blocks made from 100 ms parts. */
export function integratedFromParts(parts: ArrayLike<number>): number {
  const blocks: number[] = [];
  for (let j = 0; j + BLOCK_PARTS <= parts.length; j += 1) {
    let sum = 0;
    for (let k = 0; k < BLOCK_PARTS; k += 1) sum += parts[j + k] as number;
    blocks.push(sum / BLOCK_PARTS);
  }
  const absoluteEnergy = lufsToEnergy(ABSOLUTE_GATE_LUFS);
  const loud = blocks.filter((z) => z > absoluteEnergy);
  if (loud.length === 0) return Number.NEGATIVE_INFINITY;
  const meanLoud = loud.reduce((a, b) => a + b, 0) / loud.length;
  const relativeEnergy = lufsToEnergy(energyToLufs(meanLoud) + RELATIVE_GATE_LU);
  const gated = loud.filter((z) => z > relativeEnergy);
  if (gated.length === 0) return Number.NEGATIVE_INFINITY;
  return energyToLufs(gated.reduce((a, b) => a + b, 0) / gated.length);
}

/** The value at `share` (0..1) of a sorted list, by linear interpolation. */
function percentile(sorted: readonly number[], share: number): number {
  if (sorted.length === 0) return 0;
  const at = share * (sorted.length - 1);
  const low = Math.floor(at);
  const high = Math.min(sorted.length - 1, low + 1);
  return (sorted[low] as number) + ((sorted[high] as number) - (sorted[low] as number)) * (at - low);
}

/** EBU Tech 3342 loudness range from 100 ms parts: short-term (3 s) loudness, gated, 95th minus 10th percentile. */
export function rangeFromParts(parts: ArrayLike<number>): number {
  const shortTerm: number[] = [];
  let sum = 0;
  for (let j = 0; j < parts.length; j += 1) {
    sum += parts[j] as number;
    if (j >= SHORT_TERM_PARTS) sum -= parts[j - SHORT_TERM_PARTS] as number;
    if (j >= SHORT_TERM_PARTS - 1) shortTerm.push(Math.max(0, sum) / SHORT_TERM_PARTS);
  }
  const absoluteEnergy = lufsToEnergy(ABSOLUTE_GATE_LUFS);
  const loud = shortTerm.filter((z) => z > absoluteEnergy);
  if (loud.length < 2) return 0;
  const meanLoud = loud.reduce((a, b) => a + b, 0) / loud.length;
  const gate = energyToLufs(meanLoud) + LRA_RELATIVE_GATE_LU;
  const gated = loud.map(energyToLufs).filter((l) => l > gate).sort((a, b) => a - b);
  if (gated.length < 2) return 0;
  return Math.max(0, percentile(gated, 0.95) - percentile(gated, 0.1));
}

/** Streaming BS.1770-4 meter over planar PCM; every channel weighs 1 (left, right, or a mono one). */
export class R128Meter {
  private readonly partLength: number;
  private readonly filters: [BiquadCoefficients, BiquadCoefficients];
  /** Per channel: the two biquads' state (x1, x2, y1, y2 each). */
  private readonly state: Float64Array;
  private readonly peaks: TruePeakTracker[];
  private readonly parts: number[] = [];
  private partSum = 0;
  private partCount = 0;
  private truePeak = 0;
  private samplePeak = 0;
  private frames = 0;

  constructor(
    readonly sampleRate: number,
    readonly channelCount: number,
  ) {
    this.partLength = Math.max(1, Math.round(sampleRate * SUB_BLOCK_S));
    this.filters = kWeighting(sampleRate);
    this.state = new Float64Array(channelCount * 8);
    this.peaks = Array.from({ length: channelCount }, () => new TruePeakTracker());
  }

  push(channels: readonly Float32Array[], frames: number): void {
    const [shelf, pass] = this.filters;
    const count = this.channelCount;
    const state = this.state;
    for (let i = 0; i < frames; i += 1) {
      let energy = 0;
      for (let c = 0; c < count; c += 1) {
        const x = (channels[c] ?? channels[0])?.[i] ?? 0;
        const magnitude = x < 0 ? -x : x;
        if (magnitude > this.samplePeak) this.samplePeak = magnitude;
        const tp = this.peaks[c]!.next(x);
        if (tp > this.truePeak) this.truePeak = tp;
        const s = c * 8;
        // Stage 1: high shelf.
        const y1 = shelf.b0 * x + shelf.b1 * state[s]! + shelf.b2 * state[s + 1]! - shelf.a1 * state[s + 2]! - shelf.a2 * state[s + 3]!;
        state[s + 1] = state[s]!;
        state[s] = x;
        state[s + 3] = state[s + 2]!;
        state[s + 2] = y1;
        // Stage 2: high pass.
        const y2 = pass.b0 * y1 + pass.b1 * state[s + 4]! + pass.b2 * state[s + 5]! - pass.a1 * state[s + 6]! - pass.a2 * state[s + 7]!;
        state[s + 5] = state[s + 4]!;
        state[s + 4] = y1;
        state[s + 7] = state[s + 6]!;
        state[s + 6] = y2;
        energy += y2 * y2;
      }
      this.partSum += energy;
      this.partCount += 1;
      if (this.partCount === this.partLength) {
        this.parts.push(this.partSum / this.partLength);
        this.partSum = 0;
        this.partCount = 0;
      }
    }
    this.frames += frames;
  }

  result(): R128Result {
    // A last part shorter than 100 ms is left out, as a gating block must be whole.
    const parts = Float64Array.from(this.parts);
    return {
      integratedLufs: integratedFromParts(parts),
      lraLu: rangeFromParts(parts),
      truePeakDbtp: this.truePeak > 0 ? 20 * Math.log10(this.truePeak) : Number.NEGATIVE_INFINITY,
      samplePeakDbfs: this.samplePeak > 0 ? 20 * Math.log10(this.samplePeak) : Number.NEGATIVE_INFINITY,
      durationS: this.frames / this.sampleRate,
      parts,
    };
  }
}

/** The whole of a sound at once (tests, scripts). */
export function measureR128(channels: readonly Float32Array[], sampleRate: number): R128Result {
  const meter = new R128Meter(sampleRate, channels.length);
  meter.push(channels, channels[0]?.length ?? 0);
  return meter.result();
}
