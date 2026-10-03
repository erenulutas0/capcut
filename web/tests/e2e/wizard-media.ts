/**
 * Synthetic sources for the task-wizard tests (ADR-034), made with ffmpeg on
 * first use into a gitignored folder. Test patterns and generated tones
 * only: nothing here is real footage or speech.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export const WIZARD_MEDIA_DIR = join(process.cwd(), 'tests', 'media', 'wizard');

const TONE = '0.25*sin(2*PI*440*t)';

const SPECS = {
  /** A picture and no sound at all: "Boşlukları at" has nothing to listen to. */
  noAudio: {
    name: 'sessiz-film.mp4',
    args: ['-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=30:duration=2', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p'],
  },
  /** Already 9:16 (360 × 640): "Dikey yap" has nothing to decide. */
  vertical: {
    name: 'dikey-telefon.mp4',
    args: [
      '-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=30:duration=2',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2',
      '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
    ],
  },
  /**
   * Speech-like tone with 0.5 s pauses only (1.5 s on, 0.5 s off, 6 s): the
   * default finds nothing (a gap is 0.7 s or more), "Kısa duraksamalar da"
   * (0.4 s) finds them.
   */
  shortGaps: {
    name: 'kisa-duraksamalar.mp4',
    args: [
      '-f', 'lavfi', '-i', 'color=c=black:s=160x120:r=30:d=6',
      '-f', 'lavfi', '-i', `aevalsrc=exprs=${`${TONE}*lt(mod(t,2),1.5)`.replace(/,/g, '\\,')}:s=48000:d=6`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
    ],
  },
  /** VP9 + Opus in WebM: opens in Chromium, but is not the MP4 every device plays. */
  webm: {
    name: 'tarayici-kaydi.webm',
    args: [
      '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=2',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2',
      '-c:v', 'libvpx-vp9', '-b:v', '600k', '-deadline', 'realtime', '-cpu-used', '8', '-pix_fmt', 'yuv420p',
      '-c:a', 'libopus', '-b:a', '64k', '-shortest',
    ],
  },
} as const;

export type WizardFixture = keyof typeof SPECS;

export function wizardFixture(name: WizardFixture): string {
  const spec = SPECS[name];
  const file = join(WIZARD_MEDIA_DIR, spec.name);
  if (existsSync(file)) return file;
  mkdirSync(WIZARD_MEDIA_DIR, { recursive: true });
  const extension = spec.name.slice(spec.name.lastIndexOf('.'));
  const partial = `${file}.part${extension}`;
  rmSync(partial, { force: true });
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...spec.args, partial], { stdio: 'pipe' });
  // Rename only when complete: an interrupted run never leaves half a fixture.
  renameSync(partial, file);
  return file;
}

/** Mean luma (0–255) of a horizontal band of one frame: is it picture, or the black of a letterbox? */
export function bandLuma(file: string, atS: number, band: { y: number; height: number }): number {
  const result = spawnSync(
    'ffmpeg',
    [
      '-hide_banner', '-loglevel', 'error', '-ss', atS.toFixed(3), '-i', file, '-frames:v', '1',
      '-vf', `crop=iw:${band.height}:0:${band.y},scale=1:1:flags=area,format=gray`, '-f', 'rawvideo', 'pipe:1',
    ],
    { maxBuffer: 1024 * 1024 },
  );
  const bytes = result.stdout as unknown as Buffer;
  if (result.status !== 0 || bytes.length < 1) throw new Error(`ffmpeg failed: ${String(result.stderr)}`);
  return bytes[0] ?? 0;
}

/** Mean volume of the file's sound in dBFS, by ffmpeg; −Infinity for digital silence or no sound. */
export function meanVolumeDb(file: string): number {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-map', '0:a:0', '-af', 'volumedetect', '-f', 'null', '-'], {
    encoding: 'utf8',
  });
  const match = /mean_volume:\s*(-?[\d.]+|-inf) dB/.exec(result.stderr ?? '');
  if (!match || match[1] === '-inf') return Number.NEGATIVE_INFINITY;
  return Number(match[1]);
}
