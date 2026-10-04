/**
 * Any sample rate → 16 kHz mono, piece by piece (ADR-036).
 *
 * The speech detector and the recogniser both want 16 kHz mono; a video's
 * sound is usually 44.1 or 48 kHz stereo. This is a windowed-sinc low-pass
 * (Kaiser window, ~80 dB) evaluated at the exact output instants, with one
 * set of taps per phase of the rate ratio — the ordinary polyphase resampler.
 * It keeps only a filter's length of history, so memory does not grow with
 * the file, and feeding the same sound in different chunk sizes gives the
 * same samples (unit tested).
 */

function gcd(a: number, b: number): number {
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}

/** Zeroth-order modified Bessel function, for the Kaiser window. */
function bessel0(x: number): number {
  let sum = 1;
  let term = 1;
  const half = x / 2;
  for (let k = 1; k < 40; k += 1) {
    term *= (half / k) * (half / k);
    sum += term;
    if (term < sum * 1e-12) break;
  }
  return sum;
}

const KAISER_BETA = 8;
/** Zero crossings of the low-pass kept on each side. */
const ZERO_CROSSINGS = 16;
/** The pass band ends this far below the lower Nyquist frequency. */
const ROLLOFF = 0.92;
/** More phases than this are rounded to the nearest of them (odd rates only; < −60 dB error). */
const MAX_PHASES = 1024;

/** Averages the channels of one decoded chunk into `out` (planar float input). */
export function downmixToMono(channels: readonly Float32Array[], frames: number, out: Float32Array): void {
  const count = channels.length;
  if (count === 0) {
    out.fill(0, 0, frames);
    return;
  }
  if (count === 1) {
    out.set((channels[0] as Float32Array).subarray(0, frames));
    return;
  }
  for (let i = 0; i < frames; i += 1) {
    let sum = 0;
    for (let c = 0; c < count; c += 1) sum += (channels[c] as Float32Array)[i] as number;
    out[i] = sum / count;
  }
}

export class MonoResampler {
  readonly inRate: number;
  readonly outRate: number;
  /** Input samples per output sample = step / phases. */
  private readonly step: number;
  private readonly phases: number;
  private readonly half: number;
  private readonly taps: Float32Array[];
  /** Unconsumed input, starting at absolute input index `bufStart`. */
  private buf: Float32Array;
  private bufLen = 0;
  private bufStart: number;
  private inCount = 0;
  private outCount = 0;
  private finished = false;

  constructor(inRate: number, outRate = 16_000) {
    if (!(inRate > 0) || !(outRate > 0) || !Number.isFinite(inRate) || !Number.isFinite(outRate)) {
      throw new Error('resample: rates must be positive');
    }
    this.inRate = Math.round(inRate);
    this.outRate = Math.round(outRate);
    const divisor = gcd(this.inRate, this.outRate);
    let step = this.inRate / divisor;
    let phases = this.outRate / divisor;
    if (phases > MAX_PHASES) {
      step = Math.round((step * MAX_PHASES) / phases);
      phases = MAX_PHASES;
    }
    this.step = step;
    this.phases = phases;
    // Cut-off in cycles per input sample: under the lower of the two Nyquist frequencies.
    const cutoff = 0.5 * ROLLOFF * Math.min(1, this.outRate / this.inRate);
    this.half = Math.ceil(ZERO_CROSSINGS / (2 * cutoff));
    const width = this.half + 1;
    const norm = bessel0(KAISER_BETA);
    this.taps = [];
    for (let phase = 0; phase < phases; phase += 1) {
      const frac = phase / phases;
      const row = new Float32Array(2 * this.half + 1);
      let sum = 0;
      for (let j = -this.half; j <= this.half; j += 1) {
        const t = j - frac;
        const x = 2 * cutoff * t;
        const sinc = Math.abs(x) < 1e-9 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
        const r = t / width;
        const window = Math.abs(r) >= 1 ? 0 : bessel0(KAISER_BETA * Math.sqrt(1 - r * r)) / norm;
        const value = 2 * cutoff * sinc * window;
        row[j + this.half] = value;
        sum += value;
      }
      // Unit gain at DC for every phase: a steady level stays that level.
      for (let k = 0; k < row.length; k += 1) row[k] = (row[k] as number) / sum;
      this.taps.push(row);
    }
    // Before the first sample there is silence.
    this.buf = new Float32Array(Math.max(4096, 4 * this.half));
    this.bufLen = this.half;
    this.bufStart = -this.half;
  }

  /** How many output samples a sound of `inputSamples` becomes. */
  static outputLength(inputSamples: number, inRate: number, outRate = 16_000): number {
    return Math.round((inputSamples * outRate) / inRate);
  }

  private append(input: Float32Array): void {
    const need = this.bufLen + input.length;
    if (need > this.buf.length) {
      const grown = new Float32Array(Math.max(need, this.buf.length * 2));
      grown.set(this.buf.subarray(0, this.bufLen));
      this.buf = grown;
    }
    this.buf.set(input, this.bufLen);
    this.bufLen += input.length;
  }

  /** Emits every output sample whose filter window is fully inside the input seen so far. */
  private drain(limit: number): Float32Array {
    const available = this.bufStart + this.bufLen;
    // Output n sits at input position n * step / phases; it needs inputs up to floor(pos) + half.
    const out: number[] = [];
    while (this.outCount < limit) {
      const numerator = this.outCount * this.step;
      const centre = Math.floor(numerator / this.phases);
      if (centre + this.half >= available) break;
      const row = this.taps[numerator % this.phases] as Float32Array;
      const from = centre - this.half - this.bufStart;
      let acc = 0;
      for (let k = 0; k < row.length; k += 1) acc += (this.buf[from + k] as number) * (row[k] as number);
      out.push(acc);
      this.outCount += 1;
    }
    // Drop input no later output can need.
    const keepFrom = Math.floor((this.outCount * this.step) / this.phases) - this.half;
    const drop = Math.min(this.bufLen, Math.max(0, keepFrom - this.bufStart));
    if (drop > 0) {
      this.buf.copyWithin(0, drop, this.bufLen);
      this.bufLen -= drop;
      this.bufStart += drop;
    }
    return Float32Array.from(out);
  }

  push(input: Float32Array): Float32Array {
    if (this.finished) throw new Error('resample: push after flush');
    this.inCount += input.length;
    this.append(input);
    return this.drain(Number.POSITIVE_INFINITY);
  }

  /** The tail: silence follows the last sample. Total output = round(input × outRate / inRate). */
  flush(): Float32Array {
    if (this.finished) return new Float32Array(0);
    this.finished = true;
    this.append(new Float32Array(2 * this.half + this.step));
    return this.drain(MonoResampler.outputLength(this.inCount, this.inRate, this.outRate));
  }
}
