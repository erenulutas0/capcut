/**
 * Synthetic sources for the "İyileştir" tests (ADR-037), made with ffmpeg on
 * first use into a gitignored folder. Generated noise, gradients and tones
 * only: nothing here is real footage.
 *
 * The picture is built to look like something a camera filmed as far as the
 * enhancement's measurements go — continuous tones (fractal noise over soft
 * colour gradients), a few hard edges, a little grain — because flat
 * graphics such as a test card are left alone on purpose (the "does no harm"
 * guard; `sample-24s.mp4` is used for that case).
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// "e2e-v2": the files made before 8 Oct 2026 (folder "e2e") differ from machine to machine; they are not used any more.
export const ENHANCE_MEDIA_DIR = join(process.cwd(), 'tests', 'media', 'enhance', 'e2e-v2');

const SIZE = '1280x720';

/** The scene: fractal noise over a soft four-colour gradient, a grid, a dark and a bright box, grain. */
function scene(seconds: number): { inputs: string[]; graph: string } {
  return {
    inputs: [
      '-f', 'lavfi', '-i', `perlin=s=${SIZE}:r=30:octaves=6:persistence=0.65:xscale=6:yscale=6:tscale=0.4:random_mode=seed:random_seed=7`,
      '-f', 'lavfi', '-i', `gradients=s=${SIZE}:r=30:c0=0x5a6f8f:c1=0xc9b89a:c2=0x6f8f6a:c3=0x9a7070:n=4:speed=0.01:seed=3`,
      '-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=48000:duration=${seconds}`,
    ],
    graph:
      '[0:v]format=gbrp[n];[1:v]format=gbrp[g];[n][g]blend=all_mode=overlay,eq=contrast=1.3,' +
      'drawgrid=w=320:h=240:t=3:c=white@0.55,drawbox=x=120:y=100:w=180:h=120:c=black@0.75:t=fill,' +
      'drawbox=x=840:y=420:w=240:h=160:c=white@0.8:t=fill,noise=alls=4:allf=t',
  };
}

// Tagged bt709, limited range: the browser and ffmpeg then read the same colours from the file.
const ENCODE = [
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', '-pix_fmt', 'yuv420p', '-g', '30',
  '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
  '-c:a', 'aac', '-b:a', '128k', '-shortest',
];

/** `k`: the picture's code values are multiplied by it (0.5 is about two stops darker). */
const darker = (k: number): string => `lutrgb=r='val*${k}':g='val*${k}':b='val*${k}'`;

/**
 * Exposure over time, as a factor on the code values: a slow rise from dark
 * to normal over the first four seconds, steady, a sudden drop at 6 s, a
 * sudden return at 8 s. For the flicker measurement.
 */
export const EXPOSURE_SCHEDULE = 'if(lt(T,4),0.45+0.55*T/4,if(lt(T,6),1,if(lt(T,8),0.5,1)))';

const SPECS = {
  /** Well exposed, sharp, natural colours: nothing to enhance. */
  good: { name: 'iyi.mp4', seconds: 3, filter: null as string | null },
  /** About two stops underexposed. */
  dark: { name: 'karanlik.mp4', seconds: 3, filter: darker(0.5) },
  /** Out of focus: a Gaussian blur of 2.5 pixels. */
  soft: { name: 'bulanik.mp4', seconds: 3, filter: 'gblur=sigma=2.5' },
  /** Grainy: strong noise on a darkish picture, as a small sensor gives at night. */
  noisy: { name: 'kumlu.mp4', seconds: 3, filter: `${darker(0.75)},noise=alls=22:allf=t` },
  /** The exposure changes slowly and suddenly (see `EXPOSURE_SCHEDULE`), 10 s. */
  changing: {
    name: 'degisen-isik.mp4',
    seconds: 10,
    filter: `format=gbrp,geq=r='r(X,Y)*(${EXPOSURE_SCHEDULE})':g='g(X,Y)*(${EXPOSURE_SCHEDULE})':b='b(X,Y)*(${EXPOSURE_SCHEDULE})'`,
  },
} as const;

export type EnhanceFixture = keyof typeof SPECS;

export const ENHANCE_FIXTURES = Object.keys(SPECS) as EnhanceFixture[];

/**
 * The same bytes on every run with the same ffmpeg (checked by
 * `scripts/enhance-eval/fixture-determinism.mjs`).
 *
 * Found 8 Oct 2026: two worktrees made two different `degisen-isik.mp4` from
 * this recipe, and one of them failed a test. The cause was the `perlin`
 * source: its `random_seed` is only used with `random_mode=seed`; in the
 * default mode ffmpeg draws a new pattern on every run, so every checkout had
 * another scene. Now `random_mode=seed`. The rest is belt and braces: filters
 * and encoder on one thread, and nothing run-dependent written into the file.
 */
const DETERMINISTIC_IN = ['-filter_complex_threads', '1', '-filter_threads', '1'];
const DETERMINISTIC_OUT = ['-threads', '1', '-fflags', '+bitexact', '-flags:v', '+bitexact', '-flags:a', '+bitexact', '-map_metadata', '-1'];

/** Writes fixture `name` to `file` (overwriting). */
export function makeEnhanceFixture(name: EnhanceFixture, file: string): void {
  const spec = SPECS[name];
  const { inputs, graph } = scene(spec.seconds);
  const filter = `${graph}${spec.filter ? `,${spec.filter}` : ''},scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[v]`;
  execFileSync(
    'ffmpeg',
    [
      '-hide_banner', '-loglevel', 'error', '-y', ...DETERMINISTIC_IN, ...inputs, '-filter_complex', filter,
      '-map', '[v]', '-map', '2:a', '-t', String(spec.seconds), ...ENCODE, ...DETERMINISTIC_OUT, '-f', 'mp4', file,
    ],
    { stdio: 'pipe' },
  );
}

export function enhanceFixture(name: EnhanceFixture): string {
  const spec = SPECS[name];
  const file = join(ENHANCE_MEDIA_DIR, spec.name);
  if (existsSync(file)) return file;
  mkdirSync(ENHANCE_MEDIA_DIR, { recursive: true });
  const partial = `${file}.part.mp4`;
  rmSync(partial, { force: true });
  makeEnhanceFixture(name, partial);
  // Rename only when complete: an interrupted run never leaves half a fixture.
  renameSync(partial, file);
  return file;
}

/**
 * Mean luma (0–255, full range) of every frame of a video, in order.
 * Measured on RGB that ffmpeg converted with the file's own colour tags, so a
 * limited-range source and a full-range export are compared like with like.
 */
export function frameLumas(file: string): number[] {
  const width = 160;
  const height = 90;
  const result = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-loglevel', 'error', '-i', file, '-vf', `scale=${width}:${height}:flags=area`, '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'],
    { maxBuffer: 512 * 1024 * 1024 },
  );
  const bytes = result.stdout as unknown as Buffer;
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${String(result.stderr)}`);
  const size = width * height * 3;
  const out: number[] = [];
  for (let start = 0; start + size <= bytes.length; start += size) out.push(rgbMeans(bytes.subarray(start, start + size)).luma);
  return out;
}

/** One frame as 8-bit RGB at the file's own size. */
export function frameRgb(file: string, atS: number, width: number, height: number): Buffer {
  const result = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-loglevel', 'error', '-ss', atS.toFixed(3), '-i', file, '-frames:v', '1', '-vf', `scale=${width}:${height}`, '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'],
    { maxBuffer: width * height * 3 + 1024 },
  );
  const bytes = result.stdout as unknown as Buffer;
  if (result.status !== 0 || bytes.length !== width * height * 3) throw new Error(`ffmpeg failed: ${String(result.stderr)}`);
  return bytes;
}

/** Mean of each channel and the mean luma of an RGB frame. */
export function rgbMeans(rgb: Buffer): { r: number; g: number; b: number; luma: number } {
  let r = 0;
  let g = 0;
  let b = 0;
  for (let at = 0; at < rgb.length; at += 3) {
    r += rgb[at] ?? 0;
    g += rgb[at + 1] ?? 0;
    b += rgb[at + 2] ?? 0;
  }
  const pixels = rgb.length / 3;
  r /= pixels;
  g /= pixels;
  b /= pixels;
  return { r, g, b, luma: 0.2126 * r + 0.7152 * g + 0.0722 * b };
}

/** No-reference sharpness: variance of the 4-neighbour Laplacian of the luma. */
export function laplacianVariance(rgb: Buffer, width: number, height: number): number {
  const luma = new Float32Array(width * height);
  for (let i = 0; i < luma.length; i += 1) {
    luma[i] = 0.2126 * (rgb[i * 3] ?? 0) + 0.7152 * (rgb[i * 3 + 1] ?? 0) + 0.0722 * (rgb[i * 3 + 2] ?? 0);
  }
  let sum = 0;
  let squares = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const at = y * width + x;
      const value =
        4 * (luma[at] ?? 0) - (luma[at - 1] ?? 0) - (luma[at + 1] ?? 0) - (luma[at - width] ?? 0) - (luma[at + width] ?? 0);
      sum += value;
      squares += value * value;
      count += 1;
    }
  }
  const mean = sum / count;
  return squares / count - mean * mean;
}
