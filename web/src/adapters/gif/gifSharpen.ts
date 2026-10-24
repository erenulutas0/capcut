/**
 * "GIF yap": the light sharpening every GIF frame gets (ADR-046 addendum 3,
 * 24 Oct 2026), after the browser's own downscale to the GIF's size
 * (`VideoSample.draw`, `imageSmoothingQuality: 'high'`) and before the
 * palette's sample and the encoder see the frame — the candidate `high+s0.25`
 * of ADR-046 addendum 2, the same arithmetic as the evaluation's `sharpen`
 * (`scripts/gif-eval/resample.ts`; unit test: byte for byte).
 *
 * Unsharp mask with a 3 × 3 binomial blur ([1 2 1] ⊗ [1 2 1] / 16):
 * out = in + amount × (in − blur), per colour channel, edges clamped (the
 * pixel beyond the edge is the edge pixel), rounded as a `Uint8ClampedArray`
 * rounds (to nearest, halves to even) and clamped to 0–255. Alpha is set to
 * 255 (the GIF canvas has none) and never read.
 *
 * In place, so the frame `getImageData` handed out is the frame kept: the
 * blur of each row is made from three rows' horizontal sums of the ORIGINAL
 * pixels, kept in a ring of three rows — row y + 1's sums are taken before
 * row y is written. With n = 16 × blur (an integer, 0–4080) the result is
 * (amount / 16) × (M × in − n), M = 16 × (1 + amount) / amount (80 for 0,25):
 * one integer key, looked up in a table made once with the very same
 * arithmetic (measured in a Chromium worker on this desktop: 5,9 ms for a
 * 960 × 540 frame, against 9,6 ms computing it per pixel). No browser API is
 * used here (unit tests run it in Node).
 */

/** How strong: 0,25 — `high+s0.25` (ADR-046 addendum 2: +6–8 VMAF on the phone's screen, bytes ×1,03–1,04). */
export const GIF_SHARPEN_AMOUNT = 0.25;

/** 16 × the largest blur: 16 × 255. */
const MAX_BLUR16 = 4080;

/** Sharpens frames of one size, in place, reusing its three rows of sums and its table. */
export class GifSharpener {
  private readonly sums: Uint16Array;
  private readonly table: Uint8ClampedArray;
  private readonly factor: number;

  constructor(
    readonly width: number,
    readonly height: number,
    readonly amount: number = GIF_SHARPEN_AMOUNT,
  ) {
    if (!(width > 0) || !(height > 0)) throw new RangeError('empty frame');
    const factor = (16 * (1 + amount)) / amount;
    // The one-key table needs a whole M (0,25 → 80, 0,5 → 48, 1 → 32).
    if (!(amount > 0) || !Number.isInteger(factor)) throw new RangeError('amount');
    this.factor = factor;
    // Three rows × width × three channels; one sum is at most 4 × 255.
    this.sums = new Uint16Array(3 * width * 3);
    // key = M × in − n + 4080 ∈ [0, 255 M + 4080]; the store rounds and clamps as the evaluation's did.
    const table = new Uint8ClampedArray(255 * factor + MAX_BLUR16 + 1);
    for (let key = 0; key < table.length; key += 1) table[key] = (amount / 16) * (key - MAX_BLUR16);
    this.table = table;
  }

  /** Sharpens one RGBA frame of this size in place. */
  apply(rgba: Uint8ClampedArray): void {
    const { width, height, sums, table, factor } = this;
    if (rgba.length !== width * height * 4) throw new RangeError('frame size');
    const rowSums = width * 3;
    // Horizontal [1 2 1] of row `y` (original pixels) into ring slot `y % 3`.
    const sumRow = (y: number) => {
      const base = y * width * 4;
      const last = base + (width - 1) * 4;
      let o = (y % 3) * rowSums;
      let lr = rgba[base]!;
      let lg = rgba[base + 1]!;
      let lb = rgba[base + 2]!;
      let cr = lr;
      let cg = lg;
      let cb = lb;
      for (let c = base; c <= last; c += 4) {
        const n = c < last ? c + 4 : c;
        const nr = rgba[n]!;
        const ng = rgba[n + 1]!;
        const nb = rgba[n + 2]!;
        sums[o] = lr + 2 * cr + nr;
        sums[o + 1] = lg + 2 * cg + ng;
        sums[o + 2] = lb + 2 * cb + nb;
        o += 3;
        lr = cr;
        lg = cg;
        lb = cb;
        cr = nr;
        cg = ng;
        cb = nb;
      }
    };
    sumRow(0);
    if (height > 1) sumRow(1);
    for (let y = 0; y < height; y += 1) {
      // Row y + 1 is still untouched: its sums go where row y − 2's were (no longer needed).
      if (y >= 1 && y + 1 < height) sumRow(y + 1);
      let up = ((y > 0 ? y - 1 : 0) % 3) * rowSums;
      let mid = (y % 3) * rowSums;
      let down = ((y < height - 1 ? y + 1 : y) % 3) * rowSums;
      const end = (y + 1) * width * 4;
      for (let p = y * width * 4; p < end; p += 4) {
        rgba[p] = table[rgba[p]! * factor + MAX_BLUR16 - (sums[up]! + 2 * sums[mid]! + sums[down]!)]!;
        rgba[p + 1] = table[rgba[p + 1]! * factor + MAX_BLUR16 - (sums[up + 1]! + 2 * sums[mid + 1]! + sums[down + 1]!)]!;
        rgba[p + 2] = table[rgba[p + 2]! * factor + MAX_BLUR16 - (sums[up + 2]! + 2 * sums[mid + 2]! + sums[down + 2]!)]!;
        rgba[p + 3] = 255;
        up += 3;
        mid += 3;
        down += 3;
      }
    }
  }
}
