/**
 * HDR -> SDR: the colour math behind the runtime check (ADR-022).
 *
 * The export does not tone map pixels itself. It draws each decoded frame
 * into an sRGB canvas, and the browser converts it. Whether that conversion
 * is a real tone mapping (PQ/HLG decoded, bt2020 primaries converted to bt709,
 * highlights rolled off) differs per browser and version, so it is never
 * assumed: the worker draws a small synthetic HDR frame through the very same
 * call and `judgeHdrProbe` decides from the pixels that come back.
 *
 * Everything here is pure: the frame is built from ITU-R BT.2100 / BT.2020
 * formulas, and the verdict is computed in CIE L*a*b* from 8-bit sRGB.
 */

export type HdrTransfer = 'pq' | 'hlg';

/** Container transfer names mediabunny / WebCodecs report for PQ and HLG. */
export function hdrTransferOf(transfer: string | null | undefined): HdrTransfer | null {
  if (transfer === 'pq' || transfer === 'smpte2084') return 'pq';
  if (transfer === 'hlg' || transfer === 'arib-std-b67') return 'hlg';
  return null;
}

/* ------------------------------------------------------------ transfers */

const PQ_M1 = 2610 / 16384;
const PQ_M2 = (2523 / 4096) * 128;
const PQ_C1 = 3424 / 4096;
const PQ_C2 = (2413 / 4096) * 32;
const PQ_C3 = (2392 / 4096) * 32;

/** SMPTE ST 2084 inverse EOTF: display light in cd/m² -> signal 0..1. */
export function pqEncode(nits: number): number {
  const y = Math.min(Math.max(nits / 10000, 0), 1);
  const p = y ** PQ_M1;
  return ((PQ_C1 + PQ_C2 * p) / (1 + PQ_C3 * p)) ** PQ_M2;
}

/** SMPTE ST 2084 EOTF: signal 0..1 -> display light in cd/m². */
export function pqDecode(signal: number): number {
  const e = Math.min(Math.max(signal, 0), 1) ** (1 / PQ_M2);
  return 10000 * (Math.max(e - PQ_C1, 0) / (PQ_C2 - PQ_C3 * e)) ** (1 / PQ_M1);
}

const HLG_A = 0.17883277;
const HLG_B = 1 - 4 * HLG_A;
const HLG_C = 0.5 - HLG_A * Math.log(4 * HLG_A);

/** BT.2100 HLG OETF: normalised scene light 0..1 -> signal 0..1. */
export function hlgOetf(scene: number): number {
  const e = Math.max(scene, 0);
  return e <= 1 / 12 ? Math.sqrt(3 * e) : HLG_A * Math.log(12 * e - HLG_B) + HLG_C;
}

/** BT.2100 HLG inverse OETF: signal 0..1 -> normalised scene light 0..1. */
export function hlgInverseOetf(signal: number): number {
  const e = Math.max(signal, 0);
  return e <= 0.5 ? (e * e) / 3 : (Math.exp((e - HLG_C) / HLG_A) + HLG_B) / 12;
}

/** Nominal peak of the HLG reference display (BT.2100 note 5f). */
export const HLG_PEAK_NITS = 1000;
/** System gamma for a 1000 cd/m² display. */
const HLG_GAMMA = 1.2;

/**
 * Display light (cd/m², bt2020 linear RGB) on the reference 1000 cd/m² HLG
 * display -> the scene light that produces it (inverse OOTF).
 */
export function hlgSceneFromDisplay(rgbNits: readonly [number, number, number]): [number, number, number] {
  const [r, g, b] = rgbNits.map((v) => Math.max(v, 0) / HLG_PEAK_NITS) as [number, number, number];
  const yd = 0.2627 * r + 0.678 * g + 0.0593 * b;
  if (yd <= 0) return [0, 0, 0];
  const ys = yd ** (1 / HLG_GAMMA);
  const scale = 1 / ys ** (HLG_GAMMA - 1);
  return [r * scale, g * scale, b * scale];
}

/* -------------------------------------------------------------- matrices */

/** Linear bt709 RGB -> linear bt2020 RGB (ITU-R BT.2087). */
export function bt709ToBt2020(rgb: readonly [number, number, number]): [number, number, number] {
  const [r, g, b] = rgb;
  return [
    0.627404 * r + 0.329283 * g + 0.043313 * b,
    0.069097 * r + 0.919541 * g + 0.011362 * b,
    0.016391 * r + 0.088013 * g + 0.895595 * b,
  ];
}

/** Linear bt2020 RGB -> linear bt709 RGB (inverse of the above). */
export function bt2020ToBt709(rgb: readonly [number, number, number]): [number, number, number] {
  const [r, g, b] = rgb;
  return [
    1.660491 * r - 0.587641 * g - 0.07285 * b,
    -0.124551 * r + 1.1329 * g - 0.008349 * b,
    -0.018151 * r - 0.100579 * g + 1.11873 * b,
  ];
}

/** Non-linear bt2020 R'G'B' (0..1) -> 10-bit limited-range Y'CbCr, non-constant luminance. */
export function bt2020ToYcbcr10(rgb: readonly [number, number, number]): [number, number, number] {
  const [r, g, b] = rgb;
  const y = 0.2627 * r + 0.678 * g + 0.0593 * b;
  const cb = (b - y) / 1.8814;
  const cr = (r - y) / 1.4746;
  const q = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)));
  return [q(64 + 876 * y, 4, 1019), q(512 + 896 * cb, 4, 1019), q(512 + 896 * cr, 4, 1019)];
}

/* --------------------------------------------------------------- CIELAB */

function srgbDecode(code: number): number {
  const v = code / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function labF(t: number): number {
  return t > 216 / 24389 ? Math.cbrt(t) : (t * 24389) / 27 / 116 + 16 / 116;
}

export interface Lab {
  L: number;
  a: number;
  b: number;
}

/** 8-bit sRGB -> CIE L*a*b* (D65). */
export function srgb8ToLab(r: number, g: number, b: number): Lab {
  return linearToLab(srgbDecode(r), srgbDecode(g), srgbDecode(b));
}

/** Linear bt709/sRGB light (1 = SDR white) -> CIE L*a*b* (D65). */
export function linearToLab(R: number, G: number, B: number): Lab {
  const X = (0.4123908 * R + 0.3575843 * G + 0.1804808 * B) / 0.95047;
  const Y = 0.212639 * R + 0.7151687 * G + 0.0721923 * B;
  const Z = (0.0193308 * R + 0.1191948 * G + 0.9505322 * B) / 1.08883;
  const fx = labF(X);
  const fy = labF(Y);
  const fz = labF(Z);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

export function chroma(lab: Lab): number {
  return Math.hypot(lab.a, lab.b);
}

/** Hue angle in degrees, 0..360. */
export function hue(lab: Lab): number {
  const h = (Math.atan2(lab.b, lab.a) * 180) / Math.PI;
  return h < 0 ? h + 360 : h;
}

/** Saturation that does not depend on how bright the operator maps a colour. */
export function saturation(lab: Lab): number {
  const c = chroma(lab);
  const n = Math.hypot(c, lab.L);
  return n > 0 ? c / n : 0;
}

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/* --------------------------------------------------- highlight soft clip */

/**
 * Linear light where the soft clip starts. Below it a pixel is untouched;
 * above it the pixel's largest channel rolls off towards 1.0 instead of
 * being cut there.
 */
export const SOFT_CLIP_KNEE = 0.9;

function srgbDecodeExtended(v: number): number {
  const a = Math.abs(v);
  const lin = a <= 0.04045 ? a / 12.92 : ((a + 0.055) / 1.055) ** 2.4;
  return v < 0 ? -lin : lin;
}

function srgbEncode8(linear: number): number {
  const c = linear <= 0 ? 0 : linear >= 1 ? 1 : linear;
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(v * 255);
}

/**
 * The largest linear value a channel can reach after a bt2020 -> bt709
 * conversion of light that was tone mapped to at most 1.0: the biggest row
 * sum of positive coefficients of the BT.2087 matrix (red: 1.660491). The
 * roll-off reaches 1.0 only there, so no real pixel is cut.
 */
export const SOFT_CLIP_MAX = 1.660491;

/**
 * The roll-off: identity up to the knee (slope 1 there), then extended
 * Reinhard on the excess, reaching exactly 1.0 at `SOFT_CLIP_MAX`.
 */
export function softClip(m: number, knee = SOFT_CLIP_KNEE, max = SOFT_CLIP_MAX): number {
  if (m <= knee) return m;
  if (m >= max) return 1;
  const span = 1 - knee;
  const e = (m - knee) / span;
  const w = (max - knee) / span;
  return knee + span * ((e * (1 + e / (w * w))) / (1 + e));
}

/**
 * Chromium's own HDR -> SDR conversion (2D canvas and the <video> element)
 * lets bright, saturated colours overshoot 1.0 after its tone curve and then
 * cuts the overshooting channel: on the PQ ColorChecker 16% of the frame had
 * its red channel flattened at 255 (spike 2026-09-23). Drawn into a float16
 * canvas the overshoot survives, so it can be rolled off instead: the pixel's
 * largest channel goes through `softClip` and the other two are scaled by the
 * same factor, which keeps hue and saturation and keeps detail inside the
 * highlight. Pixels whose channels all stay under the knee — nearly the whole
 * picture — come out exactly as the browser converted them.
 *
 * `source`: extended sRGB-encoded RGBA from a float16 canvas. `target`:
 * 8-bit sRGB RGBA of the same size.
 */
export function softClipToRgba8(source: ArrayLike<number>, target: Uint8ClampedArray): void {
  for (let i = 0; i < target.length; i += 4) {
    const re = source[i] ?? 0;
    const ge = source[i + 1] ?? 0;
    const be = source[i + 2] ?? 0;
    if (re <= KNEE_ENCODED && ge <= KNEE_ENCODED && be <= KNEE_ENCODED) {
      // Under the knee: exactly the browser's value, only quantised
      // (Uint8ClampedArray rounds and clamps negatives to 0).
      target[i] = re * 255;
      target[i + 1] = ge * 255;
      target[i + 2] = be * 255;
    } else {
      let r = srgbDecodeExtended(re);
      let g = srgbDecodeExtended(ge);
      let b = srgbDecodeExtended(be);
      const scale = softClip(Math.max(r, g, b)) / Math.max(r, g, b);
      r *= scale;
      g *= scale;
      b *= scale;
      target[i] = srgbEncode8(r);
      target[i + 1] = srgbEncode8(g);
      target[i + 2] = srgbEncode8(b);
    }
    target[i + 3] = 255;
  }
}

/** The knee in sRGB encoding, for the fast path. */
const KNEE_ENCODED = 1.055 * SOFT_CLIP_KNEE ** (1 / 2.4) - 0.055;

/* ------------------------------------------------------------ the probe */

type PatchKind = 'neutral' | 'primary' | 'bright';

export interface ProbePatch {
  id: 'black' | 'gray20' | 'white203' | 'hi400' | 'hi1000' | 'red' | 'green' | 'blue' | 'orange600';
  kind: PatchKind;
  /** Linear bt709 RGB in cd/m² as displayed (neutrals: all three equal). */
  nits: [number, number, number];
}

/**
 * 203 cd/m² is HDR reference white (ITU-R BT.2408), what SDR white should map
 * to. The primaries are pure bt709 colours at moderate light: a correct
 * conversion gives them back as vivid sRGB red/green/blue; skipping the gamut
 * conversion or the transfer visibly desaturates and turns them.
 */
export const PROBE_PATCHES: readonly ProbePatch[] = [
  { id: 'black', kind: 'neutral', nits: [0, 0, 0] },
  { id: 'gray20', kind: 'neutral', nits: [20, 20, 20] },
  { id: 'white203', kind: 'neutral', nits: [203, 203, 203] },
  { id: 'hi400', kind: 'neutral', nits: [400, 400, 400] },
  { id: 'hi1000', kind: 'neutral', nits: [1000, 1000, 1000] },
  { id: 'red', kind: 'primary', nits: [100, 0, 0] },
  { id: 'green', kind: 'primary', nits: [0, 60, 0] },
  { id: 'blue', kind: 'primary', nits: [0, 0, 200] },
  // A bright, saturated warm colour (sunset, skin in sunlight, a lamp): red
  // 600 cd/m² at a luminance of ~260, like the clipped ColorChecker patches of
  // the spike. Every standard operator keeps its red channel below full scale
  // (hable 238/255, reinhard 236, mobius 247, max-RGB reinhard 236). A
  // conversion that tone maps first and converts the gamut afterwards pushes
  // red past full scale, and the colour's detail is gone (ADR-022).
  { id: 'orange600', kind: 'bright', nits: [600, 180, 50] },
];

/** Side of one square patch, in pixels (even, so 4:2:0 chroma stays per patch). */
export const PROBE_PATCH_SIZE = 16;

/** Non-linear bt2020 R'G'B' signal of a patch for the given transfer. */
export function patchSignal(patch: ProbePatch, transfer: HdrTransfer): [number, number, number] {
  const wide = bt709ToBt2020(patch.nits);
  if (transfer === 'pq') return wide.map(pqEncode) as [number, number, number];
  return hlgSceneFromDisplay(wide).map(hlgOetf) as [number, number, number];
}

export interface ProbeFrame {
  width: number;
  height: number;
  /** I420P10: Y plane (width*height), then Cb and Cr (width/2 * height/2), 16-bit little-endian words. */
  data: Uint16Array;
}

/** The synthetic frame: one row of patches, 10-bit 4:2:0, bt2020 non-constant luminance, limited range. */
export function buildProbeFrame(transfer: HdrTransfer): ProbeFrame {
  const size = PROBE_PATCH_SIZE;
  const width = size * PROBE_PATCHES.length;
  const height = size;
  const chromaWidth = width / 2;
  const chromaHeight = height / 2;
  const data = new Uint16Array(width * height + 2 * chromaWidth * chromaHeight);
  const cbOffset = width * height;
  const crOffset = cbOffset + chromaWidth * chromaHeight;

  PROBE_PATCHES.forEach((patch, index) => {
    const [y, cb, cr] = bt2020ToYcbcr10(patchSignal(patch, transfer));
    for (let row = 0; row < height; row += 1) {
      data.fill(y, row * width + index * size, row * width + (index + 1) * size);
    }
    for (let row = 0; row < chromaHeight; row += 1) {
      const start = row * chromaWidth + (index * size) / 2;
      data.fill(cb, cbOffset + start, cbOffset + start + size / 2);
      data.fill(cr, crOffset + start, crOffset + start + size / 2);
    }
  });
  return { width, height, data };
}

/** Lab of each patch, read from the centre of the patch in an RGBA readback. */
export interface ProbeReading extends Lab {
  /** Mean 8-bit sRGB of the patch centre. */
  rgb?: [number, number, number];
}

export function readProbePatches(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
): Map<ProbePatch['id'], ProbeReading> {
  const size = PROBE_PATCH_SIZE;
  const result = new Map<ProbePatch['id'], ProbeReading>();
  PROBE_PATCHES.forEach((patch, index) => {
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    // The centre 8x8: away from the chroma edges a scaler may blur.
    for (let y = size / 4; y < (size * 3) / 4; y += 1) {
      for (let x = index * size + size / 4; x < index * size + (size * 3) / 4; x += 1) {
        const o = (y * width + x) * 4;
        r += rgba[o] ?? 0;
        g += rgba[o + 1] ?? 0;
        b += rgba[o + 2] ?? 0;
        n += 1;
      }
    }
    const rgb: [number, number, number] = [r / n, g / n, b / n];
    result.set(patch.id, { ...srgb8ToLab(...rgb), rgb });
  });
  return result;
}

/**
 * What a correct HDR -> SDR conversion must look like. Chosen to reject the
 * broken conversions of the spike (docs/spikes/2026-09-23-hdr-tonemap.md):
 * no tone mapping, no gamut conversion, hard clipping, colour casts, swapped
 * chroma — while accepting the standard operators (hable, mobius, reinhard,
 * BT.2390), which differ mostly in how bright they map mid-tones.
 */
export const PROBE_LIMITS = {
  /** Neutral patches must stay neutral (C*), else there is a cast. */
  neutralChromaMax: 6,
  blackLMax: 12,
  gray20L: [15, 65] as const,
  /** Reference white must be bright, not a linear-light or crushed picture. */
  whiteLMin: 65,
  /** 1000 cd/m² must stay brighter than reference white: highlights roll off, they are not cut. */
  highlightHeadroomMin: 2,
  /** A primary keeps its hue within this many degrees of the sRGB primary. */
  primaryHueMax: 5,
  /**
   * ...and at least this share of the chroma the pure sRGB primary has at the
   * same lightness. Any tone curve moves a pure primary along that primary's
   * own line; a missing gamut or transfer conversion leaves the line.
   */
  primaryChromaMin: 0.8,
  /** No channel of the bright warm patch may reach this (8-bit): it is clipped. */
  brightChannelMax: 254,
} as const;

const PRIMARY_AXIS: Record<'red' | 'green' | 'blue', [number, number, number]> = {
  red: [1, 0, 0],
  green: [0, 1, 0],
  blue: [0, 0, 1],
};

/** Lab of the pure sRGB primary scaled to lightness `L` (bisection on linear light). */
export function primaryAtLightness(id: 'red' | 'green' | 'blue', L: number): Lab {
  const axis = PRIMARY_AXIS[id];
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2;
    if (linearToLab(axis[0] * mid, axis[1] * mid, axis[2] * mid).L < L) lo = mid;
    else hi = mid;
  }
  const k = (lo + hi) / 2;
  return linearToLab(axis[0] * k, axis[1] * k, axis[2] * k);
}

export interface ProbeVerdict {
  pass: boolean;
  /** Stable, short reasons; never contains user data. */
  failures: string[];
  patches: Record<string, { L: number; C: number; h: number }>;
}

export function judgeHdrProbe(patches: Map<ProbePatch['id'], ProbeReading>): ProbeVerdict {
  const failures: string[] = [];
  const get = (id: ProbePatch['id']): ProbeReading => patches.get(id) ?? { L: NaN, a: NaN, b: NaN };
  const limits = PROBE_LIMITS;

  for (const patch of PROBE_PATCHES) {
    if (patch.kind !== 'neutral') continue;
    if (!(chroma(get(patch.id)) <= limits.neutralChromaMax)) failures.push(`cast:${patch.id}`);
  }
  const black = get('black').L;
  const gray = get('gray20').L;
  const white = get('white203').L;
  const hi400 = get('hi400').L;
  const hi1000 = get('hi1000').L;
  if (!(black <= limits.blackLMax)) failures.push('black_lifted');
  if (!(gray >= limits.gray20L[0] && gray <= limits.gray20L[1])) failures.push('midtone_out_of_range');
  if (!(white >= limits.whiteLMin)) failures.push('white_too_dark');
  if (!(black < gray && gray < white && white <= hi400 + 0.5 && hi400 <= hi1000 + 0.5)) {
    failures.push('not_monotonic');
  }
  if (!(hi1000 - white >= limits.highlightHeadroomMin)) failures.push('highlights_clipped');

  for (const id of ['red', 'green', 'blue'] as const) {
    const lab = get(id);
    // A lighter-than-full primary does not exist in SDR; compare at most with full.
    const target = primaryAtLightness(id, Math.min(lab.L, linearToLab(...PRIMARY_AXIS[id]).L));
    if (!(hueDistance(hue(lab), hue(target)) <= limits.primaryHueMax)) failures.push(`hue:${id}`);
    if (!(chroma(lab) >= limits.primaryChromaMin * chroma(target))) failures.push(`saturation:${id}`);
  }

  const bright = get('orange600').rgb;
  if (!bright || !(Math.max(...bright) < limits.brightChannelMax)) failures.push('bright_colour_clipped');

  const summary: ProbeVerdict['patches'] = {};
  for (const patch of PROBE_PATCHES) {
    const lab = get(patch.id);
    summary[patch.id] = {
      L: Math.round(lab.L * 10) / 10,
      C: Math.round(chroma(lab) * 10) / 10,
      h: Math.round(hue(lab)),
    };
  }
  return { pass: failures.length === 0, failures, patches: summary };
}
