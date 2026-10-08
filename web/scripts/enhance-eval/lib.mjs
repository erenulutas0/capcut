/**
 * Shared pieces of the "İyileştir" measurements (ADR-037).
 *
 * The scripts in this folder run the app's own maths (`src/domain/enhance.ts`,
 * transpiled as it is) over real frames: clean footage degraded in known
 * ways, so there is a reference to compare with, and the real recordings for
 * the "does no harm" check. ffmpeg only decodes, scales and (for one
 * degradation) compresses; every measurement is computed here.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
/** Generated frames and results (gitignored). */
export const setDir = join(webRoot, 'tests', 'media', 'enhance');
export const resultsDir = join(webRoot, 'enhance-results');

/** Real recordings live in the main checkout only (gitignored there); read, never written. */
export function realMediaDir() {
  const fromEnv = process.env.CLIP_REAL_MEDIA;
  if (fromEnv) return fromEnv;
  const local = join(webRoot, 'tests', 'media', 'real');
  if (existsSync(local)) return local;
  // A git worktree under <repo>/.claude/worktrees/<name>/web: the main checkout's folder.
  return join(webRoot, '..', '..', '..', '..', 'web', 'tests', 'media', 'real');
}

/** The app's enhancement module, transpiled from its TypeScript source. */
export async function loadEnhance(sourcePath = process.env.ENHANCE_SOURCE || join(webRoot, 'src', 'domain', 'enhance.ts')) {
  // ENHANCE_SOURCE: another version of the file (e.g. `git show <commit>:web/src/domain/enhance.ts`), for before/after tables.
  const ts = (await import('typescript')).default;
  const source = readFileSync(sourcePath, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  if (/from '\.\//.test(outputText)) throw new Error('enhance.ts gained a runtime import; extend loadEnhance');
  const workDir = join(setDir, '.module');
  mkdirSync(workDir, { recursive: true });
  const target = join(workDir, `enhance-${process.pid}-${Date.now()}.mjs`);
  writeFileSync(target, outputText);
  return import(pathToFileURL(target).href);
}

/** Small deterministic PRNG (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal samples from a uniform generator (Box-Muller). */
export function gaussian(random) {
  let spare = null;
  return () => {
    if (spare !== null) {
      const value = spare;
      spare = null;
      return value;
    }
    let u = 0;
    while (u === 0) u = random();
    const radius = Math.sqrt(-2 * Math.log(u));
    const angle = 2 * Math.PI * random();
    spare = radius * Math.sin(angle);
    return radius * Math.cos(angle);
  };
}

export function ffprobeVideo(file) {
  const out = execFileSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,r_frame_rate,color_transfer,pix_fmt:stream_side_data=rotation:format=duration',
    '-of', 'json', file,
  ]).toString();
  const json = JSON.parse(out);
  const stream = json.streams?.[0] ?? {};
  const rotation = Number(stream.side_data_list?.find((item) => item.rotation !== undefined)?.rotation ?? 0);
  const swap = Math.abs(rotation) === 90 || Math.abs(rotation) === 270;
  const [num, den] = String(stream.r_frame_rate ?? '30/1').split('/').map(Number);
  return {
    width: swap ? stream.height : stream.width,
    height: swap ? stream.width : stream.height,
    duration: Number(json.format?.duration ?? 0),
    fps: den ? num / den : 30,
    transfer: stream.color_transfer ?? null,
    pixFmt: stream.pix_fmt ?? null,
  };
}

/** The frame size with the given short edge, even numbers, keeping the shape. */
export function fitShortEdge(width, height, shortEdge) {
  const scale = shortEdge / Math.min(width, height);
  const even = (value) => Math.max(2, Math.round((value * scale) / 2) * 2);
  return { width: even(width), height: even(height) };
}

/**
 * Decodes frames to 8-bit RGBA at the given size (rotation applied, bt709
 * matrix, Lanczos scaling). Returns one Uint8ClampedArray per frame.
 */
export function decodeFrames(file, { at = 0, frames = 1, width, height, fps = null }) {
  const filter = [
    fps ? `fps=${fps}` : null,
    `scale=${width}:${height}:flags=lanczos+accurate_rnd+full_chroma_int:in_color_matrix=bt709`,
    'format=rgba',
  ].filter(Boolean).join(',');
  const result = spawnSync(
    'ffmpeg',
    ['-v', 'error', '-ss', String(at), '-i', file, '-frames:v', String(frames), '-vf', filter, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'],
    { maxBuffer: width * height * 4 * frames + 1024, encoding: 'buffer' },
  );
  if (result.status !== 0) throw new Error(`ffmpeg failed for ${file}: ${result.stderr?.toString().slice(0, 300)}`);
  const size = width * height * 4;
  const out = [];
  for (let index = 0; (index + 1) * size <= result.stdout.length; index += 1) {
    out.push(new Uint8ClampedArray(result.stdout.buffer, result.stdout.byteOffset + index * size, size).slice());
  }
  return out;
}

/** RGBA frames -> a video file (ffmpeg arguments after the input are the caller's). */
export function encodeFrames(frames, width, height, fps, outputArgs, target) {
  const input = Buffer.concat(frames.map((frame) => Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength)));
  const result = spawnSync(
    'ffmpeg',
    ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${width}x${height}`, '-r', String(fps), '-i', '-', ...outputArgs, target],
    { input, maxBuffer: 16 * 1024 * 1024 },
  );
  if (result.status !== 0) throw new Error(`ffmpeg encode failed: ${result.stderr?.toString().slice(0, 300)}`);
}

export function writePng(rgba, width, height, target) {
  mkdirSync(dirname(target), { recursive: true });
  encodeFrames([rgba], width, height, 1, ['-frames:v', '1'], target);
}

/* ---------------------------------------------------------------- metrics */

export function lumaOf(rgba, width, height) {
  const out = new Float32Array(width * height);
  for (let index = 0, at = 0; index < out.length; index += 1, at += 4) {
    out[index] = 0.2126 * rgba[at] + 0.7152 * rgba[at + 1] + 0.0722 * rgba[at + 2];
  }
  return out;
}

/** PSNR over the three colour channels, in dB (8-bit peak). */
export function psnr(a, b) {
  let sum = 0;
  let count = 0;
  for (let at = 0; at < a.length; at += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      const difference = a[at + channel] - b[at + channel];
      sum += difference * difference;
    }
    count += 3;
  }
  const mse = sum / count;
  return mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse);
}

/**
 * Mean SSIM of the luma planes over 8×8 windows on a 4-pixel grid (the
 * windowing of ffmpeg's `ssim` filter; constants of Wang et al. 2004:
 * K1 0.01, K2 0.03, 8-bit peak, sample variances).
 */
export function ssim(rgbaA, rgbaB, width, height) {
  const a = lumaOf(rgbaA, width, height);
  const b = lumaOf(rgbaB, width, height);
  const c1 = (0.01 * 255) ** 2;
  const c2 = (0.03 * 255) ** 2;
  let sum = 0;
  let count = 0;
  for (let top = 0; top + 8 <= height; top += 4) {
    for (let left = 0; left + 8 <= width; left += 4) {
      let sa = 0;
      let sb = 0;
      let saa = 0;
      let sbb = 0;
      let sab = 0;
      for (let y = top; y < top + 8; y += 1) {
        const line = y * width;
        for (let x = left; x < left + 8; x += 1) {
          const va = a[line + x];
          const vb = b[line + x];
          sa += va;
          sb += vb;
          saa += va * va;
          sbb += vb * vb;
          sab += va * vb;
        }
      }
      const muA = sa / 64;
      const muB = sb / 64;
      const varA = (saa - 64 * muA * muA) / 63;
      const varB = (sbb - 64 * muB * muB) / 63;
      const cov = (sab - 64 * muA * muB) / 63;
      sum += ((2 * muA * muB + c1) * (2 * cov + c2)) / ((muA * muA + muB * muB + c1) * (varA + varB + c2));
      count += 1;
    }
  }
  return count > 0 ? sum / count : 1;
}

/** No-reference sharpness: variance of the 4-neighbour Laplacian of the luma (8-bit levels²). */
export function laplacianVariance(rgba, width, height) {
  const luma = lumaOf(rgba, width, height);
  let sum = 0;
  let sumSquares = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const at = y * width + x;
      const value = 4 * luma[at] - luma[at - 1] - luma[at + 1] - luma[at - width] - luma[at + width];
      sum += value;
      sumSquares += value * value;
      count += 1;
    }
  }
  const mean = sum / count;
  return sumSquares / count - mean * mean;
}

/** Mean luma, 0..255. */
export function meanLuma(rgba, width, height) {
  const luma = lumaOf(rgba, width, height);
  let sum = 0;
  for (let i = 0; i < luma.length; i += 1) sum += luma[i];
  return sum / luma.length;
}

export const round = (value, digits = 2) => (Number.isFinite(value) ? Number(value.toFixed(digits)) : value);

export function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : NaN;
}

export function parseArgs(argv = process.argv.slice(2)) {
  return Object.fromEntries(
    argv.map((arg) => {
      const [key, value] = arg.replace(/^--/, '').split('=');
      return [key, value ?? true];
    }),
  );
}
