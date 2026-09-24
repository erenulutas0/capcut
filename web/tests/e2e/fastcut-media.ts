/**
 * Synthetic sources for the fast-cut e2e test (ADR-027), made with ffmpeg on
 * first use into a gitignored folder: 10 s of 1280x720 H.264 (High,
 * 3 B-frames, an IDR every second) whose every frame carries its number as a
 * 20-bit barcode (the long sources' barcode, scripts/lib/frame-barcode.mjs),
 * plus a quiet tone. No real footage.
 *
 * The checks decode with ffmpeg only, so they do not trust our muxer.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export const FASTCUT_MEDIA_DIR = join(process.cwd(), 'tests', 'media', 'fastcut');

/**
 * `rate`: 30 (default), 25 (slower than the download: copied at its own
 * rate, doc 15 v6) or 60 (faster: encoded to 30 fps). IDR every second.
 */
export function fastCutFixture(rate: 25 | 30 | 60 = 30): string {
  const file = join(FASTCUT_MEDIA_DIR, rate === 30 ? 'e2e-720p30-barcode.mp4' : `e2e-720p${rate}-barcode.mp4`);
  if (existsSync(file)) return file;
  mkdirSync(FASTCUT_MEDIA_DIR, { recursive: true });
  const partial = `${file}.part.mp4`;
  rmSync(partial, { force: true });
  const bits = Array.from(
    { length: 20 },
    (_, k) => `drawbox=x=${k * 64}:y=0:w=64:h=48:color=white:t=fill:enable='mod(floor(n/${2 ** k}),2)'`,
  );
  const chain = ['noise=alls=8:allf=t+u', 'drawbox=x=0:y=0:w=1280:h=48:color=black:t=fill', ...bits].join(',');
  execFileSync(
    'ffmpeg',
    [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', `testsrc2=size=1280x720:rate=${rate}:duration=10`,
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=10',
      '-filter_complex', `[0:v]${chain}[v]`, '-map', '[v]', '-map', '1:a',
      '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
      '-x264-params', `bframes=3:keyint=${rate}:min-keyint=${rate}:scenecut=0`, '-b:v', '3M',
      '-c:a', 'aac', '-b:a', '96k', partial,
    ],
    { stdio: 'pipe' },
  );
  renameSync(partial, file);
  return file;
}

/** Frame number from the barcode of every frame of `file`, in order. */
export function barcodeFrames(file: string): number[] {
  const raw = execFileSync(
    'ffmpeg',
    [
      '-hide_banner', '-loglevel', 'error', '-i', file, '-map', '0:v:0',
      '-vf', 'crop=1280:48:0:0,format=gray', '-fps_mode', 'passthrough',
      '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1',
    ],
    { maxBuffer: 512 * 1024 * 1024 },
  );
  const size = 1280 * 48;
  const frames: number[] = [];
  for (let offset = 0; offset + size <= raw.length; offset += size) {
    let value = 0;
    for (let bit = 0; bit < 20; bit += 1) {
      let sum = 0;
      for (let dx = -4; dx <= 4; dx += 1) sum += raw[offset + 24 * 1280 + bit * 64 + 32 + dx] ?? 0;
      if (sum / 9 > 128) value += 2 ** bit;
    }
    frames.push(value);
  }
  return frames;
}

/** md5 of every decoded frame, in presentation order. */
export function frameMd5s(file: string): string[] {
  const out = execFileSync(
    'ffmpeg',
    ['-hide_banner', '-loglevel', 'error', '-i', file, '-map', '0:v:0', '-fps_mode', 'passthrough', '-f', 'framemd5', '-'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  return out
    .split('\n')
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split(',').pop()?.trim() ?? '');
}

/** Packet count and container duration from ffprobe. */
export function probeFrames(file: string): { frames: number; durationS: number } {
  const out = execFileSync(
    'ffprobe',
    ['-v', 'error', '-select_streams', 'v:0', '-count_packets', '-show_entries', 'stream=nb_read_packets:format=duration', '-of', 'json', file],
    { encoding: 'utf8' },
  );
  const json = JSON.parse(out) as { streams: { nb_read_packets: string }[]; format: { duration: string } };
  return { frames: Number(json.streams[0]?.nb_read_packets), durationS: Number(json.format.duration) };
}
