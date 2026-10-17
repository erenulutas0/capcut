/**
 * The largest download (17 Oct 2026, 4 GiB − 1 byte): what holding the bitrate costs, and how much
 * an encoder overshoots the held bitrate, on 5-minute pieces through the real app.
 *
 * The hold only bites on long outputs (a 60-minute 1080p re-encode on the software encoder is held
 * from 16.8 or 11.4 to 8.48 Mbit/s). To see its effect in five minutes instead of an hour, the
 * measurement hook `window.__clipOutputLimitBytes` lowers the limit so that a 5-minute output is
 * held to EXACTLY the 60-minute bitrate (computed below from the same formula as
 * `src/domain/outputStorage.ts`, and checked against the bitrate the result line reports).
 *
 * Every case is downloaded twice through the editor's own button as a full encode
 * (`__clipExportMode = 'encode'`): `unheld` (the app as it is for a 5-minute output) and `held60`
 * (the 60-minute bitrate). Per file: written ÷ asked (video packet bytes over the stream's length
 * against the bitrate the result line reports), file bytes, mean and worst-frame SSIM and mean
 * VMAF against a lossless ffmpeg reference of the same edit (`buildReference`).
 *
 *   node scripts/generate-long-media.mjs --only=big,1080 --seconds=300
 *   node scripts/measure-file-limit.mjs [--browser=chromium|chrome|edge] [--case=DESEN,GURULTU,GERCEK]
 *     [--real=<a real 1080p recording of 5 min or more; private, never committed>]
 *
 * The browser part holds the machine-wide measurement lock; the scoring runs after it is released.
 * Server: SHOT_URL, or :3100 (a plain build). Results: `matrix-results/file-limit/<browser>.json`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

import { createDriver } from './lib/matrix-driver.mjs';
import { acquire, release } from './lib/measure-lock.mjs';
import { buildReference, ffprobeJson } from './lib/media-measure.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const found = args.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};
const browserName = argValue('browser', 'chromium');
const only = argValue('case', '').split(',').filter(Boolean);
const realFile = argValue('real', '');
const baseURL = process.env.SHOT_URL ?? 'http://127.0.0.1:3100';
const longDir = join(root, 'tests', 'media', 'long');
const outDir = join(root, 'matrix-results', 'file-limit');
const workDir = join(outDir, `work-${browserName}`);
const refDir = join(outDir, 'references');
for (const dir of [outDir, workDir, refDir]) mkdirSync(dir, { recursive: true });

/* ------------------------------------------------- the hold, as the app computes it */

const MIB = 1_048_576;
const LIMIT = 4 * 1024 * MIB - 1; // OUTPUT_FILE_LIMIT_BYTES
const HEADROOM = 32 * MIB; // FIXED_HEADROOM_BYTES
const OVERSHOOT = 1.1; // ENCODER_OVERSHOOT
const AUDIO = 128_000;
const heldBitrate = (seconds, limit = LIMIT) => Math.floor((((limit - HEADROOM) / OVERSHOOT) * 8) / seconds - AUDIO) - 1;
const HELD_60 = heldBitrate(3600);
/** The limit under which a `seconds`-long output gets exactly the 60-minute bitrate. */
const limitFor = (seconds) => Math.ceil((((HELD_60 + 1.5 + AUDIO) * seconds) / 8) * OVERSHOOT + HEADROOM);
const SECONDS = 300;
const HOOK_LIMIT = limitFor(SECONDS);
if (heldBitrate(SECONDS, HOOK_LIMIT) !== HELD_60) throw new Error(`hook limit does not reproduce ${HELD_60}`);

/* --------------------------------------------------------------------------- cases */

const moment = [['00:00.000', '05:00.000']];
const CASES = [
  // The long soak's own source, first five minutes: test pattern + barcode (easy to encode).
  { id: 'DESEN', dir: longDir, video: 'long-120min-1080p-300s.mp4' },
  // Noisy 1080p at ~10.5 Mbit/s (generate-long-media `big`): the hardest picture there is.
  { id: 'GURULTU', dir: longDir, video: 'big-60min-1080p-4gib-300s.mp4' },
  ...(realFile ? [{ id: 'GERCEK', dir: dirname(realFile), video: basename(realFile) }] : []),
]
  .filter((item) => only.length === 0 || only.includes(item.id))
  .map((item) => ({ ...item, setup: { video: item.video, moments: moment, aspect: '16-9', quality: '1080' }, trims: [[0, SECONDS]] }));

const missing = CASES.filter((item) => !existsSync(join(item.dir, item.video)));
if (missing.length > 0) {
  console.error(`eksik kaynak: ${missing.map((item) => item.video).join(', ')}`);
  console.error('önce: node scripts/generate-long-media.mjs --only=big,1080 --seconds=300');
  process.exit(2);
}

/* ------------------------------------------------------------------------ scoring */

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

/**
 * Per-frame SSIM with both streams numbered by frame (`settb=1/30,setpts=N`), shifted by `shift` frames
 * (output frame k against reference frame k + shift). The output's own timestamps are not trusted
 * for the pairing: a container start offset would pair every frame with its neighbour, which on a
 * picture that changes every frame (a running clock, a barcode) reads as heavy loss.
 */
function framewiseSsim(file, reference, shift = 0) {
  const skip = (n) => (n > 0 ? `trim=start_frame=${n},` : '');
  const graph =
    `[0:v]${skip(-shift)}settb=1/30,setpts=N,format=yuv420p[a];[1:v]${skip(shift)}settb=1/30,setpts=N,format=yuv420p[b];` +
    '[a][b]ssim=shortest=1:stats_file=-';
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-i', reference, '-lavfi', graph, '-f', 'null', '-'], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  const values = [];
  for (const match of (result.stdout ?? '').matchAll(/n:(\d+)[^\n]*All:([0-9.]+)/g)) values[Number(match[1]) - 1] = Number(match[2]);
  return values.filter((value) => Number.isFinite(value));
}

/** Mean VMAF and its worst frame (libvmaf's default model), run in the work folder so the log path needs no escaping. */
function vmaf(file, reference) {
  const log = `vmaf-${process.pid}.json`;
  const graph =
    '[0:v]settb=1/30,setpts=N,format=yuv420p[d];[1:v]settb=1/30,setpts=N,format=yuv420p[r];' +
    `[d][r]libvmaf=n_threads=8:shortest=1:log_fmt=json:log_path=${log}`;
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
  const reference = join(refDir, `${testCase.id}-${width}x${height}.mkv`);
  if (!existsSync(reference)) {
    buildReference(join(testCase.dir, testCase.video), { filter: `scale=${width}:${height}`, trims: testCase.trims, lossless: true }, width, height, reference);
  }
  const seconds = Number(video?.duration ?? probe?.format?.duration);
  const videoBytes = packetBytes(file);
  // Which pairing is the right one is measured, not assumed: the best of −1, 0, +1 frames on the
  // first 300 frames' mean must be 0 (the app is frame-accurate; the long soak reads the barcode).
  const probeShift = (shift) => {
    const head = framewiseSsim(file, reference, shift).slice(0, 300);
    return head.reduce((sum, value) => sum + value, 0) / Math.max(1, head.length);
  };
  const shifts = { '-1': round(probeShift(-1), 4), 0: round(probeShift(0), 4), 1: round(probeShift(1), 4) };
  const frames = framewiseSsim(file, reference, 0);
  const quality = vmaf(file, reference);
  Object.assign(row, {
    size: `${width}x${height}`,
    seconds: round(seconds, 3),
    fileBytes: Number(probe?.format?.size),
    videoBytes,
    writtenBitrate: Math.round((videoBytes * 8) / seconds),
    writtenOverAsked: row.askedBitrate ? round((videoBytes * 8) / seconds / row.askedBitrate, 4) : null,
    fileOverPlanned: row.askedBitrate ? round(Number(probe?.format?.size) / (((row.askedBitrate + AUDIO) * seconds) / 8), 4) : null,
    ssimByShift: shifts,
    ssimFrames: frames.length,
    ssimMean: round(frames.reduce((sum, value) => sum + value, 0) / Math.max(1, frames.length), 4),
    ssimWorstFrame: round(Math.min(...frames), 4),
    vmafMean: round(quality.mean, 2),
    vmafWorstFrame: round(quality.min, 2),
  });
}

/* --------------------------------------------------------------------------- main */

const LAUNCH = {
  chromium: () => chromium.launch(),
  chrome: () => chromium.launch({ channel: 'chrome' }),
  edge: () => chromium.launch({ channel: 'msedge' }),
};
if (!LAUNCH[browserName]) {
  console.error(`unknown browser: ${browserName}`);
  process.exit(2);
}

// `--rescore`: score the files a `--keep` run left in the work folder again, without the browser.
if (args.includes('--rescore')) {
  const outFile = join(outDir, `${browserName}.json`);
  const saved = JSON.parse(readFileSync(outFile, 'utf8'));
  for (const row of saved.rows) {
    const testCase = CASES.find((item) => item.id === row.caseId);
    const file = join(workDir, `${row.caseId}-${row.run}.mp4`);
    if (testCase && existsSync(file)) score(row, file, testCase);
    console.log(JSON.stringify(row));
  }
  writeFileSync(outFile, `${JSON.stringify({ ...saved, rescoredAt: new Date().toISOString() }, null, 2)}\n`);
  process.exit(0);
}

console.log(`60 dakikanın tutulan bit hızı: ${HELD_60} bit/s; 5 dakikada aynısı için sınır: ${HOOK_LIMIT} bayt`);
const encodes = [];
let version = null;
await acquire(`measure-file-limit ${browserName} (agent a1984665, worktree)`);
try {
  const browser = await LAUNCH[browserName]();
  version = browser.version();
  try {
    for (const testCase of CASES) {
      const driver = createDriver({ mediaDir: testCase.dir, outDir: workDir, baseURL });
      for (const run of ['unheld', 'held60']) {
        const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
        const page = await context.newPage();
        await page.addInitScript((limit) => {
          window.__clipExportMode = 'encode';
          if (limit) window.__clipOutputLimitBytes = limit;
        }, run === 'held60' ? HOOK_LIMIT : null);
        const artefact = join(workDir, `${testCase.id}-${run}.mp4`);
        const started = Date.now();
        const outcome = await driver.drive(page, testCase, artefact);
        const elapsedMs = Date.now() - started;
        const entry = {
          caseId: testCase.id,
          run,
          path: outcome.exported ? artefact : null,
          failed: outcome.exported ? null : (outcome.failureText ?? outcome.blockedText ?? outcome.importMessage ?? 'dışa aktarma olmadı'),
          elapsedMs,
          method: outcome.reported?.method ?? null,
          askedBitrate: outcome.reported?.videoBitrate ?? null,
          // The hold is read from the bitrate the result line reports (`data-video-bitrate`).
          expectedAsked: run === 'held60' ? HELD_60 : null,
          bitrateMode: outcome.reported?.bitrateMode ?? null,
        };
        encodes.push(entry);
        console.log(`${browserName} ${testCase.id} ${run}: ${entry.failed ?? `${entry.method} ${entry.bitrateMode} ${entry.askedBitrate} bit/s`}`);
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
    if (!args.includes('--keep')) rmSync(entry.path, { force: true });
  }
  delete row.path;
  rows.push(row);
  console.log(JSON.stringify(row));
}
const outFile = join(outDir, `${browserName}.json`);
writeFileSync(
  outFile,
  `${JSON.stringify({ browser: browserName, version, held60: HELD_60, hookLimit: HOOK_LIMIT, ranAt: new Date().toISOString(), rows }, null, 2)}\n`,
);
if (!args.includes('--keep')) rmSync(workDir, { recursive: true, force: true });
console.log(`\n${outFile}`);
