/**
 * The stretch of a decoded sound stream that is still needed (ADR-036):
 * samples are appended as they are decoded and dropped once every speech
 * span that could use them has been recognised. A second attempt at a span
 * can then be cut from the same sound without decoding the file again, and
 * the whole sound is still never in memory (a span is at most 30 s).
 *
 * Indices are positions in the whole 16 kHz stream.
 */
export class SlidingAudio {
  private buffer = new Float32Array(1 << 16);
  /** Stream index of `buffer[0]`. */
  private base = 0;
  private length = 0;
  /** Nothing before this is kept, even if it is appended later. */
  private floor = 0;

  /** Stream index one past the newest sample held. */
  get end(): number {
    return this.base + this.length;
  }

  get start(): number {
    return this.base;
  }

  /** Appends `samples`, whose first sample is stream index `first` (consecutive calls are consecutive sound). */
  append(samples: Float32Array, first: number): void {
    if (first + samples.length <= this.floor) {
      // Entirely before anything still needed: only the position moves on.
      if (this.length === 0) this.base = first + samples.length;
      return;
    }
    if (this.length === 0) this.base = Math.max(first, this.floor);
    const from = Math.max(0, this.end - first);
    const count = samples.length - from;
    if (count <= 0) return;
    if (this.length + count > this.buffer.length) {
      const grown = new Float32Array(Math.max(this.buffer.length * 2, this.length + count));
      grown.set(this.buffer.subarray(0, this.length));
      this.buffer = grown;
    }
    this.buffer.set(samples.subarray(from), this.length);
    this.length += count;
  }

  /** Forgets everything before stream index `index`. */
  dropBefore(index: number): void {
    this.floor = Math.max(this.floor, index);
    const drop = Math.min(this.length, Math.max(0, this.floor - this.base));
    if (drop > 0) {
      this.buffer.copyWithin(0, drop, this.length);
      this.length -= drop;
      this.base += drop;
    }
  }

  /** A copy of [from, to), as far as it is held. */
  slice(from: number, to: number): Float32Array {
    const a = Math.max(from, this.base);
    const b = Math.min(to, this.end);
    if (b <= a) return new Float32Array(0);
    return this.buffer.slice(a - this.base, b - this.base);
  }
}
