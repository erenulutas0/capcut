/**
 * Sources for the speed and memory measurements of "İyileştir" (ADR-037).
 *
 *   node scripts/enhance-eval/make-speed-media.mjs
 *
 * Into tests/media/enhance/speed/ (gitignored). Generated pictures only (the
 * same fractal-noise scene as the e2e fixtures), 1920 × 1080, 30 fps, with a
 * tone:
 *
 *   karanlik-1080p-10s.mp4     about two stops dark: only the light-and-colour pass runs
 *   bulanik-1080p-10s.mp4      dark and out of focus: light-and-colour + sharpening
 *   kumlu-1080p-10s.mp4        dark, out of focus and grainy: all three passes
 *   kumlu-1080p-5dk.mp4        the last one thirty times in a row (stream copy): five minutes
 *   iyi-1080p-10s.mp4          well exposed and sharp: the plan is "nothing to do"
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { setDir } from './lib.mjs';

const out = join(setDir, 'speed');
mkdirSync(out, { recursive: true });

const SIZE = '1920x1080';
const SECONDS = 10;
const scene =
  '[0:v]format=gbrp[n];[1:v]format=gbrp[g];[n][g]blend=all_mode=overlay,eq=contrast=1.3,' +
  'drawgrid=w=480:h=360:t=4:c=white@0.55,drawbox=x=180:y=150:w=270:h=180:c=black@0.75:t=fill,' +
  'drawbox=x=1260:y=630:w=360:h=240:c=white@0.8:t=fill,noise=alls=4:allf=t';
const dark = "lutrgb=r='val*0.5':g='val*0.5':b='val*0.5'";

const SPECS = {
  'iyi-1080p-10s.mp4': '',
  'karanlik-1080p-10s.mp4': `,${dark}`,
  'bulanik-1080p-10s.mp4': `,gblur=sigma=2.5,${dark}`,
  'kumlu-1080p-10s.mp4': `,gblur=sigma=2.5,${dark},noise=alls=12:allf=t`,
};

for (const [name, filter] of Object.entries(SPECS)) {
  const file = join(out, name);
  if (existsSync(file)) continue;
  const partial = `${file}.part.mp4`;
  rmSync(partial, { force: true });
  execFileSync(
    'ffmpeg',
    [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', `perlin=s=${SIZE}:r=30:octaves=6:persistence=0.65:xscale=9:yscale=9:tscale=0.4:random_seed=7`,
      '-f', 'lavfi', '-i', `gradients=s=${SIZE}:r=30:c0=0x5a6f8f:c1=0xc9b89a:c2=0x6f8f6a:c3=0x9a7070:n=4:speed=0.01:seed=3`,
      '-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=48000:duration=${SECONDS}`,
      '-filter_complex', `${scene}${filter},scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[v]`,
      '-map', '[v]', '-map', '2:a', '-t', String(SECONDS),
      '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'veryfast', '-crf', '16', '-pix_fmt', 'yuv420p', '-g', '30',
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
      '-c:a', 'aac', '-b:a', '128k', '-shortest', partial,
    ],
    { stdio: 'inherit' },
  );
  renameSync(partial, file);
  console.log(name);
}

// Five minutes: the grainy clip thirty times, copied (no re-encode), like one long recording.
const long = join(out, 'kumlu-1080p-5dk.mp4');
if (!existsSync(long)) {
  const list = join(out, 'list.txt');
  writeFileSync(list, Array.from({ length: 30 }, () => "file 'kumlu-1080p-10s.mp4'").join('\n'));
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', long], { stdio: 'inherit' });
  rmSync(list, { force: true });
  console.log('kumlu-1080p-5dk.mp4');
}
