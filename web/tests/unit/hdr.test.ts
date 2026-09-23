import { describe, expect, it } from 'vitest';

import {
  HLG_PEAK_NITS,
  PROBE_PATCHES,
  PROBE_PATCH_SIZE,
  bt2020ToBt709,
  bt2020ToYcbcr10,
  bt709ToBt2020,
  buildProbeFrame,
  hdrTransferOf,
  hlgInverseOetf,
  hlgOetf,
  hlgSceneFromDisplay,
  judgeHdrProbe,
  pqDecode,
  pqEncode,
  readProbePatches,
  SOFT_CLIP_KNEE,
  SOFT_CLIP_MAX,
  softClip,
  softClipToRgba8,
  srgb8ToLab,
  type HdrTransfer,
  type ProbeFrame,
} from '@/domain/hdr';

describe('transfer functions', () => {
  it('PQ matches ST 2084 reference points and round-trips', () => {
    expect(pqEncode(0)).toBeCloseTo(0, 5);
    expect(pqEncode(10000)).toBeCloseTo(1, 6);
    // Well-known code values: 100 cd/m² ≈ 0.508, 1000 cd/m² ≈ 0.752, 203 ≈ 0.581.
    expect(pqEncode(100)).toBeCloseTo(0.5081, 3);
    expect(pqEncode(1000)).toBeCloseTo(0.7518, 3);
    expect(pqEncode(203)).toBeCloseTo(0.5807, 3);
    for (const nits of [0.01, 1, 20, 203, 400, 1000, 4000]) {
      expect(pqDecode(pqEncode(nits))).toBeCloseTo(nits, 3);
    }
  });

  it('HLG OETF matches BT.2100 and round-trips', () => {
    expect(hlgOetf(0)).toBe(0);
    expect(hlgOetf(1 / 12)).toBeCloseTo(0.5, 6);
    expect(hlgOetf(1)).toBeCloseTo(1, 5);
    for (const e of [0.001, 0.05, 1 / 12, 0.26, 0.5, 1]) {
      expect(hlgInverseOetf(hlgOetf(e))).toBeCloseTo(e, 6);
    }
  });

  it('HLG inverse OOTF puts reference white (203 cd/m²) at the BT.2408 signal of 0.75', () => {
    const scene = hlgSceneFromDisplay([203, 203, 203]);
    expect(hlgOetf(scene[0])).toBeCloseTo(0.75, 2);
    // and the display peak at signal 1.0
    expect(hlgOetf(hlgSceneFromDisplay([HLG_PEAK_NITS, HLG_PEAK_NITS, HLG_PEAK_NITS])[0])).toBeCloseTo(1, 5);
  });

  it('bt709 <-> bt2020 matrices are inverse and keep white', () => {
    const white = bt709ToBt2020([1, 1, 1]);
    white.forEach((v) => expect(v).toBeCloseTo(1, 4));
    const back = bt2020ToBt709(bt709ToBt2020([0.2, 0.7, 0.1]));
    expect(back[0]).toBeCloseTo(0.2, 4);
    expect(back[1]).toBeCloseTo(0.7, 4);
    expect(back[2]).toBeCloseTo(0.1, 4);
  });

  it('10-bit limited-range Y\'CbCr puts black at 64 and white at 940 with neutral chroma', () => {
    expect(bt2020ToYcbcr10([0, 0, 0])).toEqual([64, 512, 512]);
    expect(bt2020ToYcbcr10([1, 1, 1])).toEqual([940, 512, 512]);
  });

  it('names the transfers the container and WebCodecs report', () => {
    expect(hdrTransferOf('smpte2084')).toBe('pq');
    expect(hdrTransferOf('pq')).toBe('pq');
    expect(hdrTransferOf('arib-std-b67')).toBe('hlg');
    expect(hdrTransferOf('hlg')).toBe('hlg');
    expect(hdrTransferOf('bt709')).toBeNull();
    expect(hdrTransferOf(null)).toBeNull();
  });

  it('CIELAB of sRGB white and black', () => {
    const white = srgb8ToLab(255, 255, 255);
    expect(white.L).toBeCloseTo(100, 1);
    expect(Math.hypot(white.a, white.b)).toBeLessThan(0.1);
    expect(srgb8ToLab(0, 0, 0).L).toBeCloseTo(0, 5);
  });
});

/* ---------------------------------------------------- simulated browsers */

type Rgb = [number, number, number];

/** Frame -> per-pixel bt2020 display light in cd/m², the way a decoder + EOTF would. */
function decodeFrame(frame: ProbeFrame, transfer: HdrTransfer, tweak?: (ycc: Rgb) => Rgb): Rgb[] {
  const { width, height, data } = frame;
  const cw = width / 2;
  const cbOffset = width * height;
  const crOffset = cbOffset + cw * (height / 2);
  const out: Rgb[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const c = Math.floor(y / 2) * cw + Math.floor(x / 2);
      let ycc: Rgb = [data[y * width + x] ?? 0, data[cbOffset + c] ?? 0, data[crOffset + c] ?? 0];
      if (tweak) ycc = tweak(ycc);
      const Y = (ycc[0] - 64) / 876;
      const cb = (ycc[1] - 512) / 896;
      const cr = (ycc[2] - 512) / 896;
      const r = Y + 1.4746 * cr;
      const b = Y + 1.8814 * cb;
      const g = (Y - 0.2627 * r - 0.0593 * b) / 0.678;
      out.push([r, g, b]);
    }
  }
  return out.map((signal) => {
    if (transfer === 'pq') return signal.map(pqDecode) as Rgb;
    const scene = signal.map((s) => hlgInverseOetf(s)) as Rgb;
    const ys = 0.2627 * scene[0] + 0.678 * scene[1] + 0.0593 * scene[2];
    const gain = HLG_PEAK_NITS * Math.max(ys, 0) ** 0.2;
    return scene.map((v) => v * gain) as Rgb;
  });
}

const srgbEncode = (v: number) => {
  const c = Math.min(Math.max(v, 0), 1);
  return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055));
};

function hable(x: number): number {
  const A = 0.15;
  const B = 0.5;
  const C = 0.1;
  const D = 0.2;
  const E = 0.02;
  const F = 0.3;
  return (x * (A * x + C * B) + D * E) / (x * (A * x + B) + D * F) - E / F;
}

/** Tone curves on linear light (cd/m²) -> 0..1, as the standard operators do. */
const OPERATORS: Record<string, (nits: number) => number> = {
  // ffmpeg `zscale=npl=100, tonemap=hable`, peak 1000 cd/m²
  hable: (n) => hable(n / 100) / hable(10),
  // extended Reinhard with reference white 203 cd/m² and peak 1000
  reinhard203: (n) => {
    const x = n / 203;
    const w = 1000 / 203;
    return (x * (1 + x / (w * w))) / (1 + x);
  },
  // ffmpeg mobius, npl 203
  mobius203: (n) => {
    const x = n / 203;
    const j = 0.3;
    const peak = 1000 / 203;
    if (x <= j) return x;
    const a = (-j * j * (peak - 1)) / (j * j - 2 * j + peak);
    const b = (j * j - 2 * j * peak + peak) / Math.max(peak - 1, 1e-6);
    return ((b * b + 2 * b * j + j * j) / (b - a)) * ((x + a) / (x + b));
  },
};

interface Pipeline {
  transfer: HdrTransfer;
  operator?: (nits: number) => number;
  skipGamut?: boolean;
  /** Per-channel curve on the final sRGB-linear value instead of the operator. */
  raw?: 'no-tonemap' | 'linear-light';
  tweak?: (ycc: Rgb) => Rgb;
  /** Tone-map max(R,G,B) and scale the pixel, keeping hue (like BT.2390 / Chrome-style). */
  maxRgb?: boolean;
  /** Tone-map the pixel's luminance and scale all channels by it (clips bright saturated colours). */
  lumaScale?: boolean;
  /** Tone-map max(R,G,B) in bt2020 first, convert the gamut afterwards and clip. */
  toneBeforeGamut?: boolean;
  /** Keep the overshoot (float16 canvas) and run the app's soft clip on it. */
  softClipped?: boolean;
}

function simulate(p: Pipeline): Uint8ClampedArray {
  const frame = buildProbeFrame(p.transfer);
  const pixels = decodeFrame(frame, p.transfer, p.tweak);
  const rgba = new Uint8ClampedArray(frame.width * frame.height * 4);
  const op = p.operator ?? OPERATORS.hable!;
  pixels.forEach((nits2020, i) => {
    let out: Rgb;
    if (p.raw === 'no-tonemap') {
      // The Y'CbCr decoded with the right matrix and shown as if it were SDR.
      const width = frame.width;
      const x = i % width;
      const y = Math.floor(i / width);
      const cw = width / 2;
      const c = Math.floor(y / 2) * cw + Math.floor(x / 2);
      const cbOffset = width * frame.height;
      const crOffset = cbOffset + cw * (frame.height / 2);
      const Y = ((frame.data[i] ?? 0) - 64) / 876;
      const cb = ((frame.data[cbOffset + c] ?? 0) - 512) / 896;
      const cr = ((frame.data[crOffset + c] ?? 0) - 512) / 896;
      const r = Y + 1.4746 * cr;
      const b = Y + 1.8814 * cb;
      const g = (Y - 0.2627 * r - 0.0593 * b) / 0.678;
      const code = (v: number) => Math.round(255 * Math.min(Math.max(v, 0), 1));
      rgba.set([code(r), code(g), code(b), 255], i * 4);
      return;
    }
    if (p.toneBeforeGamut) {
      const m = Math.max(...nits2020, 1e-9);
      const scale = op(m) / m;
      out = bt2020ToBt709(nits2020.map((v) => Math.max(v, 0) * scale) as Rgb);
      if (p.softClipped) {
        const extended = out.map((v) => (v <= 0 ? 0 : 1.055 * v ** (1 / 2.4) - 0.055));
        const px = new Uint8ClampedArray(4);
        softClipToRgba8([...extended, 1], px);
        rgba.set(px, i * 4);
      } else {
        rgba.set([...out.map(srgbEncode), 255], i * 4);
      }
      return;
    }
    const linear709 = p.skipGamut ? nits2020 : bt2020ToBt709(nits2020);
    if (p.lumaScale) {
      const y = 0.2126 * linear709[0] + 0.7152 * linear709[1] + 0.0722 * linear709[2];
      const scale = y > 0 ? op(y) / y : 0;
      out = linear709.map((v) => Math.max(v, 0) * scale) as Rgb;
    } else if (p.maxRgb) {
      const m = Math.max(...linear709, 1e-9);
      const scale = op(m) / m;
      out = linear709.map((v) => Math.max(v, 0) * scale) as Rgb;
    } else {
      out = linear709.map((v) => op(Math.max(v, 0))) as Rgb;
    }
    if (p.raw === 'linear-light') {
      rgba.set([...out.map((v) => Math.round(255 * Math.min(Math.max(v, 0), 1))), 255], i * 4);
    } else {
      rgba.set([...out.map(srgbEncode), 255], i * 4);
    }
  });
  return rgba;
}

function verdictOf(p: Pipeline) {
  const frame = buildProbeFrame(p.transfer);
  return judgeHdrProbe(readProbePatches(simulate(p), frame.width));
}

describe('probe frame', () => {
  it('is one row of 16 px patches in I420P10 with neutral chroma on the greys', () => {
    const frame = buildProbeFrame('pq');
    expect(frame.width).toBe(PROBE_PATCH_SIZE * PROBE_PATCHES.length);
    expect(frame.height).toBe(PROBE_PATCH_SIZE);
    expect(frame.data.length).toBe(frame.width * frame.height * 1.5);
    const cbOffset = frame.width * frame.height;
    // black patch: Y 64, Cb 512
    expect(frame.data[0]).toBe(64);
    expect(frame.data[cbOffset]).toBe(512);
    // every sample is a legal 10-bit code
    expect(Math.max(...frame.data)).toBeLessThanOrEqual(1019);
  });
});

describe('judgeHdrProbe', () => {
  for (const transfer of ['pq', 'hlg'] as const) {
    describe(transfer, () => {
      it.each(Object.keys(OPERATORS))('accepts a correct conversion with the %s operator', (name) => {
        const verdict = verdictOf({ transfer, operator: OPERATORS[name] });
        expect(verdict.failures).toEqual([]);
      });

      it('accepts a hue-preserving (max RGB) operator', () => {
        expect(verdictOf({ transfer, operator: OPERATORS.reinhard203, maxRgb: true }).failures).toEqual([]);
      });

      it('rejects a luminance-scaled curve that clips bright saturated colours', () => {
        const verdict = verdictOf({ transfer, operator: OPERATORS.reinhard203, lumaScale: true });
        expect(verdict.failures).toContain('bright_colour_clipped');
      });

      it('rejects tone mapping in bt2020 followed by a clipping gamut conversion', () => {
        const verdict = verdictOf({ transfer, operator: OPERATORS.reinhard203, toneBeforeGamut: true });
        expect(verdict.failures).toContain('bright_colour_clipped');
      });

      it('accepts the same conversion once the overshoot is soft clipped (the export path)', () => {
        const verdict = verdictOf({ transfer, operator: OPERATORS.reinhard203, toneBeforeGamut: true, softClipped: true });
        expect(verdict.failures).toEqual([]);
      });

      it('rejects no tone mapping (signal shown as SDR)', () => {
        expect(verdictOf({ transfer, raw: 'no-tonemap' }).pass).toBe(false);
      });

      it('rejects a missing bt2020 -> bt709 conversion', () => {
        const verdict = verdictOf({ transfer, operator: OPERATORS.reinhard203, skipGamut: true });
        expect(verdict.pass).toBe(false);
        expect(verdict.failures.some((f) => f.startsWith('hue:') || f.startsWith('saturation:'))).toBe(true);
      });

      it('rejects highlights hard-clipped at reference white', () => {
        const verdict = verdictOf({ transfer, operator: (n) => Math.min(1, n / 203) });
        expect(verdict.failures).toContain('highlights_clipped');
      });

      it('rejects linear light written without a transfer (too dark)', () => {
        expect(verdictOf({ transfer, operator: OPERATORS.hable, raw: 'linear-light' }).pass).toBe(false);
      });

      it('rejects a green cast of 4 8-bit code values', () => {
        const verdict = verdictOf({ transfer, tweak: ([y, cb, cr]) => [y, cb - 16, cr - 16] });
        expect(verdict.failures.some((f) => f.startsWith('cast:'))).toBe(true);
      });

      it('rejects a purple cast', () => {
        const verdict = verdictOf({ transfer, tweak: ([y, cb, cr]) => [y, cb + 16, cr + 16] });
        expect(verdict.failures.some((f) => f.startsWith('cast:'))).toBe(true);
      });

      it('rejects swapped chroma planes', () => {
        const verdict = verdictOf({ transfer, tweak: ([y, cb, cr]) => [y, cr, cb] });
        expect(verdict.pass).toBe(false);
      });
    });
  }

  it('rejects a missing readback (all patches black)', () => {
    const frame = buildProbeFrame('pq');
    const verdict = judgeHdrProbe(readProbePatches(new Uint8ClampedArray(frame.width * frame.height * 4), frame.width));
    expect(verdict.pass).toBe(false);
  });
});

describe('highlight soft clip (float16 canvas -> 8-bit)', () => {
  it('is the identity up to the knee, continuous, monotonic, and reaches 1.0 only at the maximum', () => {
    expect(softClip(0.5)).toBe(0.5);
    expect(softClip(SOFT_CLIP_KNEE)).toBe(SOFT_CLIP_KNEE);
    expect(softClip(SOFT_CLIP_KNEE + 1e-6)).toBeCloseTo(SOFT_CLIP_KNEE + 1e-6, 6);
    let previous = 0;
    for (let m = 0.85; m < SOFT_CLIP_MAX; m += 0.01) {
      const v = softClip(m);
      expect(v).toBeGreaterThanOrEqual(previous);
      expect(v).toBeLessThan(1);
      previous = v;
    }
    expect(softClip(SOFT_CLIP_MAX)).toBe(1);
    expect(softClip(5)).toBe(1);
  });

  it('leaves pixels under the knee exactly as the browser converted them', () => {
    const source = [0.5, 0.25, 0.75, 1, 0, 0.1, 0.9, 1];
    const target = new Uint8ClampedArray(8);
    softClipToRgba8(source, target);
    expect([...target]).toEqual([128, 64, 191, 255, 0, 26, 230, 255]);
  });

  it('rolls an overshooting channel off below full scale and keeps the channel ratios', () => {
    // Encoded 1.12 on red is ~1.29 linear: cut at 255 by an 8-bit canvas.
    const target = new Uint8ClampedArray(4);
    softClipToRgba8([1.12, 0.6, 0.35, 1], target);
    expect(target[0]).toBeLessThan(254);
    expect(target[0]).toBeGreaterThan(240);
    const lin = (v: number) => ((v / 255 + 0.055) / 1.055) ** 2.4;
    const inLin = (v: number) => ((v + 0.055) / 1.055) ** 2.4;
    expect(lin(target[1]!) / lin(target[0]!)).toBeCloseTo(inLin(0.6) / inLin(1.12), 1);
  });

  it('clamps out-of-gamut negatives to zero', () => {
    const target = new Uint8ClampedArray(4);
    softClipToRgba8([-0.05, 0.4, 0.01, 1], target);
    expect(target[0]).toBe(0);
  });
});
