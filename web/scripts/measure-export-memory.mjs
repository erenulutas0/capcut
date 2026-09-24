/**
 * What does an export really cost in memory?
 *
 * Runs real exports of increasing length on dense 1080p content and samples
 * the private bytes of the whole browser process tree from the operating
 * system. This is the measurement W2 could not make: `performance.memory` is
 * rounded for privacy and never sees the encode worker.
 *
 * Windows only (the sampler is PowerShell). Server must be running on :3100.
 *
 *   node scripts/measure-export-memory.mjs
 *   node scripts/measure-export-memory.mjs --seconds=60,300 --quality=1080 --browser=chrome
 *
 * ADR-028 options:
 *   --profile        ask the encode worker for stage timings (decode wait,
 *                    draw, frame capture, encode, audio, ...) and store them
 *                    in the row (`window.__clipExportProfile`, a test hook)
 *   --mode=encode    force the full encode (`window.__clipExportMode`, a test
 *                    hook; ADR-027): otherwise an unchanged H.264 picture is
 *                    fast-cut (copied), which is not the path measured here
 *   --aspect=9-16    pick this output frame after import (e.g. a landscape
 *                    source into 9:16 is the crop case); default: automatic
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

import { ffprobeJson } from './lib/media-measure.mjs';
import { addKesit, removeSavePicker, setAspect, setQuality } from './lib/kesit-flow.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const mediaDir = join(root, 'tests', 'media', 'matrix');
const outDir = join(root, 'matrix-results');
const sampler = join(root, 'scripts', 'lib', 'process-memory.ps1');
const baseURL = process.env.SHOT_URL ?? 'http://127.0.0.1:3100';

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const found = args.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};
const durations = argValue('seconds', '30,60,120,180,300').split(',').map(Number);
const quality = argValue('quality', '1080');
const channel = argValue('browser', '');
const fixture = argValue('fixture', 'l01-dense-1080p.mp4');
/**
 * A persistent profile is what a real user has. Playwright's default contexts
 * are non-persistent, and in those Chromium keeps OPFS and IndexedDB in RAM —
 * so a disk-route measurement there only moves memory between processes.
 */
const persistent = args.includes('--persistent');
/**
 * `--whole`: export the automatic single piece (ADR-019) — the whole source,
 * e.g. a 60-minute file for the doc 15 v3 limit — instead of building a
 * recipe from 15 s ranges. `--seconds` is then ignored (one run).
 */
const whole = args.includes('--whole');
/** Long exports take longer than the default 15 minutes. */
const timeoutMs = Number(argValue('timeout-min', '15')) * 60_000;
const profile = args.includes('--profile');
/** `--browser-args=--flag1,--flag2`: extra browser switches (e.g. no video encode acceleration). */
const browserArgs = argValue('browser-args', '').split(',').filter(Boolean);
const aspect = argValue('aspect', '');
const forceEncode = argValue('mode', 'auto') === 'encode';

if (process.platform !== 'win32') {
  console.error('Bu ölçüm şimdilik yalnızca Windows süreç örnekleyicisiyle çalışıyor.');
  process.exit(2);
}

mkdirSync(outDir, { recursive: true });
const MIB = 1048576;

/** Starts the OS-level sampler for a browser process tree. */
function startSampler(rootPid) {
  const samples = [];
  const child = spawn(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', sampler, '-RootPid', String(rootPid), '-IntervalMs', '400'],
    { stdio: ['ignore', 'pipe', 'ignore'] },
  );
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const [at, total, largest, count] = line.trim().split(/\s+/).map(Number);
      if (Number.isFinite(total)) samples.push({ at, total, largest, count });
    }
  });
  return {
    samples,
    stop: () => child.kill(),
  };
}

/** Finds the root browser process of a persistent profile by its data dir. */
function findBrowserPid(userDataDir) {
  const needle = userDataDir.replace(/'/g, "''");
  const script =
    `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${needle}*' -and ` +
    `$_.CommandLine -notlike '*--type=*' } | Select-Object -First 1 -ExpandProperty ProcessId`;
  const result = spawnSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8' });
  const pid = Number((result.stdout || '').trim());
  return Number.isFinite(pid) && pid > 0 ? pid : null;
}

let server = null;
let browser = null;
let context;
let browserPid;
let profileDir = null;

if (persistent) {
  profileDir = mkdtempSync(join(tmpdir(), 'clip-profile-'));
  context = await chromium.launchPersistentContext(profileDir, {
    ...(channel ? { channel } : {}),
    ...(browserArgs.length > 0 ? { args: browserArgs } : {}),
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
  });
  browserPid = findBrowserPid(profileDir);
  if (!browserPid) {
    console.error('kalıcı profilin tarayıcı süreci bulunamadı');
    process.exit(2);
  }
} else {
  server = await chromium.launchServer(channel ? { channel } : {});
  browserPid = server.process().pid;
  browser = await chromium.connect(server.wsEndpoint());
  context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
}
console.log(`profil: ${persistent ? 'kalıcı (disk)' : 'kalıcı olmayan (Playwright varsayılanı)'}, tarayıcı pid ${browserPid}\n`);

const rows = [];

for (const seconds of whole ? [0] : durations) {
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const profiles = [];
  if (profile) {
    await page.addInitScript(() => {
      window.__clipExportProfile = true;
    });
    page.on('console', (message) => {
      const text = message.text();
      if (text.startsWith('[clip-export-profile] ')) {
        try {
          profiles.push(JSON.parse(text.slice('[clip-export-profile] '.length)));
        } catch {
          // A malformed line is not a measurement.
        }
      }
    });
  }

  // The OPFS route is what this script measures (ADR-013/023), so the save
  // dialog of ADR-026 is taken away, as in a browser that has none.
  await removeSavePicker(page);
  if (forceEncode) {
    await page.addInitScript(() => {
      window.__clipExportMode = 'encode';
    });
  }
  await page.goto(`${baseURL}/editor`);
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    for await (const name of root.keys()) {
      if (name.startsWith('clip-export-')) await root.removeEntry(name).catch(() => undefined);
    }
  });
  // An absolute path measures any file, e.g. a user's own long recording.
  await page.getByTestId('video-input').setInputFiles(isAbsolute(fixture) ? fixture : join(mediaDir, fixture));
  await page.getByTestId('preview-video').waitFor({ timeout: 60_000 });

  let requestedSeconds;
  if (whole) {
    // No kesit: the top button downloads the whole video (ADR-026).
    // The video's own length, in microseconds.
    // Read once the metadata is in: before that `duration` is NaN and the
    // row had no real-time factor.
    await page
      .waitForFunction(() => (document.querySelector('video')?.duration ?? 0) > 0, null, { timeout: 60_000 })
      .catch(() => undefined);
    const us = await page.evaluate(() => Math.round((document.querySelector('video')?.duration ?? 0) * 1_000_000));
    requestedSeconds = Number.isFinite(us) && us > 0 ? us / 1_000_000 : null;
  } else {
    // Long outputs from a 20 s source by reusing ranges (doc 10 allows repeats).
    // 15 s per moment keeps 300 s inside the 20-moment policy limit.
    const perMoment = 15;
    const moments = Math.max(1, Math.round(seconds / perMoment));
    for (let i = 0; i < moments; i += 1) {
      const from = i % 2 === 0 ? 0 : 5;
      await addKesit(page, from.toFixed(3), (from + perMoment).toFixed(3));
    }
    requestedSeconds = moments * perMoment;
  }
  // What the browser says it has room for, before the export starts.
  const storageBefore = await page.evaluate(async () => {
    const estimate = await navigator.storage.estimate();
    return { quota: estimate.quota ?? null, usage: estimate.usage ?? null };
  });

  if (aspect) await setAspect(page, aspect);
  await setQuality(page, quality);

  // The capability gate runs in the background once the video is open;
  // give it time to finish, as the old dialog waited for it.
  await page.waitForTimeout(3000);

  // Let memory settle before measuring the baseline.
  await page.waitForTimeout(1500);
  const sampling = startSampler(browserPid);
  // PowerShell takes a moment to start; a baseline taken before its first
  // samples would silently be empty, so wait for real readings.
  const waitUntil = Date.now() + 20_000;
  while (sampling.samples.length < 3 && Date.now() < waitUntil) {
    await page.waitForTimeout(200);
  }
  const baselineSamples = sampling.samples.slice();
  const baseline =
    baselineSamples.length > 0
      ? baselineSamples.reduce((max, s) => (s.total > max.total ? s : max), baselineSamples[0])
      : null;

  const startedAt = Date.now();
  await page.getByTestId('download-all').click();

  let finished = false;
  while (Date.now() - startedAt < timeoutMs) {
    if ((await page.getByTestId('export-succeeded').count()) > 0) {
      finished = true;
      break;
    }
    if ((await page.getByTestId('export-failed').count()) > 0) break;
    await page.waitForTimeout(300);
  }
  const elapsedMs = Date.now() - startedAt;

  // Keep sampling briefly: the finished file is handed to the page as a Blob,
  // which is part of what the user's machine has to hold.
  await page.waitForTimeout(1500);
  sampling.stop();

  const during = sampling.samples.filter((s) => s.at >= startedAt);
  const peakTotal = during.reduce((max, s) => Math.max(max, s.total), 0);
  const peakLargest = during.reduce((max, s) => Math.max(max, s.largest), 0);

  // Flat or growing? The peak of each tenth of the run shows the trend a
  // single peak number hides.
  const tenths = [];
  if (during.length > 0) {
    const span = Math.max(1, elapsedMs);
    for (let i = 0; i < 10; i += 1) {
      const from = startedAt + (span * i) / 10;
      const to = startedAt + (span * (i + 1)) / 10;
      const slice = during.filter((s) => s.at >= from && s.at < to);
      tenths.push(slice.length ? Number((slice.reduce((m, s) => Math.max(m, s.total), 0) / MIB).toFixed(0)) : null);
    }
  }

  const row = {
    requestedSeconds,
    quality,
    finished,
    elapsedMs,
    realTimeFactor: requestedSeconds ? Number((requestedSeconds / (elapsedMs / 1000)).toFixed(2)) : null,
    sampleCount: during.length,
    baselineTotalMib: baseline ? Number((baseline.total / MIB).toFixed(0)) : null,
    peakTotalMib: Number((peakTotal / MIB).toFixed(0)),
    peakLargestProcessMib: Number((peakLargest / MIB).toFixed(0)),
    growthMib: baseline ? Number(((peakTotal - baseline.total) / MIB).toFixed(0)) : null,
    peakMibPerTenth: tenths,
    storageBefore,
  };

  if (finished) {
    row.route = ((await page.getByTestId('measured-route').textContent().catch(() => '')) ?? '').trim();
    // ADR-027: which way the file was made ('copy' / 'smart' / 'encode').
    row.method = await page.getByTestId('export-method').first().getAttribute('data-method').catch(() => null);
    // The finished file sits in OPFS while the dialog offers it.
    row.exportFilesWhileOffered = await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      let count = 0;
      for await (const name of root.keys()) if (name.startsWith('clip-export-')) count += 1;
      return count;
    });
    const artefact = join(outDir, `mem-${row.requestedSeconds}s-${quality}.mp4`);
    const download = page.waitForEvent('download', { timeout: 600_000 });
    await page.getByTestId('export-download').click();
    await (await download).saveAs(artefact);
    const probe = ffprobeJson(artefact);
    const video = probe?.streams.find((s) => s.codec_type === 'video');
    const bytes = statSync(artefact).size;
    row.outputMib = Number((bytes / MIB).toFixed(1));
    row.measuredSeconds = probe ? Number(Number(probe.format.duration).toFixed(3)) : null;
    row.frames = video ? Number(video.nb_frames) : null;
    row.videoBitrateMbps = video?.bit_rate ? Number((Number(video.bit_rate) / 1e6).toFixed(2)) : null;
    // An absolute fixture is someone's own recording: do not leave a copy of
    // it behind once it has been measured.
    // `--delete-output`: a 60-minute 1080p file is gigabytes; keep the numbers.
    // `--keep-output=<path>`: keep this run's file there instead (ADR-028: a
    // frame-by-frame comparison of two builds' outputs).
    const keepAs = argValue('keep-output', '');
    if (keepAs) renameSync(artefact, keepAs);
    else if (isAbsolute(fixture) || args.includes('--delete-output')) rmSync(artefact, { force: true });
  } else {
    const failure = await page.getByTestId('export-failed').textContent().catch(() => null);
    row.failure = failure ? failure.replace(/\s+/g, ' ').trim() : 'zaman aşımı';
  }
  row.pageErrors = pageErrors;
  if (profile) row.profile = profiles.at(-1) ?? null;

  // Close the dialog like a user would; the app then deletes its temp file.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  row.leftoverExportFiles = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    let count = 0;
    for await (const name of root.keys()) if (name.startsWith('clip-export-')) count += 1;
    return count;
  });

  rows.push(row);
  await page.close();

  console.log(
    `${String(row.requestedSeconds).padStart(4)} s ${quality}p -> ${finished ? 'OK  ' : 'FAIL'} ` +
      `çıktı ${row.outputMib ?? '—'} MiB (${row.videoBitrateMbps ?? '—'} Mbit/s), ` +
      `${row.frames ?? '—'} kare, ${(elapsedMs / 1000).toFixed(1)} s (x${row.realTimeFactor ?? '—'}), yol: ${row.route ?? '—'}, yöntem: ${row.method ?? '—'} | ` +
      `bellek: taban ${row.baselineTotalMib} MiB, tepe ${row.peakTotalMib} MiB ` +
      `(+${row.growthMib}), en büyük süreç ${row.peakLargestProcessMib} MiB, ${row.sampleCount} örnek, ` +
      `kalan geçici dosya ${row.leftoverExportFiles}` +
      (row.failure ? ` — ${row.failure}` : ''),
  );
  if (row.profile) {
    const stages = Object.entries(row.profile.stages ?? {})
      .sort((a, b) => b[1].totalMs - a[1].totalMs)
      .map(([name, s]) => `${name} ${(s.totalMs / 1000).toFixed(1)} s (${(s.share * 100).toFixed(1)}%, ort. ${s.meanMs} ms)`);
    console.log(`  profil: ${row.profile.framesPerSecond} kare/sn — ${stages.join(', ')}`);
  }
}

await context.close();
if (browser) await browser.close();
if (server) await server.close();
if (profileDir) rmSync(profileDir, { recursive: true, force: true });

const report = {
  browser: channel || 'chromium',
  profile: persistent ? 'persistent' : 'non-persistent',
  fixture,
  ranAt: new Date().toISOString(),
  method:
    'Tarayıcı süreç ağacının (ana süreç + renderer + GPU + yardımcılar) private bytes değeri ' +
    'işletim sisteminden ~400 ms aralıkla örneklendi. Encode worker renderer sürecinin içinde çalışır.',
  label: argValue('label', 'current'),
  rows,
};
// One file per labelled run, so an A/B comparison never overwrites itself.
const reportPath = join(outDir, `export-memory-${quality}-${report.label}.json`);
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`\nyazıldı: ${reportPath}`);
