/**
 * Builds the reference set of the "İyileştir" measurements (ADR-037).
 *
 *   node scripts/enhance-eval/build-set.mjs
 *
 * Clean frames from the recordings in tests/media/real (local only, see
 * SOURCES-web.md there for where each came from and its licence), scaled to
 * a 720-pixel short edge, and each frame degraded in known ways so that the
 * clean frame is the reference:
 *
 *   under-1 / under-2   exposure −1 / −2 stops (linear light × 0.5 / × 0.25)
 *   lowcon              veiling: linear light × 0.65 + 0.06 (lifted blacks, flat)
 *   cast-warm / -cool   channel gains in linear light (1.18, 1, 0.80) / (0.85, 1, 1.20)
 *   dull                saturation × 0.6 around the luminance
 *   soft-1 / soft-2     Gaussian blur in linear light, sigma 1 / 2 pixels
 *   noise-1 / noise-2   white Gaussian noise per channel, sigma 5 / 12 code values
 *   compressed          x264 at about 0.02 bit per pixel, 15 frames of the real motion
 *   dark-noisy          exposure × 0.3, then noise sigma 5
 *
 * Everything lands in tests/media/enhance/ (gitignored).
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { decodeFrames, encodeFrames, ffprobeVideo, fitShortEdge, gaussian, realMediaDir, rng, setDir } from './lib.mjs';

const SHORT_EDGE = 720;
/** Frames taken around each moment for the compressed variant; the reference is this one of them. */
const CLIP_FRAMES = 15;
const CLIP_PICK = 12;

/** The clean footage. Licences as recorded in tests/media/real/SOURCES-web.md. */
export const REFERENCES = [
  { id: 'waterfall', file: 'web-pixel6pro-hevc-4k-rot90.mp4', licence: 'public domain (immich test-assets)', at: [2, 6.5] },
  { id: 'sef', file: 'web-samsung-hevc-slowmo-sef-rot90.mp4', licence: 'Apache-2.0 (androidx/media)', at: [2, 8] },
  { id: 'road', file: 'web-iphone11-h264-long-5m41s.mov', licence: 'CC BY-ND 4.0 (archive.org)', at: [20, 120, 250] },
  { id: 'dock', file: 'web-iphone13pro-h264-60fps-rot180.mov', licence: 'CC BY-NC-ND 4.0 (archive.org)', at: [10, 60] },
];

const decode = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const encode = (y) => (y <= 0.0031308 ? y * 12.92 : 1.055 * y ** (1 / 2.4) - 0.055);
const DECODE = Float32Array.from({ length: 256 }, (_, i) => decode(i / 255));
const to8 = (light) => Math.min(255, Math.max(0, Math.round(encode(Math.min(1, Math.max(0, light))) * 255)));

/** Applies `fn(r, g, b) -> [r, g, b]` in linear light to every pixel. */
function mapLinear(rgba, fn) {
  const out = new Uint8ClampedArray(rgba.length);
  for (let at = 0; at < rgba.length; at += 4) {
    const [r, g, b] = fn(DECODE[rgba[at]], DECODE[rgba[at + 1]], DECODE[rgba[at + 2]]);
    out[at] = to8(r);
    out[at + 1] = to8(g);
    out[at + 2] = to8(b);
    out[at + 3] = 255;
  }
  return out;
}

function blurLinear(rgba, width, height, sigma) {
  const radius = Math.ceil(sigma * 3);
  const kernel = [];
  let total = 0;
  for (let i = -radius; i <= radius; i += 1) {
    const weight = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel.push(weight);
    total += weight;
  }
  const planes = [0, 1, 2].map((channel) => {
    const plane = new Float32Array(width * height);
    for (let i = 0; i < plane.length; i += 1) plane[i] = DECODE[rgba[i * 4 + channel]];
    const pass = new Float32Array(plane.length);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let sum = 0;
        for (let k = -radius; k <= radius; k += 1) sum += kernel[k + radius] * plane[y * width + Math.min(width - 1, Math.max(0, x + k))];
        pass[y * width + x] = sum / total;
      }
    }
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let sum = 0;
        for (let k = -radius; k <= radius; k += 1) sum += kernel[k + radius] * pass[Math.min(height - 1, Math.max(0, y + k)) * width + x];
        plane[y * width + x] = sum / total;
      }
    }
    return plane;
  });
  const out = new Uint8ClampedArray(rgba.length);
  for (let i = 0; i < width * height; i += 1) {
    out[i * 4] = to8(planes[0][i]);
    out[i * 4 + 1] = to8(planes[1][i]);
    out[i * 4 + 2] = to8(planes[2][i]);
    out[i * 4 + 3] = 255;
  }
  return out;
}

function addNoise(rgba, sigma, seed) {
  const normal = gaussian(rng(seed));
  const out = new Uint8ClampedArray(rgba.length);
  for (let at = 0; at < rgba.length; at += 4) {
    out[at] = rgba[at] + sigma * normal();
    out[at + 1] = rgba[at + 1] + sigma * normal();
    out[at + 2] = rgba[at + 2] + sigma * normal();
    out[at + 3] = 255;
  }
  return out;
}

const gain = (k) => (rgba) => mapLinear(rgba, (r, g, b) => [r * k, g * k, b * k]);

export const DEGRADATIONS = {
  clean: (rgba) => rgba.slice(),
  'under-1': gain(0.5),
  'under-2': gain(0.25),
  lowcon: (rgba) => mapLinear(rgba, (r, g, b) => [r * 0.65 + 0.06, g * 0.65 + 0.06, b * 0.65 + 0.06]),
  'cast-warm': (rgba) => mapLinear(rgba, (r, g, b) => [r * 1.18, g, b * 0.8]),
  'cast-cool': (rgba) => mapLinear(rgba, (r, g, b) => [r * 0.85, g, b * 1.2]),
  dull: (rgba) =>
    mapLinear(rgba, (r, g, b) => {
      const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      return [y + (r - y) * 0.6, y + (g - y) * 0.6, y + (b - y) * 0.6];
    }),
  'soft-1': (rgba, width, height) => blurLinear(rgba, width, height, 1),
  'soft-2': (rgba, width, height) => blurLinear(rgba, width, height, 2),
  'noise-1': (rgba, _w, _h, seed) => addNoise(rgba, 5, seed),
  'noise-2': (rgba, _w, _h, seed) => addNoise(rgba, 12, seed + 1),
  'dark-noisy': (rgba, _w, _h, seed) => addNoise(gain(0.3)(rgba), 5, seed + 2),
};

function main() {
  const real = realMediaDir();
  const framesDir = join(setDir, 'frames');
  rmSync(framesDir, { recursive: true, force: true });
  mkdirSync(framesDir, { recursive: true });
  const manifest = { shortEdge: SHORT_EDGE, frames: [] };
  let seed = 1000;

  for (const reference of REFERENCES) {
    const file = join(real, reference.file);
    if (!existsSync(file)) {
      console.warn(`missing ${reference.file}; skipped`);
      continue;
    }
    const info = ffprobeVideo(file);
    const { width, height } = fitShortEdge(info.width, info.height, SHORT_EDGE);
    for (const at of reference.at) {
      const clip = decodeFrames(file, { at, frames: CLIP_FRAMES, width, height, fps: 30 });
      const clean = clip[CLIP_PICK];
      if (!clean) throw new Error(`could not decode ${reference.file} at ${at}`);
      const name = `${reference.id}-${String(at).replace('.', '_')}`;
      const variants = {};
      for (const [id, degrade] of Object.entries(DEGRADATIONS)) {
        seed += 7;
        variants[id] = degrade(clean, width, height, seed);
      }
      // Compressed: the real motion around the frame, encoded small, and the same frame decoded again.
      const small = join(framesDir, `${name}.compressed.mp4`);
      const bitrate = Math.round(width * height * 30 * 0.02);
      encodeFrames(clip, width, height, 30, [
        '-c:v', 'libx264', '-preset', 'medium', '-b:v', String(bitrate), '-maxrate', String(bitrate), '-bufsize', String(bitrate),
        '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
      ], small);
      const decoded = decodeFrames(small, { at: 0, frames: CLIP_FRAMES, width, height });
      if (decoded[CLIP_PICK]) variants.compressed = decoded[CLIP_PICK];
      rmSync(small, { force: true });

      for (const [id, rgba] of Object.entries(variants)) {
        writeFileSync(join(framesDir, `${name}.${id}.rgba`), Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength));
      }
      manifest.frames.push({ name, reference: reference.id, licence: reference.licence, at, width, height, variants: Object.keys(variants) });
      console.log(`${name}: ${width}x${height}, ${Object.keys(variants).length} variants`);
    }
  }
  writeFileSync(join(setDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

if (process.argv[1] && process.argv[1].endsWith('build-set.mjs')) main();
