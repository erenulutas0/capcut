/**
 * Reads the frame-number barcode that `scripts/generate-long-media.mjs`
 * burns into its synthetic sources, from any frame of an exported file.
 *
 * The barcode is 20 blocks of 64×48 source pixels across the top-left, bit k
 * in block k, white = 1. An export scales the picture, so block centres are
 * found through the source→output scale (the long sources are 16:9 and are
 * exported to a 16:9 frame, so the scale is uniform).
 */
import { spawnSync } from 'node:child_process';

const BITS = 20;
const BLOCK_W = 64;
const BLOCK_H = 48;

/**
 * Source frame number shown by output frame `frameIndex` of `file`.
 * `sourceWidth` is the width the barcode was drawn at (1920 or 1280).
 */
export function readFrameNumber(file, frameIndex, { fps = 30, sourceWidth = 1920, outputWidth = 1920 } = {}) {
  const scale = outputWidth / sourceWidth;
  const stripW = Math.round(BITS * BLOCK_W * scale);
  const stripH = Math.max(2, Math.round(BLOCK_H * scale));
  // The first frame whose timestamp is at or after this time is `frameIndex`.
  const at = Math.max(0, (frameIndex - 0.25) / fps);
  const result = spawnSync(
    'ffmpeg',
    [
      '-hide_banner', '-loglevel', 'error',
      '-ss', at.toFixed(6), '-i', file,
      '-frames:v', '1',
      '-vf', `crop=${stripW}:${stripH}:0:0,format=gray`,
      '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1',
    ],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.status !== 0 || !result.stdout || result.stdout.length < stripW * stripH) {
    throw new Error(`frame ${frameIndex} could not be read: ${String(result.stderr).slice(0, 300)}`);
  }
  const pixels = result.stdout;
  const y = Math.floor(stripH / 2);
  let value = 0;
  let weakest = 255;
  for (let bit = 0; bit < BITS; bit += 1) {
    // Average a small patch in the middle of each block: compression noise.
    const cx = Math.floor((bit * BLOCK_W + BLOCK_W / 2) * scale);
    let sum = 0;
    let count = 0;
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        sum += pixels[(y + dy) * stripW + (cx + dx)];
        count += 1;
      }
    }
    const lum = sum / count;
    weakest = Math.min(weakest, Math.abs(lum - 128));
    if (lum > 128) value += 2 ** bit;
  }
  return { frame: value, confidence: weakest };
}
