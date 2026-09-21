/**
 * Generates synthetic local test media with ffmpeg. Nothing is downloaded and
 * no copyrighted material is used; these exist only so browser tests can drive
 * a real file picker. Run: node scripts/generate-test-media.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'media');
mkdirSync(out, { recursive: true });

const run = (args) => execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args]);

// 24 s, 1280x720, 30 fps, H.264/AAC SDR — matches the W0 supported input shape.
run([
  '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=30:duration=24',
  '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=24',
  '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-preset', 'slow', '-crf', '36', '-g', '30',
  '-c:a', 'aac', '-b:a', '64k', '-shortest',
  join(out, 'sample-24s.mp4'),
]);

// A deliberately DIFFERENT video: another duration and another size, used to
// prove that re-linking refuses a file that is not the saved one.
run([
  '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30:duration=8',
  '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000:duration=8',
  '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-preset', 'slow', '-crf', '36', '-g', '30',
  '-c:a', 'aac', '-b:a', '64k', '-shortest',
  join(out, 'other-8s.mp4'),
]);

// 30 s music stand-in: a quiet synthetic tone, not a licensed track.
run([
  '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000:duration=30',
  '-c:a', 'aac', '-b:a', '64k',
  join(out, 'tone-30s.m4a'),
]);

console.log(`test media written to ${out}`);
