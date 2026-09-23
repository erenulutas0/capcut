/**
 * The 120-minute input limit (ADR-021), measured end to end in a real
 * browser with a persistent profile (OPFS on disk, like a real user):
 *
 *   1. open a 2-hour file: time to a playable preview, memory after open;
 *   2. seek the result preview to ~1:59:00 and play: time to the first frame,
 *      and which source frame is on screen (read from the burned barcode);
 *   3. silence suggestions over the whole 2-hour audio: time, peak memory;
 *   4. "Videoyu indir" while the result is 2 hours: refused before encoding,
 *      no temporary file;
 *   5. split and delete down to 60 minutes (keep 0:20:00–0:50:00 and
 *      1:10:00–1:40:00, i.e. one cut inside the result), export 1080p on
 *      the disk route: time, memory per tenth of the run, ffprobe duration
 *      and frame count, frame-accurate spot checks at the start, on both
 *      sides of the cut and at the end (barcode);
 *   6. reload → restore from the browser → relink the same file; and a
 *      backup file → import in an empty profile → relink: times.
 *
 * Memory: private bytes of the whole browser process tree, sampled by the
 * operating system every ~400 ms (`scripts/lib/process-memory.ps1`, ADR-013).
 * Windows only. Needs a running server (`SHOT_URL`, default :3111) and a
 * source from `scripts/generate-long-media.mjs`.
 *
 *   node scripts/measure-long-source.mjs --fixture=tests/media/long/long-120min-1080p.mp4 --browser=chrome
 *   options: --browser=chrome|msedge (default: Playwright's Chromium)
 *            --quality=1080|720  --skip=silence,export,relink  --keep-output
 *            --source-width=1920 (barcode scale; 1280 for the 720p file)
 *            --keep='[[1200,3000],[4200,6000]]' (seconds kept; the rest is deleted)
 *            --music=path        a music file added on top after opening (it is
 *                                mixed into the export and relinked with the video;
 *                                doc 15 counts it toward the total byte limit)
 *            --music-over=path   a music file tried first that must be refused
 *                                because video + music exceed the total (ADR-025)
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

import { readFrameNumber } from './lib/frame-barcode.mjs';
import { ffprobeJson } from './lib/media-measure.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, 'matrix-results');
const sampler = join(root, 'scripts', 'lib', 'process-memory.ps1');
const baseURL = process.env.SHOT_URL ?? 'http://127.0.0.1:3111';

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const found = args.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};
const fixtureArg = argValue('fixture', 'tests/media/long/long-120min-1080p.mp4');
const fixture = isAbsolute(fixtureArg) ? fixtureArg : join(root, fixtureArg);
const channel = argValue('browser', '');
const quality = argValue('quality', '1080');
const skip = new Set(argValue('skip', '').split(',').filter(Boolean));
const sourceWidth = Number(argValue('source-width', '1920'));
const label = argValue('label', `${channel || 'chromium'}-${basename(fixture, '.mp4')}`);
/**
 * `--pieces=N`: a result of N equal pieces spread over a 2-hour source (60
 * minutes in total), built by importing a backup file instead of N×2 splits;
 * for the memory cost of many cuts in one export.
 */
const piecesArg = Number(argValue('pieces', '0'));
/** Ranges to keep, in seconds: [[1200, 3000], [4200, 6000]] by default. */
const keep =
  piecesArg > 0
    ? Array.from({ length: piecesArg }, (_, i) => [(i * 7200) / piecesArg, (i * 7200) / piecesArg + 3600 / piecesArg])
    : JSON.parse(argValue('keep', '[[1200,3000],[4200,6000]]'));
const exportTimeoutMs = Number(argValue('timeout-min', '40')) * 60_000;
const absolute = (path) => (path ? (isAbsolute(path) ? path : join(root, path)) : '');
const music = absolute(argValue('music', ''));
const musicOver = absolute(argValue('music-over', ''));

const MIB = 1048576;
const FPS = 30;

if (process.platform !== 'win32') {
  console.error('Windows only (process sampler).');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

// ------------------------------------------------------------ memory sampler

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

const mib = (bytes) => Number((bytes / MIB).toFixed(0));

function memoryBetween(samples, from, to) {
  const slice = samples.filter((s) => s.at >= from && s.at <= to);
  if (slice.length === 0) return { samples: 0 };
  const peak = slice.reduce((m, s) => Math.max(m, s.total), 0);
  const last = slice[slice.length - 1].total;
  return { samples: slice.length, peakMib: mib(peak), endMib: mib(last), startMib: mib(slice[0].total) };
}

function tenthsOf(samples, from, to) {
  const span = Math.max(1, to - from);
  const out = [];
  for (let i = 0; i < 10; i += 1) {
    const a = from + (span * i) / 10;
    const b = from + (span * (i + 1)) / 10;
    const slice = samples.filter((s) => s.at >= a && s.at < b);
    out.push(slice.length ? mib(slice.reduce((m, s) => Math.max(m, s.total), 0)) : null);
  }
  return out;
}

// ------------------------------------------------------------- page helpers

const clearStorage = (page) =>
  page.evaluate(async () => {
    const opfs = await navigator.storage.getDirectory();
    for await (const name of opfs.keys()) {
      if (name.startsWith('clip-export-')) await opfs.removeEntry(name).catch(() => undefined);
    }
    await new Promise((resolve) => {
      const request = indexedDB.deleteDatabase('clip-editor');
      request.onsuccess = request.onerror = request.onblocked = () => resolve(undefined);
    });
  });

const exportFiles = (page) =>
  page.evaluate(async () => {
    const opfs = await navigator.storage.getDirectory();
    let count = 0;
    for await (const name of opfs.keys()) if (name.startsWith('clip-export-')) count += 1;
    return count;
  });

/** The source frame the preview shows, read from the barcode in the page. */
const previewFrame = (page) =>
  page.evaluate(() => {
    const video = document.querySelector('[data-testid="preview-video"]');
    if (!(video instanceof HTMLVideoElement) || video.videoWidth === 0) return null;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = 48;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, video.videoWidth, 48, 0, 0, video.videoWidth, 48);
    const data = ctx.getImageData(0, 0, canvas.width, 48).data;
    let value = 0;
    for (let bit = 0; bit < 20; bit += 1) {
      let sum = 0;
      let n = 0;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -4; dx <= 4; dx += 1) {
          const i = ((24 + dy) * canvas.width + bit * 64 + 32 + dx) * 4;
          sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          n += 1;
        }
      }
      if (sum / n > 128) value += 2 ** bit;
    }
    return { frame: value, currentTime: video.currentTime };
  });

/**
 * Resolves when the preview has presented a frame after the next seek or
 * play: `requestVideoFrameCallback` fires on presentation, not on decode.
 */
const armFirstFrame = (page, afterMediaTime) =>
  page.evaluate((after) => {
    const video = document.querySelector('[data-testid="preview-video"]');
    window.__clipFirstFrame = new Promise((resolve) => {
      const started = performance.now();
      const wait = () =>
        video.requestVideoFrameCallback((_now, meta) => {
          if (after !== null && meta.mediaTime <= after) return wait();
          resolve({ ms: performance.now() - started, mediaTime: meta.mediaTime });
        });
      wait();
    });
  }, afterMediaTime);

async function pressMany(page, key, count) {
  for (let i = 0; i < count; i += 1) await page.keyboard.press(key);
}

async function playheadTo(page, seconds, fromSeconds) {
  const playhead = page.getByTestId('timeline-playhead');
  await playhead.focus();
  if (fromSeconds === 0) await page.keyboard.press('Home');
  await pressMany(page, 'Shift+ArrowRight', seconds - fromSeconds);
}

// -------------------------------------------------------------------- run

const report = {
  browser: channel || 'chromium',
  fixture: basename(fixture),
  fixtureBytes: statSync(fixture).size,
  musicBytes: music ? statSync(music).size : null,
  quality,
  ranAt: new Date().toISOString(),
  profile: 'persistent',
  method:
    'Private bytes of the whole browser process tree (main + renderer + GPU + utility), sampled by the OS every ~400 ms.',
  phases: {},
};

const profileDir = join(outDir, 'profiles', `${label}-${Date.now()}`);
mkdirSync(profileDir, { recursive: true });
const context = await chromium.launchPersistentContext(profileDir, {
  ...(channel ? { channel } : {}),
  viewport: { width: 1440, height: 900 },
  acceptDownloads: true,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
report.browserVersion = context.browser()?.version() ?? null;
const browserPid = findBrowserPid(profileDir);
if (!browserPid) {
  console.error('browser process of the persistent profile not found');
  process.exit(2);
}
const sampling = startSampler(browserPid);
const page = context.pages()[0] ?? (await context.newPage());
report.browserVersion ??= await page.evaluate(() => navigator.userAgent);
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));

const log = (line) => console.log(`[${label}] ${line}`);

try {
  await page.goto(`${baseURL}/editor`);
  await clearStorage(page);
  await page.reload();
  await page.getByTestId('open-export').waitFor();
  // Let PowerShell start sampling and the page settle.
  const waitUntil = Date.now() + 20_000;
  while (sampling.samples.length < 5 && Date.now() < waitUntil) await page.waitForTimeout(250);
  const idle = Date.now();
  await page.waitForTimeout(2000);
  report.phases.idle = memoryBetween(sampling.samples, idle, Date.now());

  // 1. Open --------------------------------------------------------------
  {
    const t0 = Date.now();
    await page.getByTestId('video-input').setInputFiles(fixture);
    await page.getByTestId('strip-clip').first().waitFor({ timeout: 120_000 });
    const tStrip = Date.now();
    await page.waitForFunction(
      () => {
        const video = document.querySelector('[data-testid="preview-video"]');
        return video instanceof HTMLVideoElement && video.readyState >= 2;
      },
      null,
      { timeout: 120_000 },
    );
    const tReady = Date.now();
    await page.waitForTimeout(3000);
    report.phases.open = {
      msToTimeline: tStrip - t0,
      msToFirstPreviewFrame: tReady - t0,
      summary: (await page.getByTestId('output-summary').textContent())?.trim(),
      overLimit: (await page.getByTestId('timeline-over-limit').textContent().catch(() => null))?.trim() ?? null,
      memory: memoryBetween(sampling.samples, t0, Date.now()),
      memoryAfterOpenMib: mib(sampling.samples[sampling.samples.length - 1]?.total ?? 0),
      thumbnailsOrWaveform: 'none: the editor draws no filmstrip, thumbnails or waveform',
    };
    log(`open: ${JSON.stringify(report.phases.open)}`);
  }

  // 1b. Music on top: first one that must not fit with the video, then one
  // that does. Both counted together against the total (doc 15).
  if (musicOver) {
    const t0 = Date.now();
    await page.getByTestId('audio-input').setInputFiles(musicOver);
    await page.getByTestId('media-error').waitFor({ timeout: 60_000 });
    const overBytes = statSync(musicOver).size;
    report.phases.musicOver = {
      ms: Date.now() - t0,
      musicBytes: overBytes,
      totalBytes: report.fixtureBytes + overBytes,
      text: (await page.getByTestId('media-error').textContent())?.trim(),
      videoStillOpen: (await page.getByTestId('strip-clip').count()) === 1,
    };
    await page.getByTestId('media-error-dismiss').click();
    log(`music-over: ${JSON.stringify(report.phases.musicOver)}`);
  }
  if (music) {
    const t0 = Date.now();
    await page.locator('#inspector-tab-audio').click();
    await page.getByTestId('audio-input').setInputFiles(music);
    const outcome = await Promise.race([
      page.getByTestId('music-file-name').waitFor({ timeout: 60_000 }).then(() => 'added'),
      page.getByTestId('media-error').waitFor({ timeout: 60_000 }).then(() => 'refused'),
    ]);
    report.phases.music = {
      outcome,
      ms: Date.now() - t0,
      totalBytes: report.fixtureBytes + report.musicBytes,
      text:
        outcome === 'added'
          ? (await page.getByTestId('music-file-name').textContent())?.trim()
          : (await page.getByTestId('media-error').textContent())?.trim(),
    };
    log(`music: ${JSON.stringify(report.phases.music)}`);
    if (outcome !== 'added') throw new Error('the music file was refused');
  }

  /** After a restore: the music asks for its file too; the same file is given. */
  const relinkMusic = async () => {
    if (!music) return null;
    const t0 = Date.now();
    await page.locator('#inspector-tab-audio').click();
    await page.getByTestId('relink-audio-input').setInputFiles(music);
    await page.getByTestId('music-file-name').waitFor({ timeout: 60_000 });
    return Date.now() - t0;
  };

  // 4 (gate). "Videoyu indir" while the result is over the limit -----------
  if (report.phases.open.overLimit) {
    const t0 = Date.now();
    await page.getByTestId('open-export').click();
    await page.getByTestId('export-over-limit').waitFor({ timeout: 30_000 });
    report.phases.gate = {
      msToMessage: Date.now() - t0,
      text: (await page.getByTestId('export-over-limit-text').textContent())?.trim(),
      createDisabled: await page.getByTestId('export-create').isDisabled(),
      encodingShown: (await page.getByTestId('export-running').count()) > 0,
      exportFilesInOpfs: await exportFiles(page),
    };
    await page.keyboard.press('Escape');
    log(`gate: ${JSON.stringify(report.phases.gate)}`);
  }

  // 2. Seek to ~1:59:00 and play ------------------------------------------
  {
    const playhead = page.getByTestId('timeline-playhead');
    await playhead.focus();
    await page.keyboard.press('End');
    await pressMany(page, 'Shift+ArrowLeft', 59);
    await page.waitForTimeout(1500);
    const t0 = Date.now();
    await armFirstFrame(page, null);
    await page.keyboard.press('Shift+ArrowLeft'); // lands on 1:58:59.999999
    const first = await page.evaluate(() => window.__clipFirstFrame);
    const seekWallMs = Date.now() - t0;
    await page.waitForTimeout(300);
    const shown = await previewFrame(page);
    const totalUs = Number(await page.getByTestId('output-duration-us').textContent());
    const expectedFrame = Math.floor((totalUs - 1 - 60 * 1_000_000) / (1_000_000 / FPS));
    // Play from there.
    await armFirstFrame(page, shown?.currentTime ?? null);
    const tPlay = Date.now();
    await page.keyboard.press('Space');
    const playing = await page.evaluate(() => window.__clipFirstFrame);
    const playWallMs = Date.now() - tPlay;
    await page.waitForTimeout(3000);
    const after = await previewFrame(page);
    await page.keyboard.press('Space');
    report.phases.seek = {
      target: 'End, then 60 × 1 s back (1:58:59.999999 on a 2-hour file)',
      firstFrameMs: Number(first.ms.toFixed(0)),
      seekWallMs,
      frameOnScreen: shown,
      expectedFrame,
      playFirstFrameMs: Number(playing.ms.toFixed(0)),
      playWallMs,
      afterThreeSeconds: after,
      advancedSeconds: after && shown ? Number((after.currentTime - shown.currentTime).toFixed(2)) : null,
      memory: memoryBetween(sampling.samples, t0, Date.now()),
    };
    log(`seek: ${JSON.stringify(report.phases.seek)}`);
  }

  // 3. Silence suggestions over the whole 2-hour audio --------------------
  if (!skip.has('silence')) {
    const t0 = Date.now();
    await page.getByTestId('open-silence').click();
    await page.getByTestId('silence-running').waitFor({ timeout: 30_000 }).catch(() => undefined);
    await page.getByTestId('silence-running').waitFor({ state: 'detached', timeout: 30 * 60_000 });
    const tDone = Date.now();
    // The list is rendered after the run; give React a moment.
    await page.waitForTimeout(500);
    const tRendered = Date.now();
    report.phases.silence = {
      ms: tDone - t0,
      suggestions: await page.getByTestId('silence-suggestion').count(),
      problem: await page.getByTestId('silence-problem').getAttribute('data-reason').catch(() => null),
      leftOut: (await page.getByTestId('silence-left-out').textContent().catch(() => null))?.trim() ?? null,
      memory: memoryBetween(sampling.samples, t0, tRendered),
      tenths: tenthsOf(sampling.samples, t0, tDone),
    };
    await page.keyboard.press('Escape');
    await page.waitForTimeout(2000);
    report.phases.silence.memoryAfterCloseMib = mib(sampling.samples[sampling.samples.length - 1]?.total ?? 0);
    log(`silence: ${JSON.stringify(report.phases.silence)}`);
  }

  // 5. Split and delete down to 60 minutes --------------------------------
  const sourceSeconds = Number(await page.getByTestId('output-duration-us').textContent()) / 1_000_000;
  const cuts = keep.flat().filter((s) => s > 0 && s < sourceSeconds);
  const keptSeconds = keep.reduce((sum, [from, to]) => sum + (to - from), 0);
  if (piecesArg > 0) {
    // The recipe as a backup file: N pieces, each with the automatic piece's
    // settings. Imported like a user's backup, then the same file relinked.
    const t0 = Date.now();
    let record = null;
    while (!record && Date.now() - t0 < 30_000) {
      record = await page.evaluate(
        () =>
          new Promise((resolve) => {
            const open = indexedDB.open('clip-editor');
            open.onerror = () => resolve(null);
            open.onsuccess = () => {
              if (!open.result.objectStoreNames.contains('projects')) return resolve(null);
              const all = open.result.transaction('projects', 'readonly').objectStore('projects').getAll();
              all.onsuccess = () => resolve(all.result.find((r) => r.edl.clips.length === 1) ?? null);
              all.onerror = () => resolve(null);
            };
          }),
      );
      if (!record) await page.waitForTimeout(500);
    }
    if (!record) throw new Error('no saved record to build the backup from');
    const template = record.edl.clips[0];
    record.edl.clips = keep.map(([from, to], i) => ({
      ...template,
      view: { ...template.view },
      clipId: `c_${String(i + 1).padStart(3, '0')}`,
      sourceInUs: Math.round(from * 1_000_000),
      sourceOutUs: Math.round(to * 1_000_000),
    }));
    record.edl.revision += 1000;
    const backupPath = join(outDir, `long-${label}-pieces.clip.json`);
    writeFileSync(backupPath, JSON.stringify(record));
    await page.getByTestId('backup-input').setInputFiles(backupPath);
    // The open file may still match the backup's binding (then the editor
    // keeps it); otherwise it asks for the file, and the same file is given.
    const importDeadline = Date.now() + 60_000;
    let relinked = false;
    while (Date.now() < importDeadline) {
      if ((await page.getByTestId('relink-video').count()) > 0) {
        await page.getByTestId('relink-video-input').setInputFiles(fixture);
        relinked = true;
        break;
      }
      if ((await page.getByTestId('strip-clip').count()) === piecesArg) break;
      await page.waitForTimeout(250);
    }
    await page.getByTestId('preview-video').waitFor({ timeout: 120_000 });
    rmSync(backupPath, { force: true });
    report.phases.edit = {
      how: `backup import of ${piecesArg} pieces${relinked ? ', then relink' : ''}`,
      ms: Date.now() - t0,
      pieces: await page.getByTestId('strip-clip').count(),
      outputUs: Number(await page.getByTestId('output-duration-us').textContent()),
    };
    log(`edit: ${JSON.stringify(report.phases.edit)}`);
  } else {
    const t0 = Date.now();
    let at = 0;
    for (const cut of cuts) {
      await playheadTo(page, cut, at);
      at = cut;
      await page.getByTestId('split-selected').click();
    }
    // Pieces now alternate drop / keep, starting with a drop before 0:20:00.
    const pieces = await page.getByTestId('strip-clip').count();
    for (let index = pieces - 1; index >= 0; index -= 2) {
      await page.getByTestId('strip-clip').nth(index).locator('.strip-clip-select').click();
      await page.getByTestId('delete-selected').click();
    }
    report.phases.edit = {
      ms: Date.now() - t0,
      ranges: await page.getByTestId('moment-card').locator('.moment-range').allTextContents(),
      outputUs: Number(await page.getByTestId('output-duration-us').textContent()),
      overLimitShown: (await page.getByTestId('timeline-over-limit').count()) > 0,
    };
    log(`edit: ${JSON.stringify(report.phases.edit)}`);
  }

  // 5b. Export the 60-minute result --------------------------------------
  if (!skip.has('export')) {
    await page.getByTestId('open-export').click();
    await page.getByTestId('export-quality').selectOption(quality);
    await page.getByTestId('export-ready').waitFor({ timeout: 120_000 });
    const storage = await page.evaluate(async () => {
      const estimate = await navigator.storage.estimate();
      return { quotaGiB: Number(((estimate.quota ?? 0) / 2 ** 30).toFixed(1)), usageMiB: Number(((estimate.usage ?? 0) / 2 ** 20).toFixed(1)) };
    });
    await page.waitForTimeout(2000);
    const base = memoryBetween(sampling.samples, Date.now() - 2000, Date.now());
    const t0 = Date.now();
    await page.getByTestId('export-create').click();
    let finished = false;
    while (Date.now() - t0 < exportTimeoutMs) {
      if ((await page.getByTestId('export-succeeded').count()) > 0) {
        finished = true;
        break;
      }
      if ((await page.getByTestId('export-failed').count()) > 0) break;
      await page.waitForTimeout(500);
    }
    const tEnd = Date.now();
    await page.waitForTimeout(1500);
    const row = {
      finished,
      ms: tEnd - t0,
      outputSeconds: keptSeconds,
      realTimeFactor: Number((keptSeconds / ((tEnd - t0) / 1000)).toFixed(2)),
      baselinePeakMib: base.peakMib,
      memory: memoryBetween(sampling.samples, t0, Date.now()),
      tenths: tenthsOf(sampling.samples, t0, tEnd),
      storage,
    };
    if (finished) {
      row.route = (await page.getByTestId('measured-route').textContent())?.trim();
      row.measuredDuration = (await page.getByTestId('measured-duration').textContent())?.trim();
      row.framesMissing = (await page.getByTestId('measured-frames-missing').textContent().catch(() => null)) ?? '0';
      row.exportFilesWhileOffered = await exportFiles(page);
      row.saveNote = (await page.getByTestId('export-save-space').textContent().catch(() => null))?.trim() ?? null;
      const artefact = join(outDir, `long-${label}-${quality}.mp4`);
      const download = page.waitForEvent('download', { timeout: 20 * 60_000 });
      await page.getByTestId('export-download').click();
      await (await download).saveAs(artefact);
      const probe = ffprobeJson(artefact);
      const video = probe?.streams.find((s) => s.codec_type === 'video');
      const audio = probe?.streams.find((s) => s.codec_type === 'audio');
      row.outputMib = Number((statSync(artefact).size / MIB).toFixed(1));
      row.ffprobe = {
        formatSeconds: probe ? Number(probe.format.duration) : null,
        videoSeconds: video ? Number(video.duration) : null,
        audioSeconds: audio ? Number(audio.duration) : null,
        frames: video ? Number(video.nb_frames) : null,
        width: video?.width,
        height: video?.height,
        videoMbps: video?.bit_rate ? Number((Number(video.bit_rate) / 1e6).toFixed(2)) : null,
      };
      // Frame accuracy: output frame -> expected source frame, from the plan.
      const segments = [];
      let outFrame = 0;
      for (const [from, to] of keep) {
        segments.push({ outFrom: outFrame, srcFrom: from * FPS, frames: (to - from) * FPS });
        outFrame += (to - from) * FPS;
      }
      const checks = [];
      for (const segment of segments) {
        for (const offset of [0, 1, Math.floor(segment.frames / 2), segment.frames - 2, segment.frames - 1]) {
          checks.push({ output: segment.outFrom + offset, expected: segment.srcFrom + offset });
        }
      }
      const outputWidth = video?.width ?? 1920;
      row.spotChecks = checks.map(({ output, expected }) => {
        const read = readFrameNumber(artefact, output, { fps: FPS, sourceWidth, outputWidth });
        return { output, expected, read: read.frame, ok: read.frame === expected, confidence: read.confidence };
      });
      row.spotChecksPassed = row.spotChecks.every((check) => check.ok);
      if (!args.includes('--keep-output')) rmSync(artefact, { force: true });
    } else {
      row.failure = ((await page.getByTestId('export-failed').textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim() || 'timeout';
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);
    row.leftoverExportFiles = await exportFiles(page);
    report.phases.export = row;
    log(`export: ${JSON.stringify(row)}`);
  }

  // 6. Restore + relink, and backup file + relink -------------------------
  if (!skip.has('relink')) {
    await page.waitForTimeout(3000); // autosave
    const record = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const open = indexedDB.open('clip-editor');
          open.onerror = () => resolve(null);
          open.onsuccess = () => {
            const all = open.result.transaction('projects', 'readonly').objectStore('projects').getAll();
            all.onsuccess = () => resolve(all.result[0] ?? null);
            all.onerror = () => resolve(null);
          };
        }),
    );
    const t0 = Date.now();
    await page.reload();
    await page.getByTestId('relink-video').waitFor({ timeout: 60_000 });
    const tRestored = Date.now();
    const t1 = Date.now();
    await page.getByTestId('relink-video-input').setInputFiles(fixture);
    await page.getByTestId('preview-video').waitFor({ timeout: 120_000 });
    const tRelinked = Date.now();
    const msMusicRelink = await relinkMusic();
    await page.waitForTimeout(2500);
    const restore = {
      msReloadToRelinkPrompt: tRestored - t0,
      msRelink: tRelinked - t1,
      msMusicRelink,
      summary: (await page.getByTestId('output-summary').textContent())?.trim(),
      memory: memoryBetween(sampling.samples, t0, Date.now()),
    };

    // The same recipe as a backup file in an empty profile.
    const backupPath = join(outDir, `long-${label}.clip.json`);
    writeFileSync(backupPath, JSON.stringify(record));
    await clearStorage(page);
    await page.reload();
    await page.getByTestId('open-export').waitFor();
    const t2 = Date.now();
    await page.getByTestId('backup-input').setInputFiles(backupPath);
    await page.getByTestId('relink-video').waitFor({ timeout: 60_000 });
    const tImported = Date.now();
    await page.getByTestId('relink-video-input').setInputFiles(fixture);
    await page.getByTestId('preview-video').waitFor({ timeout: 120_000 });
    const tBackupRelinked = Date.now();
    const msBackupMusicRelink = await relinkMusic();
    rmSync(backupPath, { force: true });
    report.phases.relink = {
      ...restore,
      backupBytes: JSON.stringify(record).length,
      msBackupImport: tImported - t2,
      msBackupRelink: tBackupRelinked - tImported,
      msBackupMusicRelink,
      clipsAfterBackup: await page.getByTestId('strip-clip').count(),
      summaryAfterBackup: (await page.getByTestId('output-summary').textContent())?.trim(),
      fingerprint: 'size + lastModified + duration only (projectRecord.computeFingerprint); no byte of the file is hashed',
    };
    log(`relink: ${JSON.stringify(report.phases.relink)}`);
  }
} catch (error) {
  report.error = String(error?.stack ?? error);
  console.error(error);
} finally {
  report.pageErrors = pageErrors;
  report.peakMibWholeRun = mib(sampling.samples.reduce((m, s) => Math.max(m, s.total), 0));
  sampling.stop();
  await context.close().catch(() => undefined);
  rmSync(profileDir, { recursive: true, force: true });
  const path = join(outDir, `long-source-${label}.json`);
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nwritten: ${path}`);
}
