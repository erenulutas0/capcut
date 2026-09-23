/**
 * How much disk does an export really need? (ADR-023)
 *
 * Drives the real editor with a persistent (disk-backed) profile and, while
 * the export runs and while the finished file is saved, samples:
 *
 * - the size of the profile's OPFS folder on disk (what the export writes),
 * - `navigator.storage.estimate()` as the page sees it (what the app checks),
 * - the real free space of the drive that holds the profile,
 * - the private memory of the browser process tree during the save.
 *
 * The result says whether the muxer writes the file once or needs a second
 * copy, how close the size estimate is to the real file, what "Bilgisayara
 * kaydet" does, and whether the storage estimate tracks the real disk.
 *
 * Windows only (the memory sampler is PowerShell). Needs a running server:
 *
 *   node scripts/measure-export-storage.mjs --fixture=D:/long.mp4 --whole --quality=1080
 *   node scripts/measure-export-storage.mjs --seconds=60 --browser=chrome --profile-root=E:/tmp
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, statfsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

import { ffprobeJson } from './lib/media-measure.mjs';
import { emptyTimeline } from './lib/range-flow.mjs';

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
const seconds = Number(argValue('seconds', '60'));
const quality = argValue('quality', '1080');
const channel = argValue('browser', '');
const fixture = argValue('fixture', 'l01-dense-1080p.mp4');
const whole = args.includes('--whole');
/** Where the temporary profile lives: its drive is the disk being measured. */
const profileRoot = argValue('profile-root', tmpdir());
const timeoutMs = Number(argValue('timeout-min', '30')) * 60_000;
const label = argValue('label', 'current');

if (process.platform !== 'win32') {
  console.error('Bu ölçüm şimdilik yalnızca Windows süreç örnekleyicisiyle çalışıyor.');
  process.exit(2);
}

mkdirSync(outDir, { recursive: true });
const MIB = 1048576;
const mib = (bytes) => (bytes === null || bytes === undefined ? null : Number((bytes / MIB).toFixed(1)));

/** Bytes under a folder, recursively; files being written are counted too. */
function folderBytes(path) {
  let total = 0;
  let entries;
  try {
    entries = readdirSync(path, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = join(path, entry.name);
    try {
      if (entry.isDirectory()) total += folderBytes(full);
      else total += statSync(full).size;
    } catch {
      // A file removed between listing and stat.
    }
  }
  return total;
}

function driveFreeBytes(path) {
  const stats = statfsSync(path);
  return Number(stats.bavail) * Number(stats.bsize);
}

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
      const [at, total] = line.trim().split(/\s+/).map(Number);
      if (Number.isFinite(total)) samples.push({ at, total });
    }
  });
  return { samples, stop: () => child.kill() };
}

function findBrowserPid(userDataDir) {
  const needle = userDataDir.replace(/'/g, "''");
  const script =
    `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${needle}*' -and ` +
    `$_.CommandLine -notlike '*--type=*' } | Select-Object -First 1 -ExpandProperty ProcessId`;
  const result = spawnSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8' });
  const pid = Number((result.stdout || '').trim());
  return Number.isFinite(pid) && pid > 0 ? pid : null;
}

const profileDir = mkdtempSync(join(profileRoot, 'clip-storage-'));
const downloadsDir = mkdtempSync(join(profileRoot, 'clip-downloads-'));
const context = await chromium.launchPersistentContext(profileDir, {
  ...(channel ? { channel } : {}),
  viewport: { width: 1440, height: 900 },
  acceptDownloads: true,
  downloadsPath: downloadsDir,
});
const browserPid = findBrowserPid(profileDir);
// OPFS lives under the profile; measuring the whole profile folder also
// catches any second copy or swap file the browser might make.
const opfsBytes = () => folderBytes(profileDir);

const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
await page.goto(`${baseURL}/editor`);
await page.getByTestId('video-input').setInputFiles(isAbsolute(fixture) ? fixture : join(mediaDir, fixture));
await page.getByTestId('preview-video').waitFor({ timeout: 120_000 });

let requestedSeconds;
if (whole) {
  await page.getByTestId('strip-clip').first().waitFor({ timeout: 60_000 });
  const us = Number((await page.getByTestId('output-duration-us').textContent()) ?? '');
  requestedSeconds = Number.isFinite(us) && us > 0 ? us / 1_000_000 : null;
} else {
  await emptyTimeline(page);
  const perMoment = 15;
  const moments = Math.max(1, Math.round(seconds / perMoment));
  for (let i = 0; i < moments; i += 1) {
    const from = i % 2 === 0 ? 0 : 5;
    await page.getByTestId('range-start').fill(from.toFixed(3));
    await page.getByTestId('range-end').fill((from + perMoment).toFixed(3));
    await page.getByTestId('add-moment').click();
  }
  requestedSeconds = moments * perMoment;
}

const estimate = () =>
  page.evaluate(async () => {
    const value = await navigator.storage.estimate();
    return { quota: value.quota ?? null, usage: value.usage ?? null };
  });

await page.getByTestId('open-export').click();
await page.getByTestId('export-quality').selectOption(quality);
await page.getByTestId('export-ready').waitFor({ timeout: 90_000 });

const before = {
  estimate: await estimate(),
  driveFree: driveFreeBytes(profileDir),
  profileBytes: opfsBytes(),
};

const trace = [];
const startedAt = Date.now();
await page.getByTestId('export-create').click();
let finished = false;
let lastEstimateAt = 0;
while (Date.now() - startedAt < timeoutMs) {
  const at = Date.now();
  const sample = { t: at - startedAt, profileBytes: opfsBytes(), driveFree: driveFreeBytes(profileDir) };
  if (at - lastEstimateAt > 2000) {
    sample.estimate = await estimate().catch(() => null);
    lastEstimateAt = at;
  }
  trace.push(sample);
  if ((await page.getByTestId('export-succeeded').count()) > 0) {
    finished = true;
    break;
  }
  if ((await page.getByTestId('export-failed').count()) > 0) break;
  await page.waitForTimeout(500);
}
const elapsedMs = Date.now() - startedAt;

const row = {
  browser: channel || 'chromium',
  fixture: isAbsolute(fixture) ? '(yerel dosya)' : fixture,
  requestedSeconds,
  quality,
  finished,
  elapsedMs,
  before: {
    quotaMib: mib(before.estimate.quota),
    usageMib: mib(before.estimate.usage),
    estimateFreeMib: mib((before.estimate.quota ?? 0) - (before.estimate.usage ?? 0)),
    driveFreeMib: mib(before.driveFree),
    profileMib: mib(before.profileBytes),
  },
  peakProfileGrowthMib: mib(Math.max(...trace.map((s) => s.profileBytes)) - before.profileBytes),
  minDriveFreeDuringExportMib: mib(Math.min(...trace.map((s) => s.driveFree))),
  pageErrors,
};

if (finished) {
  const afterExport = {
    estimate: await estimate(),
    driveFree: driveFreeBytes(profileDir),
    profileBytes: opfsBytes(),
  };
  row.afterExport = {
    usageMib: mib(afterExport.estimate.usage),
    estimateFreeMib: mib((afterExport.estimate.quota ?? 0) - (afterExport.estimate.usage ?? 0)),
    driveFreeMib: mib(afterExport.driveFree),
    profileGrowthMib: mib(afterExport.profileBytes - before.profileBytes),
  };
  row.route = ((await page.getByTestId('measured-route').textContent().catch(() => '')) ?? '').trim();

  // "Bilgisayara kaydet": sample the disk and the browser's memory while the
  // browser writes the file out of OPFS.
  const sampling = browserPid ? startSampler(browserPid) : null;
  const waitUntil = Date.now() + 20_000;
  while (sampling && sampling.samples.length < 3 && Date.now() < waitUntil) await page.waitForTimeout(200);
  const memBaseline = sampling ? Math.max(...sampling.samples.map((s) => s.total)) : null;
  const downloadTrace = [];
  const downloadStarted = Date.now();
  const downloadPromise = page.waitForEvent('download', { timeout: 600_000 });
  await page.getByTestId('export-download').click();
  const download = await downloadPromise;
  let savedPath = null;
  const pathPromise = download.path().then((p) => (savedPath = p));
  while (savedPath === null && Date.now() - downloadStarted < 600_000) {
    downloadTrace.push({
      t: Date.now() - downloadStarted,
      driveFree: driveFreeBytes(downloadsDir),
      downloadsBytes: folderBytes(downloadsDir),
      profileBytes: opfsBytes(),
    });
    await Promise.race([pathPromise, page.waitForTimeout(250)]);
  }
  const downloadMs = Date.now() - downloadStarted;
  await page.waitForTimeout(800);
  sampling?.stop();
  const during = sampling ? sampling.samples.filter((s) => s.at >= downloadStarted) : [];
  const bytes = statSync(savedPath).size;
  const probe = ffprobeJson(savedPath);
  const video = probe?.streams.find((s) => s.codec_type === 'video');
  const audio = probe?.streams.find((s) => s.codec_type === 'audio');
  row.outputBytes = bytes;
  row.outputMib = mib(bytes);
  row.measuredSeconds = probe ? Number(Number(probe.format.duration).toFixed(3)) : null;
  row.width = video?.width ?? null;
  row.height = video?.height ?? null;
  row.videoBitrate = video?.bit_rate ? Number(video.bit_rate) : null;
  row.audioBitrate = audio?.bit_rate ? Number(audio.bit_rate) : null;
  row.download = {
    ms: downloadMs,
    driveFreeDropMib: mib(afterExport.driveFree - Math.min(...downloadTrace.map((s) => s.driveFree), driveFreeBytes(downloadsDir))),
    profileGrowthDuringSaveMib: mib(Math.max(...downloadTrace.map((s) => s.profileBytes), 0) - afterExport.profileBytes),
    memoryBaselineMib: memBaseline ? mib(memBaseline) : null,
    memoryPeakMib: during.length ? mib(Math.max(...during.map((s) => s.total))) : null,
    memorySamples: during.length,
  };
  rmSync(savedPath, { force: true });
} else {
  const failure = await page.getByTestId('export-failed').textContent().catch(() => null);
  row.failure = failure ? failure.replace(/\s+/g, ' ').trim() : 'zaman aşımı';
}

// Close the dialog like a user would; the app then deletes its temp file.
await page.keyboard.press('Escape');
await page.waitForTimeout(1500);
row.afterClose = {
  profileGrowthMib: mib(opfsBytes() - before.profileBytes),
  exportFiles: await page.evaluate(async () => {
    const dir = await navigator.storage.getDirectory();
    let count = 0;
    for await (const name of dir.keys()) if (name.startsWith('clip-export-')) count += 1;
    return count;
  }),
};
row.trace = trace.filter((_, i) => i % 4 === 0).map((s) => ({
  t: s.t,
  profileGrowthMib: mib(s.profileBytes - before.profileBytes),
  driveFreeMib: mib(s.driveFree),
  ...(s.estimate ? { estimateUsageMib: mib(s.estimate.usage), estimateQuotaMib: mib(s.estimate.quota) } : {}),
}));

await context.close();
rmSync(profileDir, { recursive: true, force: true });
rmSync(downloadsDir, { recursive: true, force: true });

const reportPath = join(outDir, `export-storage-${row.browser}-${quality}-${label}.json`);
writeFileSync(reportPath, `${JSON.stringify({ ranAt: new Date().toISOString(), profileRoot, ...row }, null, 2)}\n`);
const { trace: _trace, ...summary } = row;
console.log(JSON.stringify(summary, null, 2));
console.log(`\nyazıldı: ${reportPath}`);
