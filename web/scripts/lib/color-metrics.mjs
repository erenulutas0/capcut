/**
 * Colour-difference metrics for comparing a tone-mapped frame with a
 * reference (docs/spikes/2026-09-23-hdr-tonemap.md). Pure functions over
 * 8-bit RGB buffers; both images are read as sRGB-encoded bt709 primaries,
 * which is what an SDR bt709 output shows on an ordinary screen.
 *
 * The point is to catch broken output — washed out, wrong primaries, clipped
 * highlights, a colour cast — not to demand the same pixels as one particular
 * tone-mapping operator.
 */

/** sRGB (IEC 61966-2-1) decoding of an 8-bit code value to linear light. */
export function srgbToLinear(code) {
  const v = code / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

const LINEAR_LUT = Float64Array.from({ length: 256 }, (_, i) => srgbToLinear(i));

/** D65 reference white, Y = 1. */
const WHITE = [0.95047, 1, 1.08883];

function labF(t) {
  return t > 216 / 24389 ? Math.cbrt(t) : (t * 24389) / 27 / 116 + 16 / 116;
}

/** 8-bit sRGB -> CIE L*a*b* (D65). */
export function srgbToLab(r, g, b) {
  const R = LINEAR_LUT[r];
  const G = LINEAR_LUT[g];
  const B = LINEAR_LUT[b];
  const X = 0.4123908 * R + 0.3575843 * G + 0.1804808 * B;
  const Y = 0.2126390 * R + 0.7151687 * G + 0.0721923 * B;
  const Z = 0.0193308 * R + 0.1191948 * G + 0.9505322 * B;
  const fx = labF(X / WHITE[0]);
  const fy = labF(Y / WHITE[1]);
  const fz = labF(Z / WHITE[2]);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const DEG = Math.PI / 180;

/**
 * CIEDE2000 colour difference (Sharma, Wu, Dalal 2005), kL = kC = kH = 1.
 */
export function deltaE2000(lab1, lab2) {
  const [L1, a1, b1] = lab1;
  const [L2, a2, b2] = lab2;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const Cbar7 = Cbar ** 7;
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + 25 ** 7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const hue = (b, a) => {
    if (a === 0 && b === 0) return 0;
    const h = Math.atan2(b, a) / DEG;
    return h >= 0 ? h : h + 360;
  };
  const h1p = hue(b1, a1p);
  const h2p = hue(b2, a2p);

  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * DEG);

  const Lbarp = (L1 + L2) / 2;
  const Cbarp = (C1p + C2p) / 2;
  let hbarp = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) <= 180) hbarp = (h1p + h2p) / 2;
    else if (h1p + h2p < 360) hbarp = (h1p + h2p + 360) / 2;
    else hbarp = (h1p + h2p - 360) / 2;
  }
  const T =
    1 -
    0.17 * Math.cos((hbarp - 30) * DEG) +
    0.24 * Math.cos(2 * hbarp * DEG) +
    0.32 * Math.cos((3 * hbarp + 6) * DEG) -
    0.2 * Math.cos((4 * hbarp - 63) * DEG);
  const dTheta = 30 * Math.exp(-(((hbarp - 275) / 25) ** 2));
  const Cbarp7 = Cbarp ** 7;
  const Rc = 2 * Math.sqrt(Cbarp7 / (Cbarp7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lbarp - 50) ** 2) / Math.sqrt(20 + (Lbarp - 50) ** 2);
  const Sc = 1 + 0.045 * Cbarp;
  const Sh = 1 + 0.015 * Cbarp * T;
  const Rt = -Math.sin(2 * dTheta * DEG) * Rc;
  return Math.sqrt(
    (dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh),
  );
}

/**
 * Compares `output` against `reference`, both packed 8-bit RGB (3 bytes per
 * pixel) of the same size.
 *
 * - meanDeltaE00 / p95DeltaE00: overall colour distance.
 * - meanDeltaL: output L* minus reference L* (negative = darker).
 * - cast: length of the mean (a*, b*) offset — a uniform tint such as a
 *   green or purple cast moves every pixel the same way and shows up here,
 *   while legitimate operator differences mostly change lightness.
 * - chromaRatio: mean C* of output / mean C* of reference. Wrong primaries
 *   (bt2020 values shown as bt709) and an un-tone-mapped PQ/HLG signal both
 *   drain saturation; an over-saturating conversion pushes it above 1.
 * - clipDelta: share of pixels with a channel at 254+ in the output minus the
 *   same share in the reference; hard-clipped highlights raise it.
 */
export function compareRgb(reference, output) {
  if (reference.length !== output.length || reference.length % 3 !== 0) {
    throw new Error('compareRgb: buffers differ in size');
  }
  const pixels = reference.length / 3;
  const deltas = new Float64Array(pixels);
  let sumDelta = 0;
  let sumDL = 0;
  let sumDa = 0;
  let sumDb = 0;
  let sumCref = 0;
  let sumCout = 0;
  let clipRef = 0;
  let clipOut = 0;
  let sumSatRef = 0;
  let sumSatOut = 0;
  let hueWeighted = 0;
  let hueWeight = 0;
  let sumVividRef = 0;
  let sumVividOut = 0;
  for (let i = 0; i < pixels; i += 1) {
    const o = i * 3;
    const r1 = reference[o];
    const g1 = reference[o + 1];
    const b1 = reference[o + 2];
    const r2 = output[o];
    const g2 = output[o + 1];
    const b2 = output[o + 2];
    const lab1 = srgbToLab(r1, g1, b1);
    const lab2 = srgbToLab(r2, g2, b2);
    const d = deltaE2000(lab1, lab2);
    deltas[i] = d;
    sumDelta += d;
    sumDL += lab2[0] - lab1[0];
    sumDa += lab2[1] - lab1[1];
    sumDb += lab2[2] - lab1[2];
    const c1 = Math.hypot(lab1[1], lab1[2]);
    const c2 = Math.hypot(lab2[1], lab2[2]);
    sumCref += c1;
    sumCout += c2;
    // Saturation independent of how bright the operator maps a pixel.
    sumSatRef += c1 / Math.hypot(c1, lab1[0]) || 0;
    sumSatOut += c2 / Math.hypot(c2, lab2[0]) || 0;
    if (c1 > VIVID_CHROMA) {
      sumVividRef += c1 / Math.hypot(c1, lab1[0]) || 0;
      sumVividOut += c2 / Math.hypot(c2, lab2[0]) || 0;
    }
    if (c1 > HUE_MIN_CHROMA && c2 > HUE_MIN_CHROMA) {
      let dh = Math.abs(Math.atan2(lab2[2], lab2[1]) - Math.atan2(lab1[2], lab1[1])) / DEG;
      if (dh > 180) dh = 360 - dh;
      const weight = Math.min(c1, c2);
      hueWeighted += dh * weight;
      hueWeight += weight;
    }
    if (Math.max(r1, g1, b1) >= 254) clipRef += 1;
    if (Math.max(r2, g2, b2) >= 254) clipOut += 1;
  }
  deltas.sort();
  const meanDa = sumDa / pixels;
  const meanDb = sumDb / pixels;
  return {
    meanDeltaE00: sumDelta / pixels,
    p95DeltaE00: deltas[Math.min(pixels - 1, Math.floor(pixels * 0.95))],
    meanDeltaL: sumDL / pixels,
    meanDeltaA: meanDa,
    meanDeltaB: meanDb,
    cast: Math.hypot(meanDa, meanDb),
    chromaRatio: sumCref > 0 ? sumCout / sumCref : 1,
    saturationRatio: sumSatRef > 0 ? sumSatOut / sumSatRef : 1,
    // The same over the reference's vivid pixels only: wrong primaries
    // (bt2020 values shown as bt709) desaturate exactly these, while greys
    // and skin tones would dilute the whole-frame ratio.
    vividSaturationRatio: sumVividRef > 0 ? sumVividOut / sumVividRef : 1,
    hueError: hueWeight > 0 ? hueWeighted / hueWeight : 0,
    clipDelta: (clipOut - clipRef) / pixels,
  };
}

/** Pixels greyer than this (C*) carry no meaningful hue. */
const HUE_MIN_CHROMA = 8;
/** Reference pixels at least this colourful (C*) count as vivid. */
const VIVID_CHROMA = 30;

/** Mean of an 8-bit RGB frame's BT.709 luma, 0..255; a black frame is ~0-16. */
export function meanLuma(rgb) {
  let sum = 0;
  const pixels = rgb.length / 3;
  for (let i = 0; i < rgb.length; i += 3) {
    sum += 0.2126 * rgb[i] + 0.7152 * rgb[i + 1] + 0.0722 * rgb[i + 2];
  }
  return sum / pixels;
}
