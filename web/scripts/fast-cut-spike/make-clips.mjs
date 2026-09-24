/**
 * Synthetic H.264 sources for the fast-cut spike (ADR-027), made with ffmpeg
 * into the gitignored `tests/media/fastcut/`. Test pattern pictures and
 * generated tones only.
 *
 * Every frame carries its number as the same 20-bit barcode the long sources
 * use (`scripts/lib/frame-barcode.mjs`); the audio is a quiet tone with a
 * 5 ms 1 kHz click at every whole second, so audio/video sync can be measured
 * against the frame that starts at that second.
 *
 *   node scripts/fast-cut-spike/make-clips.mjs
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
export const CLIP_DIR = join(root, 'tests', 'media', 'fastcut');

const BITS = 20;
const BLOCK_W = 64;
const BLOCK_H = 48;

/**
 * name -> spec. `x264` is appended to libx264; `rate` is the frame rate;
 * `rotate` sets display rotation metadata (the pictures stay landscape).
 */
export const CLIPS = {
  // Like the long source and most cameras: High, 3 B-frames, 2 s closed GOP.
  'fc-1080p30-bframes.mp4': { w: 1920, h: 1080, rate: '30', seconds: 20, x264: 'bframes=3:keyint=60:min-keyint=60:scenecut=0', profile: 'high' },
  // Phones without B-frames (iPhone baseline, many Android files): 1 s GOP.
  'fc-1080p30-noB.mp4': { w: 1920, h: 1080, rate: '30', seconds: 20, x264: 'bframes=0:keyint=30:min-keyint=30:scenecut=0', profile: 'baseline' },
  // Open GOP: I-frames that are not IDR, B-frames referencing across them; 29.97 fps, 720p.
  'fc-720p2997-opengop.mp4': { w: 1280, h: 720, rate: '30000/1001', seconds: 20, x264: 'bframes=2:keyint=48:min-keyint=12:open-gop=1:idrint=4', profile: 'main' },
  // Vertical phone video stored landscape with rotation metadata.
  'fc-1080x1920-rot90.mp4': { w: 1920, h: 1080, rate: '30', seconds: 20, x264: 'bframes=2:keyint=60:min-keyint=60:scenecut=0', profile: 'high', rotate: 90 },
  // Deep reordering (strict pyramid, 4 refs, weighted B) and a long 8 s GOP.
  'fc-1080p30-pyramid-longgop.mp4': { w: 1920, h: 1080, rate: '30', seconds: 20, x264: 'bframes=4:b-pyramid=strict:ref=4:keyint=240:min-keyint=240:scenecut=0', profile: 'high' },
  // SPS/PPS repeated inside the packets (like the GoPro file).
  'fc-1080p30-inband.mp4': { w: 1920, h: 1080, rate: '30', seconds: 20, x264: 'bframes=3:keyint=60:min-keyint=60:scenecut=0:repeat-headers=1', profile: 'high' },
  // A 25 fps (PAL rate) source at 720p: slower than the 30 fps download.
  'fc-720p25.mp4': { w: 1280, h: 720, rate: '25', seconds: 20, x264: 'bframes=3:keyint=50:min-keyint=50:scenecut=0', profile: 'high' },
};

function barcodeChain(w, h) {
  const bits = Array.from(
    { length: BITS },
    (_, k) =>
      `drawbox=x=${k * BLOCK_W}:y=0:w=${BLOCK_W}:h=${BLOCK_H}:color=white:t=fill:enable='mod(floor(n/${2 ** k}),2)'`,
  );
  return [
    'noise=alls=10:allf=t+u',
    `drawbox=x=0:y=0:w=${BITS * BLOCK_W}:h=${BLOCK_H}:color=black:t=fill`,
    ...bits,
    `drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='%{pts\\:hms}  #%{frame_num}':x=40:y=${BLOCK_H + 24}:fontsize=${Math.round(h / 16)}:fontcolor=white:box=1:boxcolor=black@0.8:boxborderw=12`,
  ].join(',');
}

function run(args) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`ffmpeg: ${result.stderr}`);
}

export function makeClips(names = Object.keys(CLIPS)) {
  mkdirSync(CLIP_DIR, { recursive: true });
  for (const name of names) {
    const spec = CLIPS[name];
    const file = join(CLIP_DIR, name);
    if (existsSync(file)) continue;
    const partial = `${file}.part.mp4`;
    rmSync(partial, { force: true });
    const audio = `0.05*sin(2*PI*220*t)+if(lt(mod(t,1),0.005),0.8*sin(2*PI*1000*t),0)`;
    run([
      '-f', 'lavfi', '-i', `testsrc2=size=${spec.w}x${spec.h}:rate=${spec.rate}:duration=${spec.seconds}`,
      '-f', 'lavfi', '-i', `aevalsrc=exprs=${audio.replace(/,/g, '\\,')}:sample_rate=48000:duration=${spec.seconds}`,
      '-filter_complex', `[0:v]${barcodeChain(spec.w, spec.h)}[v]`,
      '-map', '[v]', '-map', '1:a',
      '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', spec.profile, '-pix_fmt', 'yuv420p',
      '-x264-params', spec.x264, '-b:v', '6M',
      '-c:a', 'aac', '-b:a', '128k',
      partial,
    ]);
    if (spec.rotate) {
      const rotated = `${file}.rot.mp4`;
      run(['-display_rotation:v:0', String(spec.rotate), '-i', partial, '-c', 'copy', rotated]);
      rmSync(partial, { force: true });
      renameSync(rotated, file);
    } else {
      renameSync(partial, file);
    }
    console.log(`hazır: ${name}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  makeClips();
}
