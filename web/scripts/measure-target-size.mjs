/**
 * Measurements behind the target-size planner (ADR-035), through the real app.
 *
 *   node scripts/measure-target-size.mjs --mode=grid    --browser=chrome
 *   node scripts/measure-target-size.mjs --mode=targets --browser=chromium
 *   node scripts/measure-target-size.mjs --mode=audio   --browser=edge
 *
 * `grid`: every file at every resolution rung and a ladder of bits per pixel,
 * each encoded ONCE at exactly that size and bitrate (`__clipExportOptions.
 * forced`). Per encode: the produced size against the asked size (encoder
 * overshoot), the container bytes that are neither picture nor sound, and
 * SSIM against an ffmpeg reference of the same range — compared at the file's
 * top rung, so a smaller resolution pays for its lost detail. The planner's
 * floors and overshoot factors are read from this table.
 *
 * `targets`: real target-size downloads (`__clipExportOptions.targetSize`):
 * planned against actual size, attempts, resolution, time, SSIM.
 *
 * `audio`: sound-only downloads (`__clipExportOptions.output = 'audio'`):
 * tracks, codec, exact duration, alignment against the source's sound.
 *
 * Privacy: files are read locally and never uploaded; results carry an id and
 * technical numbers only. Server: SHOT_URL, or :3100.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

import {
  addKesit,
  installSavePicker,
  lastPickedName,
  readPickedFile,
  removePickedFiles,
  setAspect,
  setQuality,
} from './lib/kesit-flow.mjs';
import { buildReference, ffprobeJson, runFfmpeg } from './lib/media-measure.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const found = args.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};
const mode = argValue('mode', 'grid');
const browserName = argValue('browser', 'chromium');
const mediaDir = argValue('dir', join(root, 'tests', 'media', 'real'));
const label = argValue('label', '');
const only = argValue('files', '').split(',').filter(Boolean);
const baseURL = process.env.SHOT_URL ?? 'http://127.0.0.1:3100';
const outDir = join(root, 'matrix-results', 'target-size');
const workDir = join(outDir, `work-${browserName}-${mode}${label ? `-${label}` : ''}`);
mkdirSync(workDir, { recursive: true });

const LAUNCH = {
  chromium: () => chromium.launch(),
  chrome: () => chromium.launch({ channel: 'chrome' }),
  edge: () => chromium.launch({ channel: 'msedge' }),
};

/**
 * The recordings measured (file names stay local). `aspect` is the frame that
 * matches the recording's own shape, so nothing is cropped; `top` its largest
 * rung; `range` the seconds exported.
 */
const FILES = [
  { id: 'S21', file: 'web-samsung-s21-h264-60fps-rot90.mp4', aspect: '9-16', top: 1080, range: [0.3, 4.3], note: '1080p60 phone, very detailed, moving' },
  { id: 'IP11', file: 'web-iphone11-h264-long-5m41s.mov', aspect: '16-9', top: 1080, range: [60, 70], note: '1080p30 phone' },
  { id: 'IP13', file: 'web-iphone13pro-h264-60fps-rot180.mov', aspect: '16-9', top: 1080, range: [20, 30], note: '1080p60 phone' },
  { id: 'GOPRO', file: 'ffs-h264_gopro_ambarella.mp4', aspect: '16-9', top: 720, range: [2, 12], note: '720p60 action camera' },
  { id: 'PIX4K', file: 'web-pixel6pro-hevc-4k-rot90.mp4', aspect: '9-16', top: 1080, range: [0, 10], note: '4K HEVC phone' },
].filter((item) => only.length === 0 || only.includes(item.id));

const RUNGS = argValue('rungs', '1080,720,540,480,360').split(',').map(Number);
const BPP = [0.015, 0.025, 0.035, 0.045, 0.06, 0.09, 0.13];
const FPS = 30;

function sizeOf(aspect, shortEdge) {
  const even = (n) => Math.max(2, Math.round(n / 2) * 2);
  if (aspect === '9-16') return [even(shortEdge), even((shortEdge * 16) / 9)];
  if (aspect === '16-9') return [even((shortEdge * 16) / 9), even(shortEdge)];
  return [even(shortEdge), even(shortEdge)];
}

const clock = (seconds) => {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
};

function packetBytes(file, stream) {
  const result = spawnSync(
    'ffprobe',
    ['-v', 'error', '-select_streams', stream, '-show_entries', 'packet=size', '-of', 'csv=p=0', file],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
  );
  if (result.status !== 0) return null;
  let total = 0;
  for (const line of result.stdout.split(/\r?\n/)) {
    const value = Number.parseInt(line, 10);
    if (Number.isFinite(value)) total += value;
  }
  return total;
}

/** SSIM of `file` scaled to the reference's size, frame by frame. */
function ssimAt(file, reference, width, height) {
  const output = runFfmpeg([
    '-i', file, '-i', reference,
    '-lavfi', `[0:v]scale=${width}:${height}:flags=bicubic[a];[a][1:v]ssim`,
    '-f', 'null', '-',
  ]);
  const match = /SSIM[^\n]*All:\s*([0-9.]+)/.exec(output);
  return match ? Number(match[1]) : NaN;
}

async function waitForAny(page, testIds, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const id of testIds) if ((await page.getByTestId(id).count()) > 0) return id;
    await page.waitForTimeout(100);
  }
  return null;
}

async function openFile(context, item) {
  const page = await context.newPage();
  await installSavePicker(page);
  await page.goto(`${baseURL}/editor`);
  await page.getByTestId('download-all').waitFor({ timeout: 30_000 });
  await page.getByTestId('video-input').setInputFiles(join(mediaDir, item.file));
  const opened = await waitForAny(page, ['preview-video', 'media-error'], 120_000);
  if (opened !== 'preview-video') throw new Error(`${item.id}: could not open`);
  await setAspect(page, item.aspect);
  await setQuality(page, item.top >= 1080 ? 1080 : 720);
  await addKesit(page, clock(item.range[0]), clock(item.range[1]));
  return page;
}

/** One press of the download button with `options` as the hook; the outcome and the saved file. */
async function exportWith(page, options, savePath) {
  await page.evaluate((value) => {
    window.__clipExportOptions = value;
  }, options);
  await removePickedFiles(page);
  const startedAt = Date.now();
  await page.getByTestId('download-all').click();
  const end = await waitForAny(page, ['export-succeeded', 'export-failed', 'export-blocked'], 900_000);
  const elapsedMs = Date.now() - startedAt;
  if (end !== 'export-succeeded') {
    const text = end ? ((await page.getByTestId(end).textContent()) ?? '').replace(/\s+/g, ' ').trim() : 'timeout';
    const refusal = page.getByTestId('target-size-refusal');
    const minBytes = (await refusal.count()) > 0 ? Number(await refusal.getAttribute('data-min-bytes')) : null;
    await page.getByTestId('download-dismiss').first().click().catch(() => undefined);
    return { ok: false, end, text, minBytes, elapsedMs };
  }
  const line = page.getByTestId('target-size-result');
  const attrs = {};
  if ((await line.count()) > 0) {
    for (const name of ['fits', 'target-bytes', 'planned-bytes', 'actual-bytes', 'attempts', 'short-edge', 'video-bitrate', 'audio-bitrate', 'encoder', 'mode']) {
      attrs[name] = await line.getAttribute(`data-${name}`);
    }
  }
  const method = page.getByTestId('export-method');
  attrs.method = await method.getAttribute('data-method');
  attrs.output = await method.getAttribute('data-output');
  attrs.fallback = await method.getAttribute('data-fallback');
  const picked = await lastPickedName(page);
  const bytes = picked ? await readPickedFile(page, picked, savePath) : 0;
  await removePickedFiles(page);
  await page.getByTestId('download-dismiss').first().click().catch(() => undefined);
  return { ok: true, attrs, bytes, elapsedMs };
}

function referenceFor(item) {
  const [width, height] = sizeOf(item.aspect, item.top);
  const file = join(outDir, `ref-${item.id}-${width}x${height}.mp4`);
  if (!existsSync(file)) {
    buildReference(join(mediaDir, item.file), { filter: `scale=${width}:${height}`, trims: [item.range] }, width, height, file);
  }
  return { file, width, height };
}

const browser = await LAUNCH[browserName]();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const rows = [];
const outFile = join(outDir, `${mode}-${browserName}${label ? `-${label}` : ''}.json`);
const save = () =>
  writeFileSync(
    outFile,
    `${JSON.stringify({ mode, browser: browserName, version: browser.version(), ranAt: new Date().toISOString(), rows }, null, 2)}\n`,
  );

try {
  if (mode === 'grid') {
    const bitrateMode = argValue('bitrate-mode', '');
    const bpps = argValue('bpp', '') ? argValue('bpp', '').split(',').map(Number) : BPP;
    for (const item of FILES) {
      const reference = referenceFor(item);
      const page = await openFile(context, item);
      const seconds = item.range[1] - item.range[0];
      for (const rung of RUNGS.filter((edge) => edge <= item.top)) {
        const [width, height] = sizeOf(item.aspect, rung);
        for (const bpp of bpps) {
          const videoBitrate = Math.round(width * height * FPS * bpp);
          const savePath = join(workDir, `${item.id}-${rung}-${bpp}.mp4`);
          const outcome = await exportWith(
            page,
            { forced: { shortEdge: rung, videoBitrate, audioBitrate: 128_000, ...(bitrateMode ? { bitrateMode } : {}) } },
            savePath,
          );
          const row = { id: item.id, rung, width, height, bpp, askedVideoBitrate: videoBitrate, seconds };
          if (outcome.ok) {
            const video = packetBytes(savePath, 'v:0');
            const audio = packetBytes(savePath, 'a:0') ?? 0;
            const asked = (videoBitrate * seconds) / 8;
            Object.assign(row, {
              fileBytes: outcome.bytes,
              videoBytes: video,
              audioBytes: audio,
              overheadBytes: outcome.bytes - video - audio,
              ratio: Number((video / asked).toFixed(4)),
              ssim: Number(ssimAt(savePath, reference.file, reference.width, reference.height).toFixed(4)),
              encoder: outcome.attrs.encoder,
              elapsedMs: outcome.elapsedMs,
            });
            rmSync(savePath, { force: true });
          } else {
            Object.assign(row, { failed: outcome.text });
          }
          rows.push(row);
          console.log(JSON.stringify(row));
          save();
        }
      }
      await page.close();
    }
  } else if (mode === 'targets') {
    /** Whole-file or long-range downloads against the presets and small targets. */
    const CASES = [
      { id: 'IP11', file: 'web-iphone11-h264-long-5m41s.mov', aspect: '16-9', top: 1080, range: [0, 341], targets: [52_428_800, 25_000_000, 16_000_000] },
      { id: 'IP11', file: 'web-iphone11-h264-long-5m41s.mov', aspect: '16-9', top: 1080, range: [0, 60], targets: [52_428_800, 16_000_000, 5_000_000, 2_000_000] },
      { id: 'IP13', file: 'web-iphone13pro-h264-60fps-rot180.mov', aspect: '16-9', top: 1080, range: [0, 88], targets: [52_428_800, 25_000_000, 16_000_000, 8_000_000] },
      { id: 'S21', file: 'web-samsung-s21-h264-60fps-rot90.mp4', aspect: '9-16', top: 1080, range: [0.3, 4.3], targets: [2_000_000, 1_000_000, 500_000] },
      { id: 'GOPRO', file: 'ffs-h264_gopro_ambarella.mp4', aspect: '16-9', top: 720, range: [0, 16], targets: [16_000_000, 4_000_000, 2_000_000] },
      { id: 'PIX4K', file: 'web-pixel6pro-hevc-4k-rot90.mp4', aspect: '9-16', top: 1080, range: [0, 10], targets: [16_000_000, 3_000_000] },
    ].filter((item) => only.length === 0 || only.includes(item.id));
    for (const item of CASES) {
      const reference = item.range[1] - item.range[0] <= 90 ? referenceFor({ ...item, id: `${item.id}-${item.range[1]}` }) : null;
      const page = await openFile(context, item);
      const seconds = item.range[1] - item.range[0];
      for (const targetBytes of item.targets) {
        const savePath = join(workDir, `${item.id}-${seconds}-${targetBytes}.mp4`);
        const outcome = await exportWith(page, { targetSize: { targetBytes } }, savePath);
        const row = { id: item.id, seconds, targetBytes };
        if (outcome.ok) {
          const probe = ffprobeJson(savePath);
          const video = probe?.streams?.find((s) => s.codec_type === 'video');
          Object.assign(row, {
            fits: outcome.attrs.fits,
            plannedBytes: Number(outcome.attrs['planned-bytes']),
            actualBytes: outcome.bytes,
            reportedBytes: Number(outcome.attrs['actual-bytes']),
            attempts: Number(outcome.attrs.attempts),
            shortEdge: Number(outcome.attrs['short-edge']),
            videoBitrate: Number(outcome.attrs['video-bitrate']),
            audioBitrate: Number(outcome.attrs['audio-bitrate']),
            encoder: outcome.attrs.encoder,
            planMode: outcome.attrs.mode,
            method: outcome.attrs.method,
            size: video ? `${video.width}x${video.height}` : null,
            durationS: Number(probe?.format?.duration),
            elapsedMs: outcome.elapsedMs,
            ssim: reference ? Number(ssimAt(savePath, reference.file, reference.width, reference.height).toFixed(4)) : null,
          });
          rmSync(savePath, { force: true });
        } else {
          Object.assign(row, { refused: outcome.end, text: outcome.text, minBytes: outcome.minBytes, elapsedMs: outcome.elapsedMs });
        }
        rows.push(row);
        console.log(JSON.stringify(row));
        save();
      }
      await page.close();
    }
  } else if (mode === 'audio') {
    const CASES = [
      { id: 'IP11', file: 'web-iphone11-h264-long-5m41s.mov', aspect: '16-9', top: 1080, range: [10, 70] },
      { id: 'IP13', file: 'web-iphone13pro-h264-60fps-rot180.mov', aspect: '16-9', top: 1080, range: [5, 25.5] },
      { id: 'S21', file: 'web-samsung-s21-h264-60fps-rot90.mp4', aspect: '9-16', top: 1080, range: [0.5, 4] },
      { id: 'GOPRO', file: 'ffs-h264_gopro_ambarella.mp4', aspect: '16-9', top: 720, range: [1, 9.2] },
    ].filter((item) => only.length === 0 || only.includes(item.id));
    for (const item of CASES) {
      const page = await openFile(context, item);
      const seconds = item.range[1] - item.range[0];
      const savePath = join(outDir, `audio-${item.id}-${browserName}.m4a`);
      const outcome = await exportWith(page, { output: 'audio' }, savePath);
      const row = { id: item.id, seconds };
      if (outcome.ok) {
        const probe = ffprobeJson(savePath);
        const streams = probe?.streams ?? [];
        const audio = streams.find((s) => s.codec_type === 'audio');
        Object.assign(row, {
          output: outcome.attrs.output,
          bytes: outcome.bytes,
          tracks: streams.map((s) => `${s.codec_type}:${s.codec_name}`),
          formatName: probe?.format?.format_name,
          majorBrand: probe?.format?.tags?.major_brand ?? null,
          sampleRate: Number(audio?.sample_rate),
          channels: audio?.channels,
          streamDurationS: Number(audio?.duration),
          formatDurationS: Number(probe?.format?.duration),
          startTimeS: Number(audio?.start_time),
          expectedS: Math.round(seconds * FPS) / FPS,
          elapsedMs: outcome.elapsedMs,
          lagMs: audioLagMs(join(mediaDir, item.file), item.range, savePath),
        });
      } else {
        Object.assign(row, { refused: outcome.end, text: outcome.text });
      }
      rows.push(row);
      console.log(JSON.stringify(row));
      save();
      await page.close();
    }
  }
} finally {
  save();
  await context.close();
  await browser.close();
  rmSync(workDir, { recursive: true, force: true });
}
console.log(`\n${outFile}`);

/**
 * How far the exported sound sits from the source's own sound over the same
 * range, in ms (positive: the export is late), by cross-correlating the
 * decoded mono 8 kHz signals over ±200 ms. Both files are read from their
 * start (ADR-032: `-ss` in front of `-i` misreads an edit list).
 */
function audioLagMs(sourceFile, range, exportedFile) {
  const rate = 8000;
  const pcm = (file, from, length) => {
    const result = spawnSync(
      'ffmpeg',
      ['-v', 'error', '-i', file, '-vn', '-af', `atrim=start=${from}:duration=${length},asetpts=PTS-STARTPTS`, '-ac', '1', '-ar', String(rate), '-f', 'f32le', '-'],
      { maxBuffer: 512 * 1024 * 1024 },
    );
    if (result.status !== 0) return null;
    return new Float32Array(result.stdout.buffer, result.stdout.byteOffset, Math.floor(result.stdout.byteLength / 4));
  };
  const length = Math.min(20, range[1] - range[0]);
  const a = pcm(sourceFile, range[0], length);
  const b = pcm(exportedFile, 0, length);
  if (!a || !b || a.length < rate || b.length < rate) return null;
  const n = Math.min(a.length, b.length);
  const maxLag = Math.round(rate * 0.2);
  let best = { lag: 0, score: -Infinity };
  for (let lag = -maxLag; lag <= maxLag; lag += 1) {
    let sum = 0;
    for (let i = maxLag; i < n - maxLag; i += 1) sum += a[i] * b[i + lag];
    if (sum > best.score) best = { lag, score: sum };
  }
  return Number(((best.lag / rate) * 1000).toFixed(2));
}

