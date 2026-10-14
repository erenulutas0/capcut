/**
 * ADR-045: variable against constant bitrate in the ORDINARY download, through the real app.
 *
 *   node scripts/generate-matrix-media.mjs                 # the matrix's own sources (once)
 *   node scripts/measure-bitrate-mode.mjs --generate       # this measurement's four sources (once)
 *   node scripts/measure-bitrate-mode.mjs --browser=chromium|chrome|edge [--case=GURULTU,SLAYT]
 *
 * Every case is downloaded twice through the editor's own button, as a full encode
 * (`__clipExportMode = 'encode'`): once with `__clipBitrateMode = 'variable'`, once with
 * `'constant'`. Nothing else differs — the bitrate is the app's own (plan, source cap, ADR-024).
 * Per file: written ÷ asked (video packet bytes over the stream's length, against the bitrate
 * the result line reports), file bytes, mean SSIM, worst-frame SSIM and mean VMAF against a
 * lossless ffmpeg reference of the same edit (`buildReference`, made without the app).
 *
 * The browser part holds the machine-wide measurement lock (`lib/measure-lock.mjs`); the
 * scoring (ffmpeg, VMAF) runs after it is released. Server: SHOT_URL, or :3100. Results:
 * `matrix-results/cbr/<browser>.json`. Sources are generated (ffmpeg), never recordings.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

import { createDriver } from './lib/matrix-driver.mjs';
import { acquire, release } from './lib/measure-lock.mjs';
import { buildReference, ffprobeJson, perFrameSsim } from './lib/media-measure.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const found = args.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};
const browserName = argValue('browser', 'chromium');
const only = argValue('case', '').split(',').filter(Boolean);
// `--label=a`: a separate result file (and work folder), so runs of different cases do not overwrite each other.
const label = argValue('label', '');
const baseURL = process.env.SHOT_URL ?? 'http://127.0.0.1:3100';
const matrixDir = join(root, 'tests', 'media', 'matrix');
const outDir = join(root, 'matrix-results', 'cbr');
const ownDir = join(outDir, 'media');
const workDir = join(outDir, `work-${browserName}${label ? `-${label}` : ''}`);
const refDir = join(outDir, 'references');
for (const dir of [outDir, ownDir, workDir, refDir]) mkdirSync(dir, { recursive: true });

/* ------------------------------------------------------------------ sources */

function ff(ffArgs, label) {
  const result = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...ffArgs], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`ffmpeg failed for ${label}: ${(result.stderr || '').slice(0, 600)}`);
}

const X264_SOURCE = ['-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '16', '-g', '60'];
const AAC = ['-c:a', 'aac', '-b:a', '96k'];
const tone = (seconds) => ['-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=48000:duration=${seconds}`];

/**
 * Camera-like texture (fractal noise over soft colour gradients, a little grain, as M23 but
 * properly exposed) on a canvas 1.5 times the frame, panned across in bursts: still for
 * `period - burst` seconds, then swept quickly for `burst` seconds.
 */
function textureClip(file, { width, height, fps, seconds, period, burst, seed }) {
  const big = [Math.round((width * 1.5) / 2) * 2, Math.round((height * 1.5) / 2) * 2];
  const gate = `gte(mod(t\\,${period})\\,${period - burst})`;
  const x = `(iw-ow)/2+(iw-ow)/2*0.95*sin(2*PI*1.4*t)*${gate}`;
  const y = `(ih-oh)/2+(ih-oh)/2*0.9*cos(2*PI*1.1*t)*${gate}`;
  ff(
    [
      '-f', 'lavfi', '-i', `perlin=s=${big[0]}x${big[1]}:r=${fps}:octaves=6:persistence=0.6:xscale=5:yscale=5:tscale=0.3:random_seed=${seed}`,
      '-f', 'lavfi', '-i', `gradients=s=${big[0]}x${big[1]}:r=${fps}:c0=0x8aa0c0:c1=0xe8d8b8:c2=0x90b088:c3=0xc09090:n=4:speed=0.01:seed=${seed}`,
      ...tone(seconds),
      '-filter_complex',
      `[0:v]format=gbrp[n];[1:v]format=gbrp[g];[n][g]blend=all_mode=overlay,eq=contrast=1.25,` +
        `drawgrid=w=240:h=180:t=2:c=white@0.4,noise=alls=6:allf=t,` +
        `crop=w=${width}:h=${height}:x='${x}':y='${y}',format=yuv420p[v]`,
      '-map', '[v]', '-map', '2:a', '-t', String(seconds),
      ...X264_SOURCE, ...AAC, '-shortest', file,
    ],
    file,
  );
}

/** Screen-recording-like: a flat page, rows of "text" bars that change every 5 s, a small moving pointer. */
function slidesClip(file, { seconds }) {
  const boxes = [];
  for (let slide = 0; slide < Math.ceil(seconds / 5); slide += 1) {
    const on = `enable='between(t\\,${slide * 5}\\,${slide * 5 + 4.999})'`;
    const shade = ['0x1f4e79', '0x7a2e2e', '0x2e6b3a', '0x5a3d7a'][slide % 4];
    boxes.push(`drawbox=x=0:y=0:w=1920:h=140:c=${shade}:t=fill:${on}`);
    for (let row = 0; row < 9; row += 1) {
      const width = 500 + ((slide * 7 + row * 13) % 9) * 130;
      boxes.push(`drawbox=x=160:y=${240 + row * 80}:w=${width}:h=26:c=0x303030:t=fill:${on}`);
    }
  }
  boxes.push("drawbox=x='300+900*abs(sin(t*0.6))':y='400+300*abs(cos(t*0.45))':w=18:h=28:c=black:t=fill");
  ff(
    [
      '-f', 'lavfi', '-i', `color=c=0xf4f4f4:s=1920x1080:r=30:d=${seconds}`,
      ...tone(seconds),
      '-vf', `${boxes.join(',')},format=yuv420p`,
      '-t', String(seconds),
      ...X264_SOURCE, ...AAC, '-shortest', file,
    ],
    file,
  );
}

const OWN_SOURCES = {
  'cbr-motion-1080p60.mp4': (file) => textureClip(file, { width: 1920, height: 1080, fps: 60, seconds: 12, period: 4, burst: 1.5, seed: 11 }),
  'cbr-long-720p30.mp4': (file) => textureClip(file, { width: 1280, height: 720, fps: 30, seconds: 64, period: 10, burst: 2, seed: 5 }),
  'cbr-slides-1080p30.mp4': (file) => slidesClip(file, { seconds: 60 }),
};

if (args.includes('--generate')) {
  for (const [name, make] of Object.entries(OWN_SOURCES)) {
    const file = join(ownDir, name);
    const started = Date.now();
    make(file);
    const v = ffprobeJson(file)?.streams?.find((s) => s.codec_type === 'video');
    console.log(`${name}: ${v?.width}x${v?.height} ${v?.r_frame_rate} ${v?.duration}s ${(Number(ffprobeJson(file)?.format?.bit_rate) / 1e6).toFixed(1)} Mbit/s (${((Date.now() - started) / 1000).toFixed(0)} s)`);
  }
  process.exit(0);
}

/* -------------------------------------------------------------------- cases */

/**
 * The cases registered in docs/quality/2026-10-14-cbr.md before measuring. `ref`: the ffmpeg
 * filter that makes the same picture from the source; `trims`: the kesitler in seconds.
 */
const CASES = [
  { id: 'GURULTU', dir: matrixDir, setup: { video: 'l01-dense-1080p.mp4', moments: [['00:00.000', '00:10.000']], aspect: '16-9', quality: '1080' }, ref: 'scale=1920:1080', trims: [[0, 10]] },
  { id: 'BASIT', dir: matrixDir, setup: { video: 'm01-portrait-20s.mp4', moments: [['00:00.000', '00:04.000'], ['00:08.000', '00:14.000']], aspect: '9-16', quality: '720' }, ref: 'crop=iw:ih,scale=720:1280', trims: [[0, 4], [8, 14]] },
  { id: 'SLAYT', dir: ownDir, setup: { video: 'cbr-slides-1080p30.mp4', moments: [['00:00.000', '01:00.000']], aspect: '16-9', quality: '1080' }, ref: 'scale=1920:1080', trims: [[0, 60]] },
  { id: 'HAREKET60', dir: ownDir, setup: { video: 'cbr-motion-1080p60.mp4', moments: [['00:00.000', '00:12.000']], aspect: '16-9', quality: '1080' }, ref: 'scale=1920:1080', trims: [[0, 12]] },
  // A burst of the 60 fps clip (bursts at 2.5–4, 6.5–8, 10.5–12 s), 3.5 s, at 720p: the phone's Y.
  { id: 'KISA60', dir: ownDir, setup: { video: 'cbr-motion-1080p60.mp4', moments: [['00:02.000', '00:05.500']], aspect: '16-9', quality: '720' }, ref: 'scale=1280:720', trims: [[2, 5.5]] },
  { id: 'UZUN', dir: ownDir, setup: { video: 'cbr-long-720p30.mp4', moments: [['00:02.000', '01:02.000']], aspect: '16-9', quality: '720' }, ref: 'scale=1280:720', trims: [[2, 62]] },
  // Downloaded plain (KOYU) and with İyileştir "Otomatik" (İYİLEŞTİR) by the driver, in that order.
  { id: 'KOYU+IYILESTIR', dir: matrixDir, setup: { video: 'm23-dark-natural.mp4', moments: [['00:00.500', '00:02.500'], ['00:03.000', '00:05.000']], aspect: '16-9', quality: '720', enhance: 'auto' }, ref: 'scale=1280:720', trims: [[0.5, 2.5], [3, 5]] },
  {
    id: 'ALTYAZI',
    dir: matrixDir,
    setup: {
      video: 'm01-portrait-20s.mp4',
      moments: [['00:00.000', '00:04.000'], ['00:08.000', '00:14.000']],
      aspect: '9-16',
      quality: '720',
      captions: {
        variants: [{ label: 'kutu-alt', style: { preset: 'box', position: 'bottom', size: 'medium' } }],
        cues: [
          { startUs: 500_000, endUs: 2_500_000, text: 'Günaydın İstanbul' },
          { startUs: 3_500_000, endUs: 9_000_000, text: 'Dağlar ışıl ışıl\nŞimdi başlıyoruz' },
        ],
      },
    },
    ref: 'crop=iw:ih,scale=720:1280',
    trims: [[0, 4], [8, 14]],
  },
].filter((item) => only.length === 0 || only.some((id) => item.id.split('+').includes(id) || item.id === id));

const missing = CASES.filter((item) => !existsSync(join(item.dir, item.setup.video)));
if (missing.length > 0) {
  console.error(`eksik kaynak: ${missing.map((item) => item.setup.video).join(', ')}`);
  console.error('önce: node scripts/generate-matrix-media.mjs ve node scripts/measure-bitrate-mode.mjs --generate');
  process.exit(2);
}

/* ---------------------------------------------------------------- measuring */

function packetBytes(file) {
  const result = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=size', '-of', 'csv=p=0', file], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  let total = 0;
  for (const line of (result.stdout ?? '').split(/\r?\n/)) {
    const value = Number.parseInt(line, 10);
    if (Number.isFinite(value)) total += value;
  }
  return total;
}

/** Mean VMAF and its worst frame (libvmaf's default model), run in the work folder so the log path needs no escaping. */
function vmaf(file, reference) {
  const log = `vmaf-${process.pid}.json`;
  const graph =
    '[0:v]setpts=PTS-STARTPTS,format=yuv420p[d];[1:v]setpts=PTS-STARTPTS,format=yuv420p[r];' +
    `[d][r]libvmaf=n_threads=8:log_fmt=json:log_path=${log}`;
  const result = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-i', reference, '-lavfi', graph, '-f', 'null', '-'], {
    encoding: 'utf8',
    cwd: workDir,
    maxBuffer: 64 * 1024 * 1024,
  });
  const text = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const mean = /VMAF score:\s*([0-9.]+)/.exec(text);
  let min = null;
  try {
    const parsed = JSON.parse(readFileSync(join(workDir, log), 'utf8'));
    min = parsed.pooled_metrics?.vmaf?.min ?? null;
  } catch {
    /* no log */
  }
  rmSync(join(workDir, log), { force: true });
  return { mean: mean ? Number(mean[1]) : null, min };
}

const round = (value, digits) => (value === null || value === undefined || !Number.isFinite(value) ? null : Number(value.toFixed(digits)));

function score(row, file, testCase) {
  const probe = ffprobeJson(file);
  const video = probe?.streams?.find((s) => s.codec_type === 'video');
  const width = video?.width;
  const height = video?.height;
  const reference = join(refDir, `${testCase.id.split('+')[0]}-${testCase.setup.video.replace(/\.mp4$/, '')}-${width}x${height}.mkv`);
  if (!existsSync(reference)) {
    buildReference(join(testCase.dir, testCase.setup.video), { filter: testCase.ref, trims: testCase.trims, lossless: true }, width, height, reference);
  }
  const seconds = Number(video?.duration ?? probe?.format?.duration);
  const videoBytes = packetBytes(file);
  const frames = perFrameSsim(file, reference).filter((value) => Number.isFinite(value));
  const quality = vmaf(file, reference);
  Object.assign(row, {
    size: `${width}x${height}`,
    seconds: round(seconds, 3),
    fileBytes: Number(probe?.format?.size),
    videoBytes,
    writtenBitrate: Math.round((videoBytes * 8) / seconds),
    writtenOverAsked: row.askedBitrate ? round((videoBytes * 8) / seconds / row.askedBitrate, 4) : null,
    ssimFrames: frames.length,
    ssimMean: round(frames.reduce((sum, value) => sum + value, 0) / Math.max(1, frames.length), 4),
    ssimWorstFrame: round(Math.min(...frames), 4),
    vmafMean: round(quality.mean, 2),
    vmafWorstFrame: round(quality.min, 2),
  });
}

/* --------------------------------------------------------------------- main */

const LAUNCH = {
  chromium: () => chromium.launch(),
  chrome: () => chromium.launch({ channel: 'chrome' }),
  edge: () => chromium.launch({ channel: 'msedge' }),
};
if (!LAUNCH[browserName]) {
  console.error(`unknown browser: ${browserName}`);
  process.exit(2);
}

const drivers = new Map();
const driverFor = (dir) => {
  if (!drivers.has(dir)) drivers.set(dir, createDriver({ mediaDir: dir, outDir: workDir, baseURL }));
  return drivers.get(dir);
};

const encodes = [];
let version = null;
let capability = null;
await acquire(`measure-bitrate-mode ${browserName} (agent a81a3063, worktree)`);
try {
  const browser = await LAUNCH[browserName]();
  version = browser.version();
  try {
    for (const testCase of CASES) {
      for (const mode of ['variable', 'constant']) {
        const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
        const page = await context.newPage();
        await page.addInitScript((value) => {
          window.__clipBitrateMode = value;
          window.__clipExportMode = 'encode';
        }, mode);
        if (!capability) {
          await page.goto(`${baseURL}/editor`);
          capability = await page.evaluate(async () => {
            const ask = async (config) => {
              try {
                return (await VideoEncoder.isConfigSupported(config)).supported === true;
              } catch (error) {
                return `error:${error.name}`;
              }
            };
            const base = { codec: 'avc1.640028', width: 1920, height: 1080, framerate: 30, bitrate: 5_600_000 };
            return {
              userAgent: navigator.userAgent,
              hardware: await ask({ ...base, hardwareAcceleration: 'prefer-hardware' }),
              constant: await ask({ ...base, bitrateMode: 'constant' }),
              variable: await ask({ ...base, bitrateMode: 'variable' }),
            };
          });
          console.log(`${browserName} ${version}: ${JSON.stringify(capability)}`);
        }
        const artefact = join(workDir, `${testCase.id.replace('+', '_')}-${mode}.mp4`);
        const started = Date.now();
        const outcome = await driverFor(testCase.dir).drive(page, testCase, artefact);
        const elapsedMs = Date.now() - started;
        const runs = [];
        if (outcome.enhancePlain) {
          runs.push({ id: 'KOYU', path: outcome.enhancePlain.path, reported: outcome.enhancePlain.reported });
          runs.push({ id: 'IYILESTIR', path: artefact, reported: outcome.reported });
        } else if (outcome.exported) {
          runs.push({ id: testCase.id, path: artefact, reported: outcome.reported });
        } else {
          runs.push({ id: testCase.id, failed: outcome.failureText ?? outcome.blockedText ?? outcome.importMessage ?? 'dışa aktarma olmadı' });
        }
        for (const run of runs) {
          const entry = {
            id: run.id,
            caseId: testCase.id,
            mode,
            path: run.path ?? null,
            failed: run.failed ?? null,
            elapsedMs,
            method: run.reported?.method ?? null,
            askedBitrate: run.reported?.videoBitrate ?? null,
            bitrateMode: run.reported?.bitrateMode ?? null,
            bitrateModeAsked: run.reported?.bitrateModeAsked ?? null,
            enhance: run.reported?.enhance?.light ?? null,
          };
          encodes.push(entry);
          console.log(`${browserName} ${entry.id} ${mode}: ${entry.failed ?? `${entry.method} ${entry.bitrateMode} ${entry.askedBitrate} bit/s`}`);
        }
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
} finally {
  release();
}

const rows = [];
for (const entry of encodes) {
  const testCase = CASES.find((item) => item.id === entry.caseId);
  const row = { ...entry };
  if (!entry.failed && entry.path && existsSync(entry.path)) {
    score(row, entry.path, testCase);
    rmSync(entry.path, { force: true });
  }
  delete row.path;
  rows.push(row);
  console.log(JSON.stringify(row));
}
const outFile = join(outDir, `${browserName}${label ? `-${label}` : ''}.json`);
writeFileSync(outFile, `${JSON.stringify({ browser: browserName, version, capability, ranAt: new Date().toISOString(), rows }, null, 2)}\n`);
rmSync(workDir, { recursive: true, force: true });
console.log(`\n${outFile}`);
