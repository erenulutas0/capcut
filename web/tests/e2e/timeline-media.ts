/**
 * Synthetic media for the single-timeline tests (ADR-019), made with ffmpeg
 * on first use into a gitignored folder. Test pattern pictures and generated
 * tones only: nothing here is real footage.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export const TIMELINE_MEDIA_DIR = join(process.cwd(), 'tests', 'media', 'timeline');

interface Spec {
  name: string;
  durationS: number;
  width: number;
  height: number;
  fps: number;
  audio: boolean;
}

const SPECS = {
  /** Like the user-test video: 1:50, portrait, with sound. */
  portrait: { name: 'portrait-110s.mp4', durationS: 110, width: 360, height: 640, fps: 30, audio: true },
  /** Longer than the old 5-minute output limit (and the memory-route cap), tiny and cheap to make. */
  long: { name: 'long-310s.mp4', durationS: 310, width: 160, height: 90, fps: 5, audio: false },
  /**
   * 90 minutes: over the 60-minute OUTPUT limit, inside the 120-minute input
   * limit (ADR-021). One frame a second at 64x64 keeps it tiny and fast.
   */
  ninety: { name: 'doksan-dakika.mp4', durationS: 5400, width: 64, height: 64, fps: 1, audio: false },
  /**
   * 121 minutes: over the 120-minute source limit, must be rejected on open.
   * (A new name, so an old 61-minute `uzun-video.mp4` from an earlier
   * checkout is never mistaken for it.)
   */
  tooLong: { name: 'cok-uzun-video.mp4', durationS: 7260, width: 64, height: 64, fps: 1, audio: false },
} satisfies Record<string, Spec>;

export type TimelineFixture = keyof typeof SPECS;

export function timelineFixture(name: TimelineFixture): { file: string; durationS: number } {
  const spec: Spec = SPECS[name];
  const file = join(TIMELINE_MEDIA_DIR, spec.name);
  if (existsSync(file)) return { file, durationS: spec.durationS };
  mkdirSync(TIMELINE_MEDIA_DIR, { recursive: true });
  const partial = `${file}.part.mp4`;
  rmSync(partial, { force: true });
  const video = `testsrc2=size=${spec.width}x${spec.height}:rate=${spec.fps}:duration=${spec.durationS}`;
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', video];
  if (spec.audio) {
    args.push('-f', 'lavfi', '-i', `sine=frequency=330:sample_rate=48000:duration=${spec.durationS}`);
  }
  args.push(
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '38',
    '-pix_fmt',
    'yuv420p',
    '-g',
    String(spec.fps * 2),
  );
  if (spec.audio) args.push('-c:a', 'aac', '-b:a', '48k', '-shortest');
  args.push('-movflags', '+faststart', partial);
  execFileSync('ffmpeg', args, { stdio: 'pipe' });
  // Rename only when complete, so an interrupted run never leaves a
  // half-written fixture that later runs would trust.
  renameSync(partial, file);
  return { file, durationS: spec.durationS };
}
