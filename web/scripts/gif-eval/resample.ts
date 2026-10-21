/**
 * GIF quality, round 2 (ADR-046 addendum 2): the downscaling and sharpening
 * candidates that are plain arithmetic on RGBA pixels. Used by the capture
 * page in the browser (so their time is the browser's) and by the Node side
 * of the evaluation (sharpening is applied there too, with this same code).
 * Never imported by the app.
 */

/** One output sample: which input samples it covers, and how much of each. */
interface Taps {
  start: Int32Array;
  count: Int32Array;
  weights: Float32Array;
  stride: number;
}

/** Exact box (area) weights from `from` input samples onto `to` output samples (to ≤ from). */
function areaTaps(from: number, to: number): Taps {
  const scale = from / to;
  const stride = Math.ceil(scale) + 2;
  const start = new Int32Array(to);
  const count = new Int32Array(to);
  const weights = new Float32Array(to * stride);
  for (let o = 0; o < to; o += 1) {
    const a = o * scale;
    const b = a + scale;
    const first = Math.floor(a);
    const last = Math.min(from - 1, Math.ceil(b) - 1);
    start[o] = first;
    count[o] = last - first + 1;
    for (let i = first; i <= last; i += 1) {
      const w = Math.min(b, i + 1) - Math.max(a, i);
      weights[o * stride + (i - first)] = w / scale;
    }
  }
  return { start, count, weights, stride };
}

/**
 * Area-average downscale (every input pixel counts for the share of the output pixel it covers),
 * RGBA in, RGBA out (alpha set to 255). Averages the stored (sRGB) values, as ffmpeg's `area` does.
 */
export function areaDownscale(src: Uint8ClampedArray | Uint8Array, sw: number, sh: number, dw: number, dh: number): Uint8ClampedArray {
  const xt = areaTaps(sw, dw);
  const yt = areaTaps(sh, dh);
  // Horizontal pass: sh rows × dw columns × 3 channels.
  const mid = new Float32Array(sh * dw * 3);
  for (let y = 0; y < sh; y += 1) {
    const row = y * sw * 4;
    for (let x = 0; x < dw; x += 1) {
      const s = xt.start[x]!;
      const n = xt.count[x]!;
      const wBase = x * xt.stride;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let k = 0; k < n; k += 1) {
        const w = xt.weights[wBase + k]!;
        const o = row + (s + k) * 4;
        r += src[o]! * w;
        g += src[o + 1]! * w;
        b += src[o + 2]! * w;
      }
      const m = (y * dw + x) * 3;
      mid[m] = r;
      mid[m + 1] = g;
      mid[m + 2] = b;
    }
  }
  const out = new Uint8ClampedArray(dw * dh * 4);
  for (let y = 0; y < dh; y += 1) {
    const s = yt.start[y]!;
    const n = yt.count[y]!;
    const wBase = y * yt.stride;
    for (let x = 0; x < dw; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let k = 0; k < n; k += 1) {
        const w = yt.weights[wBase + k]!;
        const m = ((s + k) * dw + x) * 3;
        r += mid[m]! * w;
        g += mid[m + 1]! * w;
        b += mid[m + 2]! * w;
      }
      const o = (y * dw + x) * 4;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = 255;
    }
  }
  return out;
}

/**
 * Unsharp mask with a 3 × 3 binomial blur ([1 2 1] ⊗ [1 2 1] / 16): out = in + amount × (in − blur),
 * per channel, edges clamped. Returns a new buffer.
 */
export function sharpen(src: Uint8ClampedArray | Uint8Array, w: number, h: number, amount: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src.length);
  const tmp = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const l = (y * w + Math.max(0, x - 1)) * 4;
      const c = (y * w + x) * 4;
      const r = (y * w + Math.min(w - 1, x + 1)) * 4;
      const t = (y * w + x) * 3;
      tmp[t] = src[l]! + 2 * src[c]! + src[r]!;
      tmp[t + 1] = src[l + 1]! + 2 * src[c + 1]! + src[r + 1]!;
      tmp[t + 2] = src[l + 2]! + 2 * src[c + 2]! + src[r + 2]!;
    }
  }
  for (let y = 0; y < h; y += 1) {
    const up = Math.max(0, y - 1) * w;
    const dn = Math.min(h - 1, y + 1) * w;
    for (let x = 0; x < w; x += 1) {
      const c = (y * w + x) * 4;
      for (let ch = 0; ch < 3; ch += 1) {
        const blur = (tmp[(up + x) * 3 + ch]! + 2 * tmp[(y * w + x) * 3 + ch]! + tmp[(dn + x) * 3 + ch]!) / 16;
        const v = src[c + ch]!;
        out[c + ch] = v + amount * (v - blur);
      }
      out[c + 3] = 255;
    }
  }
  return out;
}
