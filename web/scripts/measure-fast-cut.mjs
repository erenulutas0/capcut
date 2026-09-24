/**
 * Fast cut vs full encode (ADR-027), measured end to end in a real browser
 * with a persistent profile (OPFS on disk, like a real user):
 *
 *   1. open a long barcoded 1080p source (`scripts/generate-long-media.mjs`);
 *   2. build a recipe of the given ranges (the range flow);
 *   3. "Videoyu indir" at 1080p: wall time from the click to the verified
 *      result, private bytes of the browser process tree (OS sampler,
 *      ~400 ms), the method the app reports (copy/smart/encode);
 *   4. check the saved file with ffmpeg: exact frame count and duration,
 *      barcodes of the first 90 and last 30 frames of every moment (the
 *      marked frames, seams included), framemd5 of the same frames against
 *      the source (copied = bit-exact; re-encoded = SSIM), and audio sync
 *      (onsets of the source's speech-like bursts against the video frames).
 *
 * The profile and downloads live under the gitignored
 * `fastcut-spike-results/` on this drive (a 60-minute file is gigabytes).
 * Needs a running server (`SHOT_URL`, default :3100). Windows only (sampler).
 *
 *   node scripts/measure-fast-cut.mjs --fixture=tests/media/long/long-120min-1080p-4500s.mp4 \
 *        --browser=chrome --keep='[[601.4,661.4]]' --mode=auto --label=chrome-1min-fast
 *   options: --browser=chromium|chrome|msedge  --mode=auto|encode  --quality=1080
 *            --keep-output  --timeout-min=60
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

import { emptyTimeline } from './lib/range-flow.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const resultsDir = join(root, 'fastcut-spike-results');
const sampler = join(root, 'scripts', 'lib', 'process-memory.ps1');
const baseURL = process.env.SHOT_URL ?? 'http://127.0.0.1:3100';

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const found = args.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};
const fixtureArg = argValue('fixture', 'tests/media/long/long-120min-1080p-4500s.mp4');
const fixture = isAbsolute(fixtureArg) ? fixtureArg : join(root, fixtureArg);
const channel = argValue('browser', '');
const mode = argValue('mode', 'auto');
const quality = argValue('quality', '1080');
const keep = JSON.parse(argValue('keep', '[[601.4,661.4]]'));
const label = argValue('label', `${channel || 'chromium'}-${mode}`);
const timeoutMs = Number(argValue('timeout-min', '60')) * 60_000;
const FPS = 30;
const MIB = 1048576;

if (process.platform !== 'win32') {
  console.error('Windows only (process sampler).');
  process.exit(2);
}
mkdirSync(resultsDir, { recursive: true });

/* ----------------------------------------------------------- memory sampler */

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

/* ------------------------------------------------------------- ffmpeg checks */

function ff(argsList, { binary = false } = {}) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...argsList], {
    encoding: binary ? 'buffer' : 'utf8',
    maxBuffer: 2 * 1024 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`ffmpeg: ${String(result.stderr).slice(-400)}`);
  return result.stdout;
}

/** Frame count (packets) and container duration. */
function probe(file) {
  const out = spawnSync(
    'ffprobe',
    ['-v', 'error', '-select_streams', 'v:0', '-count_packets', '-show_entries', 'stream=nb_read_packets:format=duration', '-of', 'json', file],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  ).stdout;
  const json = JSON.parse(out);
  return { frames: Number(json.streams[0].nb_read_packets), durationS: Number(json.format.duration) };
}

/** Barcodes of `count` frames starting at the frame shown at time `atS` (1920-wide source). */
function barcodesAt(file, atS, count) {
  const raw = ff(
    ['-ss', Math.max(0, atS).toFixed(6), '-i', file, '-frames:v', String(count), '-map', '0:v:0', '-vf', 'crop=1280:48:0:0,format=gray', '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'],
    { binary: true },
  );
  const size = 1280 * 48;
  const frames = [];
  for (let offset = 0; offset + size <= raw.length; offset += size) {
    let value = 0;
    for (let bit = 0; bit < 20; bit += 1) {
      let sum = 0;
      for (let dx = -4; dx <= 4; dx += 1) sum += raw[offset + 24 * 1280 + bit * 64 + 32 + dx];
      if (sum / 9 > 128) value += 2 ** bit;
    }
    frames.push(value);
  }
  return frames;
}

function md5sAt(file, atS, count) {
  return ff(['-ss', Math.max(0, atS).toFixed(6), '-i', file, '-frames:v', String(count), '-map', '0:v:0', '-fps_mode', 'passthrough', '-f', 'framemd5', '-'])
    .split('\n')
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split(',').pop().trim());
}

/** Per-frame SSIM of `count` output frames from `outS` against source frames from `srcS`. */
function ssimAt(output, outS, source, srcS, count) {
  const dir = mkdtempSync(join(tmpdir(), 'fc-ssim-'));
  const stats = join(dir, 's.txt').replace(/\\/g, '/').replace(':', '\\:');
  try {
    ff([
      '-ss', outS.toFixed(6), '-i', output, '-ss', srcS.toFixed(6), '-i', source,
      '-filter_complex', `[0:v]trim=end_frame=${count},setpts=N[a];[1:v]trim=end_frame=${count},setpts=N[b];[a][b]ssim=stats_file='${stats}'`,
      '-fps_mode', 'passthrough', '-f', 'null', '-',
    ]);
    return readFileSync(join(dir, 's.txt'), 'utf8')
      .split('\n')
      .map((line) => /All:([0-9.]+)/.exec(line)?.[1])
      .filter(Boolean)
      .map(Number);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Burst onsets (s, relative to `fromS`) in a window of the audio: the source
 * is silent (noise floor 0.002) in its pauses, so the first millisecond whose
 * RMS jumps above 0.02 after at least 250 ms below it is an onset.
 */
function onsetsIn(file, fromS, seconds) {
  const pcm = ff(['-ss', fromS.toFixed(6), '-t', String(seconds), '-i', file, '-map', '0:a:0', '-ac', '1', '-ar', '48000', '-f', 'f32le', 'pipe:1'], { binary: true });
  const samples = new Float32Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 4));
  const onsets = [];
  let quietMs = 0;
  for (let ms = 0; ms * 48 + 48 <= samples.length; ms += 1) {
    let sum = 0;
    for (let i = ms * 48; i < ms * 48 + 48; i += 1) sum += samples[i] * samples[i];
    const rms = Math.sqrt(sum / 48);
    if (rms > 0.02) {
      if (quietMs >= 250) {
        // Refine to the first sample above the threshold inside this millisecond.
        let first = ms * 48;
        while (first < ms * 48 + 48 && Math.abs(samples[first]) < 0.02) first += 1;
        onsets.push(first / 48000);
      }
      quietMs = 0;
    } else {
      quietMs += 1;
    }
  }
  return onsets;
}

/** Source burst onsets (generate-long-media.mjs): t ≡ 0, 5.5, 9.3 (mod 13). */
function sourceOnsets(fromS, toS) {
  const out = [];
  for (let k = Math.floor(fromS / 13) - 1; k * 13 < toS + 13; k += 1) {
    for (const offset of [0, 5.5, 9.3]) {
      const t = k * 13 + offset;
      if (t > fromS + 0.3 && t < toS - 0.3) out.push(t);
    }
  }
  return out;
}

/* -------------------------------------------------------------------- run */

const profileDir = join(resultsDir, `profile-${label}`);
const downloadsDir = join(resultsDir, `downloads-${label}`);
rmSync(profileDir, { recursive: true, force: true });
mkdirSync(downloadsDir, { recursive: true });
const context = await chromium.launchPersistentContext(profileDir, {
  ...(channel ? { channel } : {}),
  viewport: { width: 1440, height: 900 },
  acceptDownloads: true,
  downloadsPath: downloadsDir,
});
const browserPid = findBrowserPid(profileDir);
if (!browserPid) {
  console.error('kalıcı profilin tarayıcı süreci bulunamadı');
  process.exit(2);
}
if (mode === 'encode') {
  await context.addInitScript(() => {
    window.__clipExportMode = 'encode';
  });
}

const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
await page.goto(`${baseURL}/editor`);
await page.getByTestId('video-input').setInputFiles(fixture);
await page.getByTestId('preview-video').waitFor({ timeout: 120_000 });
await page.getByTestId('strip-clip').first().waitFor({ timeout: 120_000 });
await emptyTimeline(page);
for (const [a, b] of keep) {
  await page.getByTestId('range-start').fill(a.toFixed(3));
  await page.getByTestId('range-end').fill(b.toFixed(3));
  await page.getByTestId('add-moment').click();
}
await page.getByTestId('open-export').click();
await page.getByTestId('export-quality').selectOption(quality);
await page.getByTestId('export-ready').waitFor({ timeout: 120_000 });
await page.waitForTimeout(1500);

const sampling = startSampler(browserPid);
const until = Date.now() + 20_000;
while (sampling.samples.length < 3 && Date.now() < until) await page.waitForTimeout(200);
const baseline = sampling.samples.reduce((m, s) => Math.max(m, s.total), 0);

const startedAt = Date.now();
await page.getByTestId('export-create').click();
let finished = false;
while (Date.now() - startedAt < timeoutMs) {
  if ((await page.getByTestId('export-succeeded').count()) > 0) {
    finished = true;
    break;
  }
  if ((await page.getByTestId('export-failed').count()) > 0) break;
  await page.waitForTimeout(250);
}
const elapsedMs = Date.now() - startedAt;
await page.waitForTimeout(1500);
sampling.stop();
const during = sampling.samples.filter((s) => s.at >= startedAt);
const peak = during.reduce((m, s) => Math.max(m, s.total), 0);
const tenths = [];
for (let i = 0; i < 10; i += 1) {
  const a = startedAt + (elapsedMs * i) / 10;
  const b = startedAt + (elapsedMs * (i + 1)) / 10;
  const slice = during.filter((s) => s.at >= a && s.at < b);
  tenths.push(slice.length ? mib(slice.reduce((m, s) => Math.max(m, s.total), 0)) : null);
}

const requestedSeconds = keep.reduce((sum, [a, b]) => sum + (b - a), 0);
const row = {
  label,
  browser: channel || 'chromium',
  mode,
  quality,
  keep,
  requestedSeconds,
  finished,
  elapsedMs,
  realTimeFactor: Number((requestedSeconds / (elapsedMs / 1000)).toFixed(2)),
  memory: { baselineMib: mib(baseline), peakMib: mib(peak), growthMib: mib(peak - baseline), samples: during.length, tenths },
  pageErrors,
};

if (finished) {
  const method = page.getByTestId('measured-method');
  row.method = await method.getAttribute('data-method');
  row.fallbackReason = (await method.getAttribute('data-fallback')) || null;
  row.framesEncoded = Number(await method.getAttribute('data-frames-encoded'));
  row.methodText = (await method.textContent())?.trim();
  row.route = (await page.getByTestId('measured-route').textContent())?.trim();
  const download = page.waitForEvent('download', { timeout: 30 * 60_000 });
  await page.getByTestId('export-download').click();
  const artefact = join(downloadsDir, `${label}.mp4`);
  await (await download).saveAs(artefact);
  row.outputMib = Number((statSync(artefact).size / MIB).toFixed(1));

  // ------------------------------------------------------------ checks
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok, detail });
  const expectedFrames = keep.reduce((sum, [a, b]) => sum + Math.round((b - a) * FPS), 0);
  const p = probe(artefact);
  row.ffprobe = p;
  check('kare sayısı', p.frames === expectedFrames, `${p.frames} / ${expectedFrames}`);
  check('süre (±1 kare)', Math.abs(p.durationS - expectedFrames / FPS) <= 1 / FPS + 0.002, `${p.durationS.toFixed(3)} / ${(expectedFrames / FPS).toFixed(3)} s`);

  let outStartFrame = 0;
  const identity = { windows: 0, compared: 0, identical: 0, seamSsim: [] };
  const sync = [];
  for (const [a, b] of keep) {
    const frames = Math.round((b - a) * FPS);
    const firstSource = Math.round(a * FPS);
    const outS = outStartFrame / FPS;
    const windows = [
      [0, Math.min(90, frames)],
      [Math.max(0, frames - 30), frames],
    ];
    for (const [from, to] of windows) {
      const count = to - from;
      const codes = barcodesAt(artefact, outS + from / FPS - 0.25 / FPS, count);
      const expected = Array.from({ length: count }, (_, i) => firstSource + from + i);
      const wrong = codes.filter((c, i) => c !== expected[i]).length + Math.abs(codes.length - count);
      check(`barkod ${firstSource + from}–${firstSource + to - 1}`, wrong === 0, `${count - wrong}/${count} doğru`);
      const outMd5 = md5sAt(artefact, outS + from / FPS - 0.25 / FPS, count);
      const srcMd5 = md5sAt(fixture, (firstSource + from) / FPS - 0.25 / FPS, count);
      const same = outMd5.filter((m, i) => m === srcMd5[i]).length;
      identity.windows += 1;
      identity.compared += count;
      identity.identical += same;
      if (mode === 'auto' && same < count) {
        const ssim = ssimAt(artefact, outS + from / FPS - 0.25 / FPS, fixture, (firstSource + from) / FPS - 0.25 / FPS, count);
        ssim.forEach((v, i) => {
          if (outMd5[i] !== srcMd5[i]) identity.seamSsim.push(v);
        });
      }
    }
    // Audio: the first 40 s of the moment.
    const window = Math.min(40, b - a);
    const measured = onsetsIn(artefact, outS, window);
    for (const t of sourceOnsets(a, a + window)) {
      const expected = t - a;
      const nearest = measured.reduce((best, m) => (Math.abs(m - expected) < Math.abs(best - expected) ? m : best), Infinity);
      if (Number.isFinite(nearest) && Math.abs(nearest - expected) < 0.2) sync.push(nearest - expected);
    }
    outStartFrame += frames;
  }
  if (identity.seamSsim.length > 0) {
    identity.seamSsimMin = Number(Math.min(...identity.seamSsim).toFixed(4));
    identity.seamSsimMean = Number((identity.seamSsim.reduce((x, y) => x + y, 0) / identity.seamSsim.length).toFixed(4));
    identity.seamFrames = identity.seamSsim.length;
  }
  delete identity.seamSsim;
  row.identity = identity;
  const worstSync = sync.reduce((m, e) => Math.max(m, Math.abs(e)), 0);
  row.audioSync = { onsets: sync.length, worstMs: Number((worstSync * 1000).toFixed(2)), meanMs: sync.length ? Number(((sync.reduce((x, y) => x + y, 0) / sync.length) * 1000).toFixed(2)) : null };
  check('ses senkronu (≤ 1 AAC karesi)', sync.length > 0 && worstSync <= 1024 / 48000, `${sync.length} başlangıç, en kötü ${(worstSync * 1000).toFixed(2)} ms`);
  row.checks = checks;
  row.ok = checks.every((c) => c.ok);
  if (!args.includes('--keep-output')) rmSync(artefact, { force: true });
} else {
  row.failure = ((await page.getByTestId('export-failed').textContent().catch(() => null)) ?? 'zaman aşımı').replace(/\s+/g, ' ').trim();
}

await page.keyboard.press('Escape');
await page.waitForTimeout(500);
await context.close();
rmSync(profileDir, { recursive: true, force: true });
rmSync(downloadsDir, { recursive: true, force: true });

const reportPath = join(resultsDir, `measure-${label}.json`);
writeFileSync(reportPath, `${JSON.stringify(row, null, 2)}\n`);
console.log(
  `${label}: ${finished ? 'OK' : 'FAIL'} ${row.method ?? '—'}${row.fallbackReason ? ` (${row.fallbackReason})` : ''} ` +
    `${requestedSeconds.toFixed(1)} s → ${(elapsedMs / 1000).toFixed(1)} s (×${row.realTimeFactor}), ` +
    `bellek taban ${row.memory.baselineMib} tepe ${row.memory.peakMib} MiB, çıktı ${row.outputMib ?? '—'} MiB, ` +
    `kodlanan kare ${row.framesEncoded ?? '—'}`,
);
for (const c of row.checks ?? []) console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.name} — ${c.detail}`);
if (row.identity) console.log(`  kimlik: ${JSON.stringify(row.identity)}  ses: ${JSON.stringify(row.audioSync)}`);
if (row.failure) console.log(`  hata: ${row.failure}`);
console.log(`yazıldı: ${reportPath}`);
