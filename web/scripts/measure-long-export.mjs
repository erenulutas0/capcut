/**
 * Long-export soak (docs/perf/2026-10-15-long-export.md): one full-length
 * download through the app's own path — the editor's "İndir" or a task
 * wizard's "İndir" — on a real browser profile on disk, with everything the
 * policy limits promise measured at the same time:
 *
 * - wall time and × realtime, and the worker's stage clock (ADR-028,
 *   `window.__clipExportProfile`): where the time went per stage;
 * - memory of the whole browser process tree, split by Chromium process
 *   type (browser / renderer / gpu-process / utility, ADR-029,
 *   `lib/process-memory.ps1`), every ~400 ms, as peak and floor per tenth of
 *   the run. The export worker runs inside the page's renderer
 *   (`renderer-max`); the hardware encoder inside `gpu-process`;
 * - disk: the bytes under the browser profile (OPFS lives there) and the
 *   drive's free space every 2 s — the reservation (ADR-023) against the
 *   finished file, and what is left after the dialog is closed;
 * - the saved file: ffprobe duration, frames, codecs, size; the source frame
 *   shown at the start, middle and end (the barcode of
 *   `generate-long-media.mjs`); sound against picture from the source's own
 *   pause pattern (every 13 s: pauses at 4,0–5,5, 9,0–9,3 and 11,5–13,0 s);
 * - whether the page's stall watchdog (ADR-042) or the page watchdog
 *   (ADR-044) spoke, and every console error.
 *
 * Windows only (the sampler is PowerShell). The server must be running
 * (SHOT_URL, default :3100). Takes the machine's measurement lock for the
 * run and releases it afterwards.
 *
 *   node scripts/measure-long-export.mjs --source=<file> --task=editor --browser=chrome --mode=encode
 *   node scripts/measure-long-export.mjs --source=<file> --task=kes --kesit=10,3590
 *   node scripts/measure-long-export.mjs --source=<file> --task=editor --kesitler=20
 *   node scripts/measure-long-export.mjs --source=<file> --task=kucult --size=whatsapp
 *   node scripts/measure-long-export.mjs --source=<file> --task=editor --cancel-at=0.5
 *
 *   --task       editor (İndir / Hepsini birleştirip indir), kes, bosluk,
 *                kucult, ses, sustur, cevir
 *   --browser    chrome | msedge | (empty: Playwright's Chromium, software encoder)
 *   --mode       encode: force the full re-encode (`__clipExportMode`, ADR-027)
 *   --kesitler   editor: N kesitler of equal length covering the whole source
 *   --kesit      kes/editor: one kesit, "start,end" in seconds
 *   --size       kucult: whatsapp | email | share | half (default: the wizard's own)
 *   --cancel-at  press "Vazgeç" once the progress reaches this fraction
 *   --route      file (the save dialog, what desktop Chrome has; default) | opfs
 *                ("Bilgisayara kaydet", the fallback route)
 *   --label      name of the result file (matrix-results/long-export/<label>.json)
 *   --timeout-min  default 120
 *   --source-width / --source-fps   barcode geometry (1920 / 30)
 *   --keep-output  keep the saved file (default: deleted after it is measured)
 *   --no-lock    do not take the measurement lock (only when the caller holds it)
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, statfsSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

import { readFrameNumber } from './lib/frame-barcode.mjs';
import { addKesit, installSavePicker, lastPickedName, readPickedFile, removePickedFiles, removeSavePicker, setQuality } from './lib/kesit-flow.mjs';
import { ffprobeJson } from './lib/media-measure.mjs';
import { acquire, release } from './lib/measure-lock.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, 'matrix-results', 'long-export');
const sampler = join(root, 'scripts', 'lib', 'process-memory.ps1');
const baseURL = process.env.SHOT_URL ?? 'http://127.0.0.1:3100';

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const found = args.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};
const sourceArg = argValue('source', '');
if (!sourceArg) {
  console.error('--source=<file> gerekli');
  process.exit(2);
}
const source = isAbsolute(sourceArg) ? sourceArg : join(root, sourceArg);
const task = argValue('task', 'editor');
const channel = argValue('browser', '');
const forceEncode = argValue('mode', 'auto') === 'encode';
const kesitler = Number(argValue('kesitler', '0'));
const kesit = argValue('kesit', '').split(',').map(Number).filter((n) => Number.isFinite(n));
const sizeChoice = argValue('size', '');
const cancelAt = Number(argValue('cancel-at', '0'));
const route = argValue('route', 'file');
const label = argValue('label', `${task}-${basename(source).replace(/\.[^.]+$/, '')}-${channel || 'chromium'}`);
const timeoutMs = Number(argValue('timeout-min', '120')) * 60_000;
const sourceWidth = Number(argValue('source-width', '1920'));
const sourceFps = Number(argValue('source-fps', '30'));
const keepOutput = args.includes('--keep-output');
const useLock = !args.includes('--no-lock');
const quality = argValue('quality', '');

if (process.platform !== 'win32') {
  console.error('Bu ölçüm yalnızca Windows süreç örnekleyicisiyle çalışıyor.');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });
const MIB = 1048576;
const mib = (bytes) => (bytes === null || bytes === undefined ? null : Number((bytes / MIB).toFixed(1)));
// Optional elements: an absent one answers null at once instead of after Playwright's 30 s wait.
const text = async (locator) => ((await locator.first().textContent({ timeout: 500 }).catch(() => null)) ?? '').replace(/\s+/g, ' ').trim() || null;
const attr = (locator, name) => locator.first().getAttribute(name, { timeout: 500 }).catch(() => null);

/* ----------------------------------------------------------------- sampling */

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

/** The OS-level sampler of a browser process tree, split by process type (ADR-029). */
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
      const fields = line.trim().split(/\s+/);
      const [at, total, largest, count] = fields.slice(0, 4).map(Number);
      const byType = {};
      for (const part of (fields[4] ?? '').split(',')) {
        const cut = part.lastIndexOf(':');
        if (cut > 0) byType[part.slice(0, cut)] = Number(part.slice(cut + 1));
      }
      if (Number.isFinite(total)) samples.push({ at, total, largest, count, byType });
    }
  });
  return { samples, stop: () => child.kill() };
}

/** Peak and floor of `pick(sample)` in each tenth of [from, to]. */
function tenths(samples, from, to, pick) {
  const span = Math.max(1, to - from);
  const peaks = [];
  const floors = [];
  for (let i = 0; i < 10; i += 1) {
    const a = from + (span * i) / 10;
    const b = from + (span * (i + 1)) / 10;
    const values = samples.filter((s) => s.at >= a && s.at < b).map(pick).filter((v) => Number.isFinite(v));
    peaks.push(values.length ? Number((Math.max(...values) / MIB).toFixed(0)) : null);
    floors.push(values.length ? Number((Math.min(...values) / MIB).toFixed(0)) : null);
  }
  return { peaks, floors };
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

/* -------------------------------------------------------------- file checks */

/**
 * Sound against picture, from the source's own pause pattern: in each 13 s
 * of source time the voice stops at 4,0, 9,0 and 11,5 s and starts at 5,5,
 * 9,3 and 13,0 s. `ranges` map output time to source time
 * ([outStart, srcStart, length] per piece). In a 30 s window at each of
 * start / middle / end the measured edges are compared with the expected
 * ones: the median deviation is the sound's offset against the picture
 * (positive = sound late). Silent output (Sesi kapat) is skipped.
 */
function audioEdgeOffsets(file, ranges, durationS) {
  const windows = [0, Math.max(0, durationS / 2 - 15), Math.max(0, durationS - 31)].map((t) => Math.min(t, Math.max(0, durationS - 2)));
  const results = [];
  for (const start of windows) {
    const length = Math.min(30, durationS - start);
    const probe = spawnSync(
      'ffmpeg',
      ['-hide_banner', '-nostats', '-ss', start.toFixed(3), '-t', length.toFixed(3), '-i', file, '-vn', '-af', 'silencedetect=n=-30dB:d=0.2', '-f', 'null', '-'],
      { encoding: 'utf8', maxBuffer: 16 * MIB },
    );
    const edges = [];
    for (const match of String(probe.stderr).matchAll(/silence_(start|end): ([0-9.]+)/g)) {
      edges.push({ kind: match[1], atOut: start + Number(match[2]) });
    }
    const deviations = [];
    for (const edge of edges) {
      const piece = ranges.find((r) => edge.atOut >= r[0] - 0.05 && edge.atOut < r[0] + r[2] + 0.05);
      if (!piece) continue;
      const src = piece[1] + (edge.atOut - piece[0]);
      const phase = ((src % 13) + 13) % 13;
      const expected = edge.kind === 'start' ? [4.0, 9.0, 11.5] : [5.5, 9.3, 13.0, 0.0];
      const nearest = expected.reduce((best, e) => (Math.abs(phase - e) < Math.abs(phase - best) ? e : best), expected[0]);
      let d = phase - nearest;
      if (d > 6.5) d -= 13;
      if (d < -6.5) d += 13;
      // An edge more than 0,4 s away from any expected one is not an offset but a different sound.
      if (Math.abs(d) <= 0.4) deviations.push(Number((d * 1000).toFixed(1)));
    }
    deviations.sort((a, b) => a - b);
    const median = deviations.length ? deviations[Math.floor(deviations.length / 2)] : null;
    results.push({ windowStartS: Number(start.toFixed(1)), edges: edges.length, matched: deviations.length, medianOffsetMs: median, minMs: deviations[0] ?? null, maxMs: deviations.at(-1) ?? null });
  }
  return results;
}

/** The source frame on output frames at the start, middle and end, against the one the recipe says. */
function frameIdentity(file, ranges, frames, outputWidth) {
  const picks = [0, 1, Math.floor(frames / 2), frames - 2, frames - 1].filter((f, i, all) => f >= 0 && all.indexOf(f) === i);
  const checks = [];
  for (const index of picks) {
    const outT = index / sourceFps;
    const piece = ranges.find((r) => outT >= r[0] - 1e-6 && outT < r[0] + r[2] - 1e-6) ?? ranges.at(-1);
    const expected = Math.round((piece[1] + (outT - piece[0])) * sourceFps);
    let read = null;
    let error = null;
    try {
      read = readFrameNumber(file, index, { fps: sourceFps, sourceWidth, outputWidth });
    } catch (e) {
      error = String(e.message).split('\n')[0];
    }
    checks.push({ outputFrame: index, expectedSourceFrame: expected, shown: read?.frame ?? null, confidence: read?.confidence ?? null, ok: read ? read.frame === expected : false, ...(error ? { error } : {}) });
  }
  return checks;
}

/* ------------------------------------------------------------------- the run */

const row = {
  label,
  task,
  browser: channel || 'chromium',
  route,
  source: basename(source),
  sourceBytes: statSync(source).size,
  mode: forceEncode ? 'encode' : 'auto',
  ranAt: new Date().toISOString(),
  consoleErrors: [],
  pageErrors: [],
};
const sourceProbe = ffprobeJson(source);
const sourceDurationS = sourceProbe ? Number(sourceProbe.format.duration) : null;
row.sourceSeconds = sourceDurationS;

if (useLock) await acquire(`long-export ${label}`);
const profileRoot = join(outDir, 'profiles');
mkdirSync(profileRoot, { recursive: true });
const profileDir = mkdtempSync(join(profileRoot, 'p-'));
let context = null;
let sampling = null;
let diskTimer = null;
try {
  context = await chromium.launchPersistentContext(profileDir, {
    ...(channel ? { channel } : {}),
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
  });
  const browserPid = findBrowserPid(profileDir);
  if (!browserPid) throw new Error('kalıcı profilin tarayıcı süreci bulunamadı');
  row.browserVersion = context.browser()?.version() ?? null;

  const page = await context.newPage();
  page.on('pageerror', (error) => row.pageErrors.push(String(error.message).split('\n')[0]));
  const profiles = [];
  page.on('console', (message) => {
    const t = message.text();
    if (t.startsWith('[clip-export-profile] ')) {
      try {
        profiles.push(JSON.parse(t.slice('[clip-export-profile] '.length)));
      } catch {
        // A malformed line is not a measurement.
      }
    } else if (message.type() === 'error' && row.consoleErrors.length < 50) {
      row.consoleErrors.push(t.slice(0, 300));
    }
  });
  await page.addInitScript(() => {
    window.__clipExportProfile = true;
  });
  if (forceEncode) {
    await page.addInitScript(() => {
      window.__clipExportMode = 'encode';
    });
  }
  if (route === 'opfs') await removeSavePicker(page);
  else await installSavePicker(page);

  const url = task === 'editor' ? `${baseURL}/editor/` : `${baseURL}/yap/${task}/`;
  await page.goto(url, { waitUntil: 'load' });
  await page.locator('html[data-clip-alive]').waitFor({ state: 'attached', timeout: 60_000 });
  // No leftovers from an earlier run can exist in a fresh profile; said explicitly.
  row.opfsBefore = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const names = [];
    for await (const name of root.keys()) names.push(name);
    return names;
  });

  const openedAt = Date.now();
  await page.getByTestId('video-input').setInputFiles(source);

  /** [outStart, srcStart, length] per piece, in seconds. */
  let ranges = [[0, 0, sourceDurationS ?? 0]];
  let startButton = page.getByTestId('wizard-download');
  if (task === 'editor' || task === 'kes') {
    await page.getByTestId('preview-video').waitFor({ timeout: 180_000 });
    await page.waitForFunction(() => (document.querySelector('video')?.duration ?? 0) > 0, null, { timeout: 180_000 }).catch(() => undefined);
    row.openS = Number(((Date.now() - openedAt) / 1000).toFixed(1));
    row.mediaError = await text(page.getByTestId('media-error'));
    if (quality) await setQuality(page, quality);
    if (kesit.length === 2) {
      await addKesit(page, kesit[0].toFixed(3), kesit[1].toFixed(3));
      ranges = [[0, kesit[0], kesit[1] - kesit[0]]];
      startButton = task === 'kes' ? page.getByTestId('kesit-download').first() : page.getByTestId('download-all');
    } else if (kesitler > 0) {
      const each = Math.floor(((sourceDurationS ?? 0) / kesitler) * 1000) / 1000;
      ranges = [];
      for (let i = 0; i < kesitler; i += 1) {
        const from = Number((i * each).toFixed(3));
        const to = Number(Math.min(sourceDurationS ?? 0, (i + 1) * each).toFixed(3));
        await addKesit(page, from.toFixed(3), to.toFixed(3));
        ranges.push([i * each, from, to - from]);
      }
      startButton = page.getByTestId('download-all');
    } else {
      startButton = page.getByTestId('download-all');
    }
  } else if (task === 'bosluk') {
    await page.locator('[data-testid="bosluk-summary"], [data-testid="bosluk-unclear"], [data-testid="bosluk-problem"]').first().waitFor({ timeout: 30 * 60_000 });
    row.analyseS = Number(((Date.now() - openedAt) / 1000).toFixed(1));
    row.bosluk = {
      found: await text(page.getByTestId('bosluk-found')),
      shorter: await text(page.getByTestId('bosluk-shorter')),
      limit: await text(page.getByTestId('bosluk-limit')),
      unclear: await text(page.getByTestId('bosluk-unclear')),
      problem: await text(page.getByTestId('bosluk-problem')),
    };
    // Which pieces stay is the wizard's own decision; frame identity cannot be
    // predicted here, the pause pattern can (silence is what was removed).
    ranges = null;
  } else if (task === 'kucult') {
    await page.getByTestId('kucult-choice').waitFor({ timeout: 10 * 60_000 });
    row.openS = Number(((Date.now() - openedAt) / 1000).toFixed(1));
    const hints = {};
    const ids = await page.locator('[data-testid^="size-hint-"]').evaluateAll((els) => els.map((el) => el.getAttribute('data-testid').slice('size-hint-'.length)));
    for (const id of ids) {
      await page.locator(`[data-testid="size-hint-${id}"]:not([data-state="pending"])`).waitFor({ timeout: 10 * 60_000 }).catch(() => undefined);
      const hint = page.getByTestId(`size-hint-${id}`);
      hints[id] = { text: await text(hint), state: await attr(hint, 'data-state'), plannedBytes: Number(await attr(hint, 'data-planned-bytes')) || null, minBytes: Number(await attr(hint, 'data-min-bytes')) || null, shortEdge: await attr(hint, 'data-short-edge') };
    }
    row.hintsS = Number(((Date.now() - openedAt) / 1000).toFixed(1));
    row.kucult = { hints, options: ids };
    if (sizeChoice && ids.includes(sizeChoice)) await page.getByTestId(`option-${sizeChoice}`).check();
    row.kucult.chosen = await page.locator('[data-testid="kucult-choice"] input[type="radio"]:checked').getAttribute('value').catch(() => null);
  } else {
    await page.getByTestId(`${task}-info`).waitFor({ timeout: 10 * 60_000 });
    row.openS = Number(((Date.now() - openedAt) / 1000).toFixed(1));
    row.info = await text(page.getByTestId(`${task}-info`));
  }
  row.ranges = ranges;

  // The capability gate runs in the background once the video is open.
  await page.waitForTimeout(3000);
  row.blockedBefore = await text(page.getByTestId('wizard-blocked'));
  const startEnabled = await startButton.first().isEnabled().catch(() => false);
  row.startButton = { text: await text(startButton), enabled: startEnabled };

  row.storageEstimateBefore = await page.evaluate(async () => {
    const e = await navigator.storage.estimate();
    return { quota: e.quota ?? null, usage: e.usage ?? null };
  });
  const diskSamples = [];
  const sampleDisk = () => diskSamples.push({ at: Date.now(), profileBytes: folderBytes(profileDir), driveFree: driveFreeBytes(profileDir) });
  sampleDisk();
  row.disk = { before: { profileMib: mib(diskSamples[0].profileBytes), driveFreeMib: mib(diskSamples[0].driveFree) } };
  diskTimer = setInterval(sampleDisk, 2000);

  sampling = startSampler(browserPid);
  const waitUntil = Date.now() + 20_000;
  while (sampling.samples.length < 3 && Date.now() < waitUntil) await page.waitForTimeout(200);
  const baseline = sampling.samples.reduce((max, s) => (max === null || s.total > max.total ? s : max), null);
  row.memory = { baselineMib: baseline ? mib(baseline.total) : null, baselineByType: Object.fromEntries(Object.entries(baseline?.byType ?? {}).map(([k, v]) => [k, mib(v)])) };

  if (!startEnabled) {
    row.outcome = 'blocked-before-start';
    row.message = row.blockedBefore;
  } else {
    const startedAt = Date.now();
    row.startedAt = startedAt;
    await startButton.first().click();
    const outcomes = ['download-saved', 'export-succeeded', 'export-failed', 'export-blocked', 'export-canceled', 'wizard-blocked'];
    let outcome = null;
    let progressSeen = [];
    let cancelClickedAt = null;
    let firstProgressAt = null;
    while (Date.now() - startedAt < timeoutMs) {
      for (const id of outcomes) {
        if ((await page.getByTestId(id).count()) > 0) {
          // The wizard's own block line exists before the click too; count it only with no progress.
          if (id === 'wizard-blocked' && progressSeen.length > 0) continue;
          outcome = id;
          break;
        }
      }
      if (outcome) break;
      const progressEl = page.getByTestId('export-progress');
      const progress = (await progressEl.count()) > 0 ? await text(progressEl) : null;
      const match = progress ? /%\s?(\d+)/.exec(progress) : null;
      if (match) {
        const pct = Number(match[1]);
        if (firstProgressAt === null) firstProgressAt = Date.now();
        if (progressSeen.at(-1)?.pct !== pct) progressSeen.push({ at: Date.now() - startedAt, pct });
        if (cancelAt > 0 && cancelClickedAt === null && pct >= cancelAt * 100) {
          cancelClickedAt = Date.now();
          await page.getByTestId('export-cancel').click();
          row.cancel = { askedAtMs: cancelClickedAt - startedAt, askedAtPercent: pct };
        }
      }
      const dead = await attr(page.getByTestId('page-dead'), 'data-state');
      if (dead && dead !== 'hidden') {
        row.pageWatchdog = dead;
      }
      await page.waitForTimeout(250);
    }
    const endedAt = Date.now();
    row.elapsedS = Number(((endedAt - startedAt) / 1000).toFixed(1));
    row.outcome = outcome ?? 'timeout';
    row.firstProgressMs = firstProgressAt ? firstProgressAt - startedAt : null;
    row.progressSamples = progressSeen.length;
    if (cancelClickedAt) row.cancel.stoppedAfterMs = outcome ? endedAt - cancelClickedAt : null;
    row.pageWatchdog = row.pageWatchdog ?? 'hidden';

    // Memory and disk over the run.
    const during = sampling.samples.filter((s) => s.at >= startedAt && s.at <= endedAt);
    const types = [...new Set(during.flatMap((s) => Object.keys(s.byType ?? {})))];
    row.memory.samples = during.length;
    row.memory.peakTotalMib = mib(during.reduce((m, s) => Math.max(m, s.total), 0));
    row.memory.peakByType = Object.fromEntries(types.map((t) => [t, mib(during.reduce((m, s) => Math.max(m, s.byType?.[t] ?? 0), 0))]));
    row.memory.tenths = tenths(during, startedAt, endedAt, (s) => s.total);
    row.memory.tenthsByType = Object.fromEntries(types.map((t) => [t, tenths(during, startedAt, endedAt, (s) => s.byType?.[t] ?? NaN)]));
    const diskDuring = diskSamples.filter((s) => s.at >= startedAt && s.at <= endedAt + 2000);
    row.disk.peakProfileMib = mib(diskDuring.reduce((m, s) => Math.max(m, s.profileBytes), 0));
    row.disk.minDriveFreeMib = mib(diskDuring.reduce((m, s) => Math.min(m, s.driveFree), Infinity));
    row.disk.profileMibPerTenth = tenths(diskDuring, startedAt, endedAt, (s) => s.profileBytes).peaks;

    if (outcome === 'export-failed') {
      row.failure = {
        text: await text(page.getByTestId('export-failed')),
        reason: await text(page.getByTestId('export-failed-reason')),
        detail: await text(page.getByTestId('export-failed-detail')),
        storage: await text(page.getByTestId('export-failed-storage')),
      };
      row.stallWatchdog = /stall|takıl|yanıt vermedi|Stalled/i.test(`${row.failure.text} ${row.failure.detail}`) ? 'fired' : 'no';
    } else {
      row.stallWatchdog = 'no';
    }
    if (outcome === 'export-blocked' || outcome === 'wizard-blocked') {
      row.message = (await text(page.getByTestId('export-over-limit-text'))) ?? (await text(page.getByTestId('export-blocked'))) ?? (await text(page.getByTestId('wizard-blocked')));
      row.refusal = await text(page.getByTestId('target-size-refusal'));
    }
    if (outcome === 'export-canceled') row.message = await text(page.getByTestId('export-canceled'));

    if (outcome === 'download-saved' || outcome === 'export-succeeded') {
      const method = page.getByTestId('export-method').first();
      row.method = { method: await attr(method, 'data-method'), fallback: await attr(method, 'data-fallback'), text: await text(method) };
      row.measured = {};
      for (const key of ['duration', 'resolution', 'codecs', 'method', 'size', 'delta', 'route', 'frames-missing', 'elapsed']) {
        row.measured[key] = await text(page.getByTestId(`measured-${key}`));
      }
      row.savedText = await text(page.getByTestId('download-saved'));
      row.saveSpaceNote = await text(page.getByTestId('export-save-space'));
      const target = page.getByTestId('target-size-result').first();
      if ((await target.count()) > 0) {
        row.targetSize = { text: await text(target) };
        for (const key of ['fits', 'target-bytes', 'planned-bytes', 'actual-bytes', 'attempts', 'short-edge', 'video-bitrate', 'audio-bitrate', 'encoder', 'mode']) {
          row.targetSize[key] = await attr(target, `data-${key}`);
        }
      }
      // What the dialog is holding while it offers the file.
      row.opfsWhileOffered = await page.evaluate(async () => {
        const root = await navigator.storage.getDirectory();
        const names = [];
        for await (const [name, handle] of root.entries()) {
          const size = handle.kind === 'file' ? (await handle.getFile()).size : null;
          names.push({ name, size });
        }
        return names;
      });

      // Save the file out for ffprobe (the picked file is read 8 MiB at a time).
      const saveStartedAt = Date.now();
      let saved;
      if (route === 'file') {
        const name = await lastPickedName(page);
        saved = join(outDir, `${label}${name.slice(name.lastIndexOf('.'))}`);
        await readPickedFile(page, name, saved);
        await removePickedFiles(page);
      } else {
        const download = page.waitForEvent('download', { timeout: 30 * 60_000 });
        await page.getByTestId('export-download').click();
        const d = await download;
        saved = join(outDir, `${label}${d.suggestedFilename().slice(d.suggestedFilename().lastIndexOf('.'))}`);
        await d.saveAs(saved);
      }
      row.copyOutS = Number(((Date.now() - saveStartedAt) / 1000).toFixed(1));
      const probe = ffprobeJson(saved);
      const video = probe?.streams.find((s) => s.codec_type === 'video') ?? null;
      const audio = probe?.streams.find((s) => s.codec_type === 'audio') ?? null;
      const bytes = statSync(saved).size;
      const durationS = probe ? Number(Number(probe.format.duration).toFixed(3)) : null;
      row.file = {
        bytes,
        mib: mib(bytes),
        durationS,
        container: probe?.format.format_name ?? null,
        video: video ? { codec: video.codec_name, width: video.width, height: video.height, frames: Number(video.nb_frames) || null, bitrateMbps: video.bit_rate ? Number((Number(video.bit_rate) / 1e6).toFixed(2)) : null, fps: video.avg_frame_rate } : null,
        audio: audio ? { codec: audio.codec_name, sampleRate: Number(audio.sample_rate), channels: audio.channels, bitrateKbps: audio.bit_rate ? Math.round(Number(audio.bit_rate) / 1000) : null } : null,
        over2GiB: bytes > 2 * 1024 * MIB,
        over4GiB: bytes > 4 * 1024 * MIB,
      };
      row.realTimeFactor = durationS && row.elapsedS ? Number((durationS / row.elapsedS).toFixed(2)) : null;
      if (ranges && video && Number.isFinite(row.file.video.frames)) {
        row.frameIdentity = frameIdentity(saved, ranges, row.file.video.frames, video.width);
      }
      if (ranges && audio) row.audioSync = audioEdgeOffsets(saved, ranges, durationS);
      else if (!ranges && audio) row.audioSync = { skipped: 'bosluk: the kept pieces are the wizard’s own choice' };
      if (!keepOutput) rmSync(saved, { force: true });
      else row.savedAs = saved;
    }

    // Close the dialog like a user would; the app then deletes any temporary file.
    const dismiss = page.getByTestId('download-dismiss');
    if ((await dismiss.count()) > 0) await dismiss.first().click().catch(() => undefined);
    else await page.keyboard.press('Escape');
    await page.waitForTimeout(5000);
    row.opfsAfter = await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const names = [];
      for await (const [name, handle] of root.entries()) {
        const size = handle.kind === 'file' ? (await handle.getFile()).size : null;
        names.push({ name, size });
      }
      return names;
    });
    sampleDisk();
    const afterDisk = diskSamples.at(-1);
    row.disk.after = { profileMib: mib(afterDisk.profileBytes), driveFreeMib: mib(afterDisk.driveFree) };
    const afterMem = sampling.samples.filter((s) => s.at > endedAt + 3000);
    row.memory.afterMib = afterMem.length ? mib(afterMem.at(-1).total) : null;
    row.memory.afterByType = afterMem.length ? Object.fromEntries(Object.entries(afterMem.at(-1).byType ?? {}).map(([k, v]) => [k, mib(v)])) : null;
    // Memory released after a cancel: watch a further 15 s.
    if (cancelClickedAt) {
      await page.waitForTimeout(15000);
      const later = sampling.samples.at(-1);
      row.memory.after20sMib = later ? mib(later.total) : null;
      row.memory.after20sByType = later ? Object.fromEntries(Object.entries(later.byType ?? {}).map(([k, v]) => [k, mib(v)])) : null;
    }
  }
  row.profile = profiles.at(-1) ?? null;
  row.profileLines = profiles.length;
  await page.close();
} catch (error) {
  row.error = String(error?.stack ?? error).split('\n').slice(0, 4).join(' | ');
} finally {
  if (diskTimer) clearInterval(diskTimer);
  sampling?.stop();
  if (context) await context.close().catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  row.disk = row.disk ?? {};
  row.disk.profileAfterCloseMib = mib(folderBytes(profileDir));
  rmSync(profileDir, { recursive: true, force: true });
  if (useLock) release();
}

const reportPath = join(outDir, `${label}.json`);
writeFileSync(reportPath, `${JSON.stringify(row, null, 2)}\n`);

const stages = row.profile
  ? Object.entries(row.profile.stages ?? {})
      .sort((a, b) => b[1].totalMs - a[1].totalMs)
      .slice(0, 7)
      .map(([name, s]) => `${name} ${(s.totalMs / 1000).toFixed(1)} s (${(s.share * 100).toFixed(0)}%, ${s.meanMs} ms)`)
      .join(', ')
  : '—';
console.log(
  `${label}: ${row.outcome ?? row.error} — ${row.elapsedS ?? '—'} s (×${row.realTimeFactor ?? '—'}), ` +
    `dosya ${row.file?.mib ?? '—'} MiB ${row.file?.durationS ?? '—'} s ${row.file?.video?.frames ?? '—'} kare, yöntem ${row.method?.method ?? '—'}, yol ${row.measured?.route ?? '—'} | ` +
    `bellek taban ${row.memory?.baselineMib ?? '—'} tepe ${row.memory?.peakTotalMib ?? '—'} MiB ` +
    `(renderer-max ${row.memory?.peakByType?.['renderer-max'] ?? '—'}, gpu ${row.memory?.peakByType?.['gpu-process'] ?? '—'}), sonra ${row.memory?.afterMib ?? '—'} | ` +
    `disk profil tepe ${row.disk?.peakProfileMib ?? '—'} MiB, sonra ${row.disk?.after?.profileMib ?? '—'}, kapanınca ${row.disk?.profileAfterCloseMib ?? '—'} | ` +
    `kare ${row.frameIdentity ? `${row.frameIdentity.filter((c) => c.ok).length}/${row.frameIdentity.length}` : '—'}, ses ${Array.isArray(row.audioSync) ? row.audioSync.map((w) => `${w.medianOffsetMs ?? '?'} ms`).join('/') : '—'} | ` +
    `watchdog takılma ${row.stallWatchdog ?? '—'}, sayfa ${row.pageWatchdog ?? '—'}` +
    (row.message ? ` | ${row.message}` : '') +
    (row.failure ? ` | HATA ${row.failure.text} ${row.failure.detail ?? ''}` : ''),
);
console.log(`  aşamalar: ${stages}`);
console.log(`  yazıldı: ${reportPath}`);
