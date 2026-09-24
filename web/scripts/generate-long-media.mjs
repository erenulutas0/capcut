/**
 * Synthetic long sources for the 120-minute input limit (ADR-021), made with
 * ffmpeg into the gitignored `tests/media/long/`. Test pattern pictures and
 * generated tones only: nothing here is real footage or speech.
 *
 * Every frame carries its own number twice:
 * - a 20-bit barcode across the top-left (64×48 px blocks, bit k at block k,
 *   white = 1), which `scripts/lib/frame-barcode.mjs` reads back from an
 *   exported file, so frame accuracy is checked by machine;
 * - the source time as burned text, for people looking at a frame.
 *
 * The audio is speech-like: a harmonic buzz with a 4 Hz syllable envelope in
 * bursts, with a 1.5 s pause, a 0.3 s pause and another 1.5 s pause every
 * 13 s, over a quiet noise floor — work for the silence detector.
 *
 * There is no `+faststart`: like a phone recording, the index (moov) sits at
 * the END of the file, so opening it reads the tail of a multi-GiB file.
 *
 *   node scripts/generate-long-media.mjs                 # 120 min 1080p + 720p
 *   node scripts/generate-long-media.mjs --only=1080     # one of them
 *   node scripts/generate-long-media.mjs --only=big      # >4 GiB, 60 min 1080p (byte-limit evidence)
 *   node scripts/generate-long-media.mjs --only=edges    # just under / just over 4 GiB, cut from `big` (ADR-025)
 *   node scripts/generate-long-media.mjs --seconds=20 --only=1080   # quick check of the filter graph
 *   node scripts/generate-long-media.mjs --only=rot90    # 1080p coded landscape, displayed portrait
 *                                                         # (rotation metadata, like a phone; ADR-028)
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { constants, setPriority } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const out = join(root, 'tests', 'media', 'long');
mkdirSync(out, { recursive: true });

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const found = args.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};
const only = argValue('only', '1080,720').split(',');
const secondsOverride = argValue('seconds', '');

/** Bits in the barcode: 2^20 frames is 9.7 hours at 30 fps. */
export const BARCODE_BITS = 20;
export const BARCODE_BLOCK_W = 64;
export const BARCODE_BLOCK_H = 48;

const SPECS = {
  1080: {
    name: 'long-120min-1080p.mp4',
    width: 1920,
    height: 1080,
    seconds: 7200,
    // Two hours in ~1.7 GiB with audio (under 2 GiB, the byte limit until v4).
    video: ['-b:v', '1800k', '-maxrate', '2200k', '-bufsize', '4400k'],
    noise: false,
  },
  720: {
    name: 'long-120min-720p.mp4',
    width: 1280,
    height: 720,
    seconds: 7200,
    video: ['-b:v', '1100k', '-maxrate', '1400k', '-bufsize', '2800k'],
    noise: false,
  },
  // A phone held upright: coded 1920×1080, shown 1080×1920 through the
  // container's rotation (display matrix), so the export draws it rotated
  // (ADR-028). The barcode is rotated with the picture.
  rot90: {
    name: 'long-120min-1080p-rot90.mp4',
    width: 1920,
    height: 1080,
    seconds: 7200,
    video: ['-b:v', '1800k', '-maxrate', '2200k', '-bufsize', '4400k'],
    noise: false,
    rotate: 90,
  },
  // Over 4 GiB on purpose (byte-limit evidence, ADR-021 and ADR-025):
  // 60 minutes of noisy 1080p at ~10.5 Mbit/s.
  big: {
    name: 'big-60min-1080p-4gib.mp4',
    width: 1920,
    height: 1080,
    seconds: 3600,
    video: ['-b:v', '10500k', '-minrate', '9500k', '-maxrate', '11500k', '-bufsize', '21000k'],
    noise: true,
  },
};

const PAUSES = 'lt(mod(t,13),4)+gte(mod(t,13),5.5)*lt(mod(t,13),9)+gte(mod(t,13),9.3)*lt(mod(t,13),11.5)';
const VOICE = '(sin(2*PI*180*t)+0.5*sin(2*PI*360*t)+0.25*sin(2*PI*720*t))*(0.6+0.4*sin(2*PI*4*t))';
const AUDIO = `0.18*${VOICE}*(${PAUSES})+0.002*(2*random(0)-1)`;

const escapeArg = (value) => value.replace(/,/g, '\\,');

function run(ffArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ffArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
    // Below normal: other work on this machine keeps its share of the CPU.
    try {
      setPriority(child.pid, constants.priority.PRIORITY_BELOW_NORMAL);
    } catch {
      // Not fatal: only the scheduling hint failed.
    }
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}: ${stderr}`))));
  });
}

/**
 * `--only=edges` (ADR-025): a file just UNDER and one just OVER the 4 GiB
 * total, cut from the start of the big file by stream copy (no re-encode:
 * same frames, same barcodes, index still at the end). The cut points follow
 * from the big file's own bytes per second, then the sizes are checked.
 */
const GIB = 1073741824;
const EDGES = [
  { name: 'under-4gib-1080p.mp4', targetBytes: 4 * GIB - 40 * 1048576, under: true },
  { name: 'over-4gib-1080p.mp4', targetBytes: 4 * GIB + 8 * 1048576, under: false },
];

async function makeEdges() {
  const big = join(out, SPECS.big.name);
  if (!existsSync(big)) throw new Error(`önce --only=big: ${big}`);
  const bytesPerSecond = statSync(big).size / SPECS.big.seconds;
  for (const edge of EDGES) {
    const file = join(out, edge.name);
    if (!existsSync(file)) {
      const seconds = Math.round(edge.targetBytes / bytesPerSecond);
      const partial = `${file}.part.mp4`;
      rmSync(partial, { force: true });
      console.log(`kesiliyor: ${edge.name} (ilk ${seconds} s, akış kopyası)…`);
      await run(['-hide_banner', '-loglevel', 'error', '-y', '-i', big, '-t', String(seconds), '-map', '0', '-c', 'copy', partial]);
      renameSync(partial, file);
    }
    const size = statSync(file).size;
    const ok = edge.under ? size <= 4 * GIB : size > 4 * GIB;
    console.log(`${ok ? 'hazır' : 'YANLIŞ BOYUT'}: ${file} — ${size} byte (${(size / GIB).toFixed(4)} GiB, 4 GiB ${edge.under ? 'altı' : 'üstü'} olmalı)`);
    if (!ok) process.exitCode = 1;
  }
}

for (const key of only) {
  if (key === 'edges') {
    await makeEdges();
    continue;
  }
  const spec = SPECS[key];
  if (!spec) throw new Error(`unknown --only value: ${key}`);
  const seconds = secondsOverride ? Number(secondsOverride) : spec.seconds;
  const name = secondsOverride ? spec.name.replace('.mp4', `-${seconds}s.mp4`) : spec.name;
  const file = join(out, name);
  if (existsSync(file)) {
    console.log(`var: ${file} (${(statSync(file).size / 1048576).toFixed(1)} MiB)`);
    continue;
  }
  const partial = `${file}.part.mp4`;
  rmSync(partial, { force: true });

  const barW = BARCODE_BITS * BARCODE_BLOCK_W;
  // A black strip, then one white box per set bit (`enable` is evaluated per
  // frame with the frame number `n`). Much cheaper than overlaying a stream.
  const bits = Array.from(
    { length: BARCODE_BITS },
    (_, k) =>
      `drawbox=x=${k * BARCODE_BLOCK_W}:y=0:w=${BARCODE_BLOCK_W}:h=${BARCODE_BLOCK_H}:color=white:t=fill:enable='mod(floor(n/${2 ** k}),2)'`,
  );
  const chain = [
    ...(spec.noise ? ['noise=alls=18:allf=t+u'] : []),
    `drawbox=x=0:y=0:w=${barW}:h=${BARCODE_BLOCK_H}:color=black:t=fill`,
    ...bits,
    `drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='%{pts\\:hms}  #%{frame_num}':x=40:y=${BARCODE_BLOCK_H + 24}:fontsize=${Math.round(spec.height / 16)}:fontcolor=white:box=1:boxcolor=black@0.8:boxborderw=12`,
  ];
  const graph = `[0:v]${chain.join(',')}[v]`;

  const started = Date.now();
  console.log(`üretiliyor: ${name} (${seconds} s, ${spec.width}x${spec.height})…`);
  await run([
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `testsrc2=size=${spec.width}x${spec.height}:rate=30:duration=${seconds}`,
    '-f', 'lavfi', '-i', `aevalsrc=exprs=${escapeArg(AUDIO)}:sample_rate=48000:duration=${seconds}`,
    '-filter_complex', graph,
    '-map', '[v]', '-map', '1:a',
    '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-g', '60',
    ...spec.video,
    '-c:a', 'aac', '-b:a', '96k', '-ac', '1',
    partial,
  ]);
  if (spec.rotate) {
    // Stream copy with a display matrix: same frames, shown rotated.
    const rotated = `${file}.rot.mp4`;
    rmSync(rotated, { force: true });
    await run(['-hide_banner', '-loglevel', 'error', '-y', '-display_rotation:v:0', String(spec.rotate), '-i', partial, '-map', '0', '-c', 'copy', rotated]);
    rmSync(partial, { force: true });
    renameSync(rotated, partial);
  }
  renameSync(partial, file);
  console.log(
    `hazır: ${file} — ${(statSync(file).size / 1048576).toFixed(1)} MiB, ${((Date.now() - started) / 60000).toFixed(1)} dk`,
  );
}
