/**
 * Synthetic HDR clip for the HDR -> SDR test (ADR-022), made with ffmpeg on
 * first use into a gitignored folder: a test pattern placed in PQ the
 * standard way (SDR white = 203 cd/m²) plus a neutral 1000 cd/m² box, as
 * 10-bit VP9 profile 2 that every Chromium decodes in software. No real footage.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export const HDR_MEDIA_DIR = join(process.cwd(), 'tests', 'media', 'hdr');

export function hdrFixture(): string {
  const file = join(HDR_MEDIA_DIR, 'pq-2s.mp4');
  if (existsSync(file)) return file;
  mkdirSync(HDR_MEDIA_DIR, { recursive: true });
  const partial = `${file}.part.mp4`;
  rmSync(partial, { force: true });
  const toPq = (npl: number) =>
    `format=gbrpf32le,zscale=tin=iec61966-2-1:pin=bt709:min=gbr:rin=pc:t=linear:p=bt709:m=gbr:r=pc:npl=${npl},` +
    `zscale=p=bt2020:t=smpte2084:m=2020_ncl:r=limited:npl=${npl},format=yuv420p10le`;
  const graph =
    `[0:v]${toPq(203)}[base];` +
    `color=c=white:size=144x80:rate=30:duration=2,${toPq(1000)}[box];` +
    '[base][box]overlay=x=W*0.72:y=H*0.08:format=yuv420p10,' +
    'setparams=color_primaries=bt2020:color_trc=smpte2084:colorspace=bt2020nc:range=tv[v]';
  execFileSync(
    'ffmpeg',
    [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=2',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2',
      '-filter_complex', graph, '-map', '[v]', '-map', '1:a',
      '-c:v', 'libvpx-vp9', '-profile:v', '2', '-pix_fmt', 'yuv420p10le', '-b:v', '0', '-crf', '32',
      '-deadline', 'realtime', '-cpu-used', '8', '-g', '30',
      '-c:a', 'aac', '-b:a', '64k', '-shortest', partial,
    ],
    { stdio: 'pipe' },
  );
  renameSync(partial, file);
  return file;
}
