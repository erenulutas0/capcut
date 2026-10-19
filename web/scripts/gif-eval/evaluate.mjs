/**
 * GIF quality evaluation (ADR-046, addendum of 19 October 2026).
 *
 *   node scripts/gif-eval/evaluate.mjs --clips=<local.json> [--set=method|sizes|fps|ten] [--only=R1,S2] [--cand=A,F1]
 *
 * `--clips` is a LOCAL file (never committed) listing the real recordings to
 * measure: [{ "id": "R1", "path": "...", "start": 2 }, …]. Recordings are read
 * for measurement only; nothing derived from them is written outside
 * `web/.scratch/gif-eval/` (gitignored), and they are named by their ids only.
 * The synthetic sources are generated here (ffmpeg lavfi, ids S1–S5).
 *
 * For each clip, size and frame rate: ffmpeg draws the frames the app would
 * draw (rotation applied, Lanczos), every candidate of `candidates.ts` writes a
 * GIF from them, ffmpeg's GIF decoder reads it back, and the decoded frames are
 * compared with the source frames: SSIM, VMAF (v0.6.1), CAMBI (banding) of
 * both, a 5 × 5-blurred PSNR (ADR-046's old measure), and for `--set=sizes`
 * VMAF of what a phone shows (GIF and source both scaled to a 1080-pixel short
 * edge). Rows go to `.scratch/gif-eval/<set>.jsonl`; `summarize.mjs` makes the tables.
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, '..', '..');
const outDir = join(webRoot, '.scratch', 'gif-eval');
const mediaDir = join(outDir, 'media');
const work = join(outDir, 'work');
mkdirSync(mediaDir, { recursive: true });
mkdirSync(work, { recursive: true });

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? '1']));
const set = args.set ?? 'method';
const only = args.only ? new Set(args.only.split(',')) : null;
const candFilter = args.cand ? new Set(args.cand.split(',')) : null;

// ------------------------------------------------------------------ the encoders, bundled

const esbuild = await import('esbuild');
const bundle = join(work, 'candidates.mjs');
await esbuild.build({
  entryPoints: [join(here, 'candidates.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: bundle,
  tsconfig: join(webRoot, 'tsconfig.json'),
  logLevel: 'error',
});
const C = await import(pathToFileURL(bundle).href + `?t=${Date.now()}`);

// ------------------------------------------------------------------ sources

const SYNTHETIC = [
  { id: 'S1', name: 'desen', lavfi: ['-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30:d=12'], vf: 'null' },
  { id: 'S2', name: 'yumusak', lavfi: ['-f', 'lavfi', '-i', 'gradients=s=1280x720:r=30:d=12:speed=0.02:seed=1'], vf: 'noise=alls=4:allf=t' },
  {
    id: 'S3',
    name: 'kaydirma',
    lavfi: ['-f', 'lavfi', '-i', 'mandelbrot=s=1920x720:r=30:end_pts=10000'],
    vf: "crop=1280:720:x='min(640,t*60)':y=0,noise=alls=8:allf=t",
  },
  { id: 'S4', name: 'gurultulu', lavfi: ['-f', 'lavfi', '-i', 'mandelbrot=s=1280x720:r=30'], vf: 'noise=alls=20:allf=t' },
  {
    id: 'S5',
    name: 'kamera-benzeri (dikey, az ışık)',
    lavfi: [
      '-f', 'lavfi', '-i', 'perlin=s=720x1280:r=30:octaves=6:persistence=0.65:xscale=5:yscale=5:tscale=0.5:random_seed=11',
      '-f', 'lavfi', '-i', 'gradients=s=720x1280:r=30:c0=0xc89a7a:c1=0x6a4a3a:c2=0x8f6f5a:c3=0x3a3048:n=4:speed=0.015:seed=4',
    ],
    complex:
      '[0:v]format=gbrp[n];[1:v]format=gbrp[g];[n][g]blend=all_mode=softlight,gblur=sigma=2,' +
      "lutrgb=r='val*0.55':g='val*0.5':b='val*0.5',noise=alls=7:allf=t,format=yuv420p[v]",
  },
];

async function ensureSynthetic(s) {
  const file = join(mediaDir, `${s.id}.mp4`);
  if (existsSync(file)) return file;
  const enc = ['-t', '12', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-pix_fmt', 'yuv420p', '-an'];
  const a = s.complex
    ? ['-y', ...s.lavfi, '-filter_complex', s.complex, '-map', '[v]', ...enc, file]
    : ['-y', ...s.lavfi, '-vf', `${s.vf},format=yuv420p`, ...enc, file];
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...a], { maxBuffer: 1 << 26 });
  return file;
}

/** Display size (rotation applied). */
async function displaySize(path) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:stream_side_data=rotation', '-of', 'json', path]);
  const s = JSON.parse(stdout).streams[0];
  const rot = Math.abs(Number(s.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? 0));
  return rot === 90 || rot === 270 ? { w: s.height, h: s.width } : { w: s.width, h: s.height };
}

/** `planGifSize` of the app, for any long edge. */
function plan(w, h, longEdge) {
  const scale = Math.min(1, longEdge / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

const FPS = { '12.5': { rate: '25/2', delays: [8], value: 12.5 }, 15: { rate: '15', delays: [7, 7, 6], value: 15 } };

async function referenceFrames(clip, size, fps, seconds) {
  const file = join(work, `${clip.id}-${size.width}x${size.height}-${fps.value}-${seconds}.rgba`);
  if (!existsSync(file)) {
    await run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-ss', String(clip.start ?? 0), '-t', String(seconds), '-i', clip.path, '-an',
      '-vf', `fps=${fps.rate},scale=${size.width}:${size.height}:flags=lanczos,format=rgba`,
      '-f', 'rawvideo', file,
    ], { maxBuffer: 1 << 26 });
  }
  const all = readFileSync(file);
  const frameBytes = size.width * size.height * 4;
  const count = Math.min(Math.round(seconds * fps.value), Math.floor(all.length / frameBytes));
  const frames = [];
  for (let i = 0; i < count; i += 1) frames.push(new Uint8Array(all.buffer, all.byteOffset + i * frameBytes, frameBytes).slice());
  return { file, frames };
}

// ------------------------------------------------------------------ metrics

function blurredPsnr(a, b, w, h, frames) {
  // 5 × 5 box blur of R, G, B in both, then PSNR over everything (ADR-046's "bulanık PSNR").
  let se = 0;
  let n = 0;
  const blur = (src, f, c) => {
    const out = new Float32Array(w * h);
    const base = f * w * h * 4;
    const tmp = new Float32Array(w * h);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        let s = 0;
        let k = 0;
        for (let d = -2; d <= 2; d += 1) {
          const xx = x + d;
          if (xx < 0 || xx >= w) continue;
          s += src[base + (y * w + xx) * 4 + c];
          k += 1;
        }
        tmp[y * w + x] = s / k;
      }
    }
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        let s = 0;
        let k = 0;
        for (let d = -2; d <= 2; d += 1) {
          const yy = y + d;
          if (yy < 0 || yy >= h) continue;
          s += tmp[yy * w + x];
          k += 1;
        }
        out[y * w + x] = s / k;
      }
    }
    return out;
  };
  // Every 5th frame is enough for this secondary number.
  for (let f = 0; f < frames; f += 5) {
    for (let c = 0; c < 3; c += 1) {
      const pa = blur(a, f, c);
      const pb = blur(b, f, c);
      for (let i = 0; i < pa.length; i += 1) {
        const d = pa[i] - pb[i];
        se += d * d;
      }
      n += pa.length;
    }
  }
  const mse = se / Math.max(1, n);
  return mse === 0 ? 99 : 10 * Math.log10((255 * 255) / mse);
}

const raw = (file, size, rate) => ['-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${size.width}x${size.height}`, '-framerate', rate, '-i', file];

async function vmafRun(distArgs, refArgs, filterDist, filterRef, logFile, extra = '') {
  const graph =
    `[0:v]${filterDist},setpts=N/(25*TB),split[d1][d2];[1:v]${filterRef},setpts=N/(25*TB),split[r1][r2];` +
    `[d1][r1]ssim;[d2][r2]libvmaf=log_path='${logFile.replace(/\\/g, '/').replace(/:/g, '\\:')}':log_fmt=json:n_threads=4${extra}`;
  const { stderr } = await run('ffmpeg', ['-hide_banner', '-nostats', ...distArgs, ...refArgs, '-lavfi', graph, '-f', 'null', '-'], { maxBuffer: 1 << 26 });
  const ssim = Number(/All:([0-9.]+)/.exec(stderr)?.[1] ?? NaN);
  const log = JSON.parse(readFileSync(logFile, 'utf8'));
  rmSync(logFile, { force: true });
  return { ssim, vmaf: log.pooled_metrics.vmaf.mean, cambi: log.pooled_metrics.cambi?.mean };
}

const refCambi = new Map();

async function measure(gifFile, ref, size, fps, clip, seconds, phone) {
  const decoded = gifFile.replace(/\.gif$/, '.dec.rgba');
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', gifFile, '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgba', decoded], { maxBuffer: 1 << 26 });
  const dec = readFileSync(decoded);
  const frameBytes = size.width * size.height * 4;
  const decFrames = Math.floor(dec.length / frameBytes);
  const refBuf = readFileSync(ref.file);
  const frames = Math.min(decFrames, ref.frames.length);
  const bpsnr = blurredPsnr(dec, refBuf, size.width, size.height, frames);
  const fmt = 'format=yuv444p';
  const m = await vmafRun(raw(decoded, size, '25'), raw(ref.file, size, '25'), fmt, fmt, `${gifFile}.vmaf.json`, ':feature=name=cambi');
  if (!refCambi.has(ref.file)) {
    const r = await vmafRun(raw(ref.file, size, '25'), raw(ref.file, size, '25'), fmt, fmt, `${gifFile}.ref.json`, ':feature=name=cambi');
    refCambi.set(ref.file, r.cambi);
  }
  let vmafPhone;
  let cambiPhone;
  let cambiPhoneRef;
  if (phone) {
    // What a phone shows: the short edge as wide as the screen (1080), from the source's own shape.
    const portrait = phone.h > phone.w;
    const pw = portrait ? 1080 : Math.round((1080 * phone.w) / phone.h / 2) * 2;
    const ph = portrait ? Math.round((1080 * phone.h) / phone.w / 2) * 2 : 1080;
    const src = ['-ss', String(clip.start ?? 0), '-t', String(seconds), '-i', clip.path];
    const srcFilter = `fps=${fps.rate},scale=${pw}:${ph}:flags=lanczos,format=yuv420p`;
    const p = await vmafRun(
      raw(decoded, size, '25'),
      src,
      `scale=${pw}:${ph}:flags=bicubic,format=yuv420p`,
      srcFilter,
      `${gifFile}.tel.json`,
      ':feature=name=cambi',
    );
    vmafPhone = p.vmaf;
    cambiPhone = p.cambi;
    const key = `${clip.id}|${fps.value}|${seconds}`;
    if (!refCambi.has(key)) {
      const r = await vmafRun(src, src, srcFilter, srcFilter, `${gifFile}.telref.json`, ':feature=name=cambi');
      refCambi.set(key, r.cambi);
    }
    cambiPhoneRef = refCambi.get(key);
  }
  rmSync(decoded, { force: true });
  return {
    frames: decFrames, refFrames: ref.frames.length, ssim: m.ssim, vmaf: m.vmaf, cambi: m.cambi, cambiRef: refCambi.get(ref.file), bpsnr,
    vmafPhone, cambiPhone, cambiPhoneRef,
  };
}

// ------------------------------------------------------------------ candidates

const D0 = { kind: 'none' };
const base = { palette: 'global', dither: D0, tolerance: 0, delaysCs: [8] };
const CANDIDATES = [
  { ...base, id: 'A' },
  { ...base, id: 'B-kare', palette: 'perFrame' },
  { ...base, id: 'C-ornek4x', samplePixels: 4 * 8 * 480 * 270 },
  { ...base, id: 'C-kmeans3', refine: 3 },
  { ...base, id: 'D-fs1', dither: { kind: 'fs', strength: 1 } },
  { ...base, id: 'D-fs075', dither: { kind: 'fs', strength: 0.75 } },
  { ...base, id: 'D-fs05', dither: { kind: 'fs', strength: 0.5 } },
  { ...base, id: 'E-bayer12', dither: { kind: 'ordered', map: 'bayer', spread: 12 } },
  { ...base, id: 'E-blue8', dither: { kind: 'ordered', map: 'blue', spread: 8 } },
  { ...base, id: 'E-blue12', dither: { kind: 'ordered', map: 'blue', spread: 12 } },
  { ...base, id: 'E-blue16', dither: { kind: 'ordered', map: 'blue', spread: 16 } },
  { ...base, id: 'E-r2-12', dither: { kind: 'ordered', map: 'r2', spread: 12 } },
  { ...base, id: 'F-T3', tolerance: 3 },
  { ...base, id: 'F-T6', tolerance: 6 },
  { ...base, id: 'G-blue12-T3', dither: { kind: 'ordered', map: 'blue', spread: 12 }, tolerance: 3 },
  { ...base, id: 'G-blue12-T6', dither: { kind: 'ordered', map: 'blue', spread: 12 }, tolerance: 6 },
  { ...base, id: 'G-fs075-T3', dither: { kind: 'fs', strength: 0.75 }, tolerance: 3 },
  { ...base, id: 'G-fs075-T6', dither: { kind: 'fs', strength: 0.75 }, tolerance: 6 },
  { ...base, id: 'H-km3-blue12-T3', refine: 3, dither: { kind: 'ordered', map: 'blue', spread: 12 }, tolerance: 3 },
  { ...base, id: 'H-km3-fs075-T3', refine: 3, dither: { kind: 'fs', strength: 0.75 }, tolerance: 3 },
];
const extra = args.extra ? JSON.parse(readFileSync(args.extra, 'utf8')) : [];
const candidates = [...CANDIDATES, ...extra].filter((c) => !candFilter || candFilter.has(c.id));

// ------------------------------------------------------------------ jobs

const local = args.clips ? JSON.parse(readFileSync(args.clips, 'utf8')) : [];
const clips = [];
for (const s of SYNTHETIC) clips.push({ id: s.id, kind: 'yapay', path: await ensureSynthetic(s), start: 0 });
for (const r of local) clips.push({ id: r.id, kind: r.kind ?? 'gercek', path: r.path, start: r.start ?? 0, maxSeconds: r.maxSeconds });

/** What each set measures: [long edge, fps, seconds, phone view]. */
const SETS = {
  method: [[320, '12.5', 4, false]],
  ten: [[320, '12.5', 10, false], [480, '12.5', 10, false], [640, '12.5', 10, false]],
  sizes: [[320, '12.5', 4, true], [480, '12.5', 4, true], [640, '12.5', 4, true]],
  fps: [[320, '12.5', 4, false], [320, '15', 4, false]],
};
const results = join(outDir, `${set}${args.tag ? `-${args.tag}` : ""}.jsonl`);
if (args.fresh) writeFileSync(results, '');

for (const clip of clips) {
  if (only && !only.has(clip.id)) continue;
  const display = await displaySize(clip.path);
  for (const [longEdge, fpsId, wanted, phone] of SETS[set]) {
    const seconds = Math.min(wanted, clip.maxSeconds ?? wanted);
    const fps = FPS[fpsId];
    const size = plan(display.w, display.h, longEdge);
    const ref = await referenceFrames(clip, size, fps, seconds);
    for (const cand of candidates) {
      const c = { ...cand, delaysCs: fps.delays };
      const encoded = C.encodeCandidate(ref.frames, size.width, size.height, c);
      const gif = join(work, `${clip.id}-${longEdge}-${fpsId}-${seconds}-${c.id}.gif`);
      writeFileSync(gif, encoded.bytes);
      const m = await measure(gif, ref, size, fps, clip, seconds, phone ? display : null);
      rmSync(gif, { force: true });
      const row = {
        set, clip: clip.id, kind: clip.kind, longEdge, fps: fps.value, seconds, width: size.width, height: size.height, cand: c.id,
        bytes: encoded.bytes.length, ms: Math.round(encoded.ms), changed: Number(encoded.changedShare.toFixed(3)), ...m,
      };
      appendFileSync(results, `${JSON.stringify(row)}\n`);
      console.log(
        `${clip.id} ${size.width}x${size.height} ${fps.value} ${seconds}s ${c.id.padEnd(16)} ${(row.bytes / 1e6).toFixed(2)} MB ${row.ms} ms ` +
          `ssim ${m.ssim.toFixed(4)} vmaf ${m.vmaf.toFixed(1)} cambi ${m.cambi?.toFixed(2)} (src ${m.cambiRef?.toFixed(2)}) bpsnr ${m.bpsnr.toFixed(1)}` +
          (m.vmafPhone !== undefined ? ` tel ${m.vmafPhone.toFixed(1)} cambi-tel ${m.cambiPhone?.toFixed(2)} (src ${m.cambiPhoneRef?.toFixed(2)})` : '') +
          (m.frames !== m.refFrames ? ` FRAMES ${m.frames}/${m.refFrames}` : ''),
      );
    }
  }
}
