/**
 * A tiny synthetic HEVC (H.265) clip for the "no HEVC decoder" import hint
 * (ADR-022), made with ffmpeg (libx265) on first use into a gitignored
 * folder. Test pattern and a tone only: no real footage.
 *
 * Whether it opens depends on the browser: Chrome on this machine decodes
 * HEVC, Edge and Playwright's Chromium have no decoder (ADR-022). The tests
 * ask the browser first and run only where there is none, because that is
 * the only case the hint is for.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';

export const HEVC_MEDIA_DIR = join(process.cwd(), 'tests', 'media', 'hevc');

export function hevcFixture(): string {
  const file = join(HEVC_MEDIA_DIR, 'telefon-hevc.mp4');
  if (existsSync(file)) return file;
  mkdirSync(HEVC_MEDIA_DIR, { recursive: true });
  const partial = `${file}.part.mp4`;
  rmSync(partial, { force: true });
  execFileSync(
    'ffmpeg',
    [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=30:duration=2',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2',
      '-c:v', 'libx265', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-x265-params', 'log-level=error',
      // `hvc1`, as phones write it (Apple and most Android recorders).
      '-tag:v', 'hvc1',
      '-c:a', 'aac', '-b:a', '64k', '-shortest', '-movflags', '+faststart', partial,
    ],
    { stdio: 'pipe' },
  );
  renameSync(partial, file);
  return file;
}

/**
 * Does this browser say it can decode HEVC (Main profile, the levels a small
 * clip or a phone recording uses)? Asked both ways the app can meet it: the
 * `<video>` element and WebCodecs.
 */
export function browserDecodesHevc(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    const codecs = ['hvc1.1.6.L60.90', 'hvc1.1.6.L63.90', 'hvc1.1.6.L93.B0', 'hvc1.1.6.L120.90'];
    const video = document.createElement('video');
    if (codecs.some((codec) => video.canPlayType(`video/mp4; codecs="${codec}"`) !== '')) return true;
    if (typeof VideoDecoder === 'undefined') return false;
    for (const codec of codecs) {
      const support = await VideoDecoder.isConfigSupported({ codec, codedWidth: 320, codedHeight: 240 });
      if (support.supported) return true;
    }
    return false;
  });
}
