/**
 * The ten task cards (ADR-034) on a REAL Android phone's Chrome over adb +
 * CDP, the way a newcomer walks them: the opening screen, the card (found by
 * its visible name), the video, the default choice, İndir. Every saved file
 * is copied back here and measured with ffprobe; the card's own promise is
 * checked (WhatsApp under 16 MB, 9:16 without enlarging, no audio track, an
 * M4A, ...). Time-to-result, page errors and console errors are recorded.
 *
 *   adb forward tcp:9222 localabstract:chrome_devtools_remote
 *   node scripts/android/phone-wizards.mjs [--url=https://erenulutas0.github.io/capcut/]
 *     [--only=kes,dikey-r11,...] [--label=<folder suffix>] [--media=<dir>] [--yazi-model=default|base]
 *   node scripts/android/phone-wizards.mjs --watchdog=20 [--url=...]
 *
 * `--watchdog=N` (ADR-044) instead loads the opening screen and two wizard
 * pages N times each, every load in a fresh tab of its own, and records the
 * time until the app said it is alive (`data-clip-alive`), whether the page
 * watchdog reloaded it (the `clip:page-recovery` sessionStorage flag, the
 * `[page-recovered]` console line, the navigation type) and whether a
 * service worker served it.
 *
 * Etiquette (the founder's own phone; same as phone-run.mjs): only tabs this
 * script opens, through the own-tabs proxy (cdp-own-tabs.mjs) — no other tab
 * is listed, read or closed; the browser is never closed, no setting is
 * changed, nothing is installed, no file of the phone is read. Videos are
 * sent into the page as bytes (the OS file picker behind "Videonu seç"
 * cannot be driven over CDP; the bytes go into the same file input it
 * fills). The OS save dialog is replaced by the stand-in of kesit-flow.mjs
 * (a file in the page's own storage, written through the same handle). After
 * every card the script deletes what it saved and the site's storage —
 * OPFS, IndexedDB, localStorage, the service worker and every cache, the
 * transcript models included — closes its tab, and at the end removes the
 * adb forward it set.
 *
 * Sources: generated or public test media only, except the cards that are
 * about real-world sizes (Kes, Dikey yap, Küçült, Her yerde açılsın), which
 * use R11 — a public-domain iPhone 12 Pro portrait recording (HEVC HLG,
 * 21.7 s, 33 MiB; tests/media/real/SOURCES-web.md). Rows name sources by
 * case id, never by file name.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

import { ownTabsEndpoint } from './cdp-own-tabs.mjs';
import { installSavePicker, lastPickedName, readPickedFile } from '../lib/kesit-flow.mjs';

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const site = arg('url', 'https://erenulutas0.github.io/capcut/').replace(/\/?$/, '/');
const only = arg('only', '').split(',').filter(Boolean);
const label = arg('label', '');
const yaziModel = arg('yazi-model', 'default');
const watchdogRounds = Number(arg('watchdog', '0'));
const web = resolve(import.meta.dirname, '..', '..');
const media = resolve(arg('media', join(web, 'tests', 'media')));
const outDir = join(web, 'matrix-results', `android-wizards${label ? `-${label}` : ''}`);
mkdirSync(outDir, { recursive: true });

/** Sources by case id. R11: public domain (SOURCES-web.md); the rest generated or public test clips. */
const SOURCES = {
  R11: { file: join(media, 'real', 'web-iphone12pro-hevc-hlg-dv-rot90.mov'), mime: 'video/quicktime', name: 'r11.mov' },
  sample: { file: join(media, 'sample-24s.mp4'), mime: 'video/mp4' }, // 1280×720 H.264 + AAC, 24 s
  other: { file: join(media, 'other-8s.mp4'), mime: 'video/mp4' }, // 640×360 H.264 + AAC, 8 s
  music: { file: join(media, 'tone-30s.m4a'), mime: 'audio/mp4' }, // generated tone, 30 s
  bursts: { file: join(media, 'silence', 'bursts.mp4'), mime: 'video/mp4' }, // 4.5 s, one 1.2 s gap
  webm: { file: join(media, 'wizard', 'tarayici-kaydi.webm'), mime: 'video/webm' }, // VP9 + Opus 640×360, 2 s
  speech: { file: join(media, 'speech-fleurs-en-01.mp4'), mime: 'video/mp4' }, // FLEURS (CC BY 4.0), English
  dark: { file: join(media, 'enhance', 'e2e-v2', 'karanlik.mp4'), mime: 'video/mp4' }, // generated, 1280×720, 3 s, underexposed
};

const adb = (...argv) => spawnSync('adb', argv, { encoding: 'utf8' });
const local = /^http:\/\/localhost:(\d+)/.exec(site)?.[1] ?? null;
function ensurePorts() {
  adb('forward', 'tcp:9222', 'localabstract:chrome_devtools_remote');
  if (local) adb('reverse', `tcp:${local}`, `tcp:${local}`);
}
function removePorts() {
  adb('forward', '--remove', 'tcp:9222');
  if (local) adb('reverse', '--remove', `tcp:${local}`);
}

const state = (adb('get-state').stdout ?? '').trim();
if (state !== 'device') {
  console.log(`phone-wizards: no authorised phone (adb get-state: "${state}") — NOT RUN`);
  process.exit(2);
}
ensurePorts();
const version = await fetch('http://127.0.0.1:9222/json/version')
  .then((r) => r.json())
  .catch(() => null);
if (!version) {
  console.log("phone-wizards: the phone's Chrome is not reachable over DevTools (not in front?) — NOT RUN");
  process.exit(2);
}
const packageName = version['Android-Package'];

/** Android freezes a browser that is not on screen: wait (at most 30 min), never bring it there. */
async function waitInFront() {
  for (let waited = 0; waited < 30 * 60; waited += 30) {
    const top = adb('shell', 'dumpsys', 'activity', 'activities').stdout ?? '';
    const line = top.split('\n').find((l) => l.includes('topResumedActivity')) ?? '';
    if (!packageName || line.includes(packageName)) return true;
    if (waited % 300 === 0) console.error(`${packageName} is not on screen; waiting`);
    await new Promise((r) => setTimeout(r, 30_000));
  }
  return false;
}

/** ffprobe of a saved file: streams, duration, size, the video's own bitrate (packet bytes). */
function probe(file) {
  const out = spawnSync(
    'ffprobe',
    ['-v', 'error', '-count_packets', '-show_entries', 'stream=codec_type,codec_name,width,height,avg_frame_rate,nb_read_packets,sample_rate,channels:format=duration,format_name', '-of', 'json', file],
    { encoding: 'utf8' },
  );
  const json = JSON.parse(out.stdout || '{}');
  const streams = (json.streams ?? []).map((s) =>
    s.codec_type === 'video'
      ? { type: 'video', codec: s.codec_name, width: s.width, height: s.height, fps: s.avg_frame_rate, frames: Number(s.nb_read_packets) }
      : { type: s.codec_type, codec: s.codec_name, sampleRate: Number(s.sample_rate) || null, channels: s.channels ?? null },
  );
  const durationS = Number(json.format?.duration ?? NaN);
  const videoBytes = streams.some((s) => s.type === 'video') ? packetBytes(file, 'v:0') : 0;
  return {
    durationS,
    sizeBytes: statSync(file).size,
    format: json.format?.format_name ?? null,
    streams,
    videoKbps: videoBytes ? Math.round((videoBytes * 8) / durationS / 1000) : null,
  };
}

function packetBytes(file, stream) {
  const out = spawnSync('ffprobe', ['-v', 'error', '-select_streams', stream, '-show_entries', 'packet=size', '-of', 'csv=p=0', file], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  let total = 0;
  for (const line of (out.stdout ?? '').split(/\r?\n/)) {
    const value = Number.parseInt(line, 10);
    if (Number.isFinite(value)) total += value;
  }
  return total;
}

/**
 * Sends a local file into the page in 4 MiB pieces and puts it into the
 * file input `selector` (the one "Videonu seç" / "Müziğini seç" fills).
 */
let transferMs = 0;
async function putFile(page, selector, source) {
  const sentAt = Date.now();
  const bytes = readFileSync(source.file);
  const chunk = 4 * 1024 * 1024;
  await page.evaluate(() => {
    window.__phoneParts = [];
  });
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    await page.evaluate((base64) => {
      const text = atob(base64);
      const part = new Uint8Array(text.length);
      for (let i = 0; i < text.length; i += 1) part[i] = text.charCodeAt(i);
      window.__phoneParts.push(part);
    }, bytes.subarray(offset, offset + chunk).toString('base64'));
  }
  await page.evaluate(
    ({ selector: css, name, mime }) => {
      const file = new File(window.__phoneParts, name, { type: mime });
      window.__phoneParts = [];
      const input = document.querySelector(css);
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    },
    { selector, name: source.name ?? basename(source.file), mime: source.mime },
  );
  // Sending the bytes over USB is the test's cost, not the app's: kept apart from time-to-result.
  transferMs += Date.now() - sentAt;
}

async function clearSiteData(page) {
  return page
    .evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      for await (const [name] of root.entries()) await root.removeEntry(name, { recursive: true }).catch(() => undefined);
      for (const db of (await indexedDB.databases?.()) ?? []) if (db.name) indexedDB.deleteDatabase(db.name);
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch {
        /* ignore */
      }
      for (const registration of (await navigator.serviceWorker?.getRegistrations?.()) ?? []) await registration.unregister().catch(() => undefined);
      // The app's offline copy and the transcript model cache.
      for (const key of (await globalThis.caches?.keys?.()) ?? []) await caches.delete(key).catch(() => undefined);
      const left = { caches: ((await globalThis.caches?.keys?.()) ?? []).length, usageBytes: (await navigator.storage.estimate?.())?.usage ?? null };
      return left;
    })
    .catch((error) => ({ error: String(error.message).split('\n')[0] }));
}

/** Plays the saved file in the phone's own player (muted): how far, decoded bytes, any error. */
function playOnPhone(page, name) {
  return page.evaluate(async (fileName) => {
    const root = await navigator.storage.getDirectory();
    const file = await (await root.getFileHandle(fileName)).getFile();
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.src = URL.createObjectURL(file);
    document.body.append(video);
    try {
      await video.play();
      await new Promise((done) => {
        const started = Date.now();
        const tick = () => (video.currentTime >= 1.5 || video.error || video.ended || Date.now() - started > 15_000 ? done() : setTimeout(tick, 50));
        tick();
      });
      return {
        playedS: Number(video.currentTime.toFixed(2)),
        durationS: Number(video.duration.toFixed(3)),
        error: video.error ? video.error.message || String(video.error.code) : null,
        audioBytes: video.webkitAudioDecodedByteCount ?? -1,
        videoBytes: video.webkitVideoDecodedByteCount ?? -1,
        size: [video.videoWidth, video.videoHeight],
      };
    } catch (error) {
      return { error: String(error?.message ?? error) };
    } finally {
      video.pause();
      URL.revokeObjectURL(video.src);
      video.remove();
    }
  }, name);
}

const text = async (locator) => ((await locator.first().textContent().catch(() => null)) ?? '').replace(/\s+/g, ' ').trim() || null;
const attr = (locator, name) => locator.first().getAttribute(name).catch(() => null);
const seconds = (ms) => Number((ms / 1000).toFixed(1));

/** From the opening screen to the card's first step, by the card's visible name. */
async function openCard(page, row, card) {
  const loadAt = Date.now();
  await page.goto(site, { waitUntil: 'load' });
  await page.locator('html[data-clip-alive]').waitFor({ state: 'attached', timeout: 60_000 });
  row.homeAliveMs = Date.now() - loadAt;
  // The card is a link whose name starts with its label ("Küçült WhatsApp’a sığdır").
  const link = page.getByTestId('task-grid').getByRole('link', { name: new RegExp(`^${card.label}`) });
  row.cardName = await text(link);
  await link.click();
  await page.waitForURL(new RegExp(`/yap/${card.task}/?$`), { timeout: 30_000 });
  await page.getByTestId('wizard').waitFor({ timeout: 30_000 });
  row.cardStepTitle = await text(page.getByTestId('wizard-title'));
}

/** Presses the wizard's İndir (by its name) and waits for the result. */
async function download(page, row, { button } = {}) {
  const go = button ?? page.getByTestId('wizard-download');
  row.downloadButton = await text(go);
  await go.waitFor({ timeout: 120_000 });
  for (let i = 0; i < 240 && !(await go.isEnabled()); i += 1) await page.waitForTimeout(500);
  if (!(await go.isEnabled())) {
    row.blocked = await text(page.getByTestId('wizard-blocked'));
    throw new Error(`İndir stayed off: ${row.blocked ?? 'no reason shown'}`);
  }
  const startedAt = Date.now();
  await go.click();
  row.outcome = await Promise.race([
    page.getByTestId('download-saved').first().waitFor({ timeout: 30 * 60_000 }).then(() => 'saved'),
    page.getByTestId('export-failed').first().waitFor({ timeout: 30 * 60_000 }).then(() => 'failed'),
    page.getByTestId('export-blocked').first().waitFor({ timeout: 30 * 60_000 }).then(() => 'blocked'),
  ]).catch((e) => `timeout: ${e.message.split('\n')[0]}`);
  row.exportS = seconds(Date.now() - startedAt);
  if (row.outcome !== 'saved') {
    row.message = await text(page.locator('[data-testid="export-failed"], [data-testid="export-blocked"]'));
    return null;
  }
  const method = page.getByTestId('export-method').first();
  row.method = await attr(method, 'data-method');
  row.fallback = (await attr(method, 'data-fallback')) || null;
  row.methodText = await text(method);
  row.savedText = await text(page.getByTestId('download-saved'));
  const name = await lastPickedName(page);
  const saved = join(outDir, `${row.id}${name.slice(name.lastIndexOf('.'))}`);
  await readPickedFile(page, name, saved);
  row.file = probe(saved);
  row.play = await playOnPhone(page, name);
  return saved;
}

const near = (value, expected, tolerance) => Math.abs(value - expected) <= tolerance;
const video = (row) => row.file?.streams.find((s) => s.type === 'video') ?? null;
const audio = (row) => row.file?.streams.find((s) => s.type === 'audio') ?? null;
const plays = (row) => row.play && !row.play.error && row.play.playedS >= 1;

/**
 * The cards. `run` walks it (default choices), `checks` say what the card
 * promises of the file. Kes, Dikey yap and Küçült use R11 (real-world sizes).
 */
const CARDS = [
  {
    id: 'kes-r11',
    task: 'kes',
    label: 'Kes',
    source: 'R11',
    async run(page, row) {
      await putFile(page, '[data-testid="video-input"]', SOURCES.R11);
      const openedAt = Date.now();
      await page.getByTestId('preview-video').waitFor({ timeout: 120_000 });
      row.openS = seconds(Date.now() - openedAt);
      row.hint = await text(page.getByTestId('first-run-hint'));
      await page.getByTestId('range-start').fill('2.000');
      await page.getByTestId('range-end').fill('8.000');
      await page.evaluate(() => document.activeElement?.blur());
      await page.waitForTimeout(400);
      await page.getByTestId('add-moment').click();
      return download(page, row, { button: page.getByTestId('kesit-download').first() });
    },
    checks: (row) => ({
      duration6s: near(row.file.durationS, 6, 0.1),
      h264aac: video(row)?.codec === 'h264' && audio(row)?.codec === 'aac',
      // ADR-041: the video's own (displayed) size, 1080 × 1920; never larger.
      ownSize1080x1920: video(row)?.width === 1080 && video(row)?.height === 1920,
      plays: plays(row),
    }),
  },
  {
    id: 'bosluk',
    task: 'bosluk',
    label: 'Boşlukları at',
    source: 'bursts (generated, 4.5 s, one 1.2 s gap)',
    async run(page, row) {
      await putFile(page, '[data-testid="video-input"]', SOURCES.bursts);
      const openedAt = Date.now();
      await page.locator('[data-testid="bosluk-summary"], [data-testid="bosluk-unclear"], [data-testid="bosluk-problem"]').first().waitFor({ timeout: 120_000 });
      row.analyseS = seconds(Date.now() - openedAt);
      row.found = await text(page.getByTestId('bosluk-found'));
      row.shorter = await text(page.getByTestId('bosluk-shorter'));
      return download(page, row);
    },
    checks: (row) => ({
      shorter3_6s: row.file.durationS > 3.5 && row.file.durationS < 3.7,
      h264aac: video(row)?.codec === 'h264' && audio(row)?.codec === 'aac',
      plays: plays(row),
    }),
  },
  {
    id: 'dikey-r11',
    task: 'dikey',
    label: 'Dikey yap',
    source: 'R11',
    async run(page, row) {
      await putFile(page, '[data-testid="video-input"]', SOURCES.R11);
      await page.locator('[data-testid="dikey-choice"], [data-testid="dikey-already"]').first().waitFor({ timeout: 120_000 });
      row.said = (await text(page.getByTestId('dikey-already'))) ?? (await text(page.getByTestId('dikey-size')));
      return download(page, row);
    },
    checks: (row) => ({
      already916: /zaten dikey/.test(row.said ?? ''),
      // Already 9:16 at 1080 × 1920: kept at that size (ADR-041).
      size1080x1920: video(row)?.width === 1080 && video(row)?.height === 1920,
      duration: near(row.file.durationS, 21.7, 0.15),
      plays: plays(row),
    }),
  },
  {
    id: 'dikey-720p',
    task: 'dikey',
    label: 'Dikey yap',
    source: 'sample-24s (generated test card, 1280×720)',
    async run(page, row) {
      await putFile(page, '[data-testid="video-input"]', SOURCES.sample);
      await page.getByTestId('dikey-choice').waitFor({ timeout: 120_000 });
      row.defaultChoice = (await page.getByTestId('option-cover').isChecked()) ? 'cover' : 'other';
      row.said = await text(page.getByTestId('dikey-size'));
      return download(page, row);
    },
    checks: (row) => {
      const v = video(row);
      const said = /(\d+) × (\d+)/.exec(row.said ?? '');
      return {
        // ADR-041 table: 1280 × 720 → "Doldur" → 406 × 720, never 1080 × 1920.
        ratio9x16: v ? near(v.width / v.height, 9 / 16, 0.01) : false,
        notUpscaled: v ? v.height <= 720 && v.width * v.height <= 1280 * 720 : false,
        sizeAsSaid: Boolean(said && v && Number(said[1]) === v.width && Number(said[2]) === v.height),
        plays: plays(row),
      };
    },
  },
  {
    id: 'kucult-r11',
    task: 'kucult',
    label: 'Küçült',
    source: 'R11',
    async run(page, row) {
      await putFile(page, '[data-testid="video-input"]', SOURCES.R11);
      const openedAt = Date.now();
      await page.getByTestId('kucult-choice').waitFor({ timeout: 120_000 });
      for (const id of ['share', 'email', 'whatsapp']) {
        await page.locator(`[data-testid="size-hint-${id}"]:not([data-state="pending"])`).waitFor({ timeout: 180_000 });
      }
      row.hintsS = seconds(Date.now() - openedAt);
      row.checked = (await page.getByTestId('option-whatsapp').isChecked()) ? 'whatsapp' : await page.locator('[data-testid="kucult-choice"] input[type="radio"]:checked').getAttribute('value').catch(() => null);
      const hint = page.getByTestId('size-hint-whatsapp');
      row.whatsappHint = { text: await text(hint), state: await attr(hint, 'data-state'), plannedBytes: Number(await attr(hint, 'data-planned-bytes')), shortEdge: await attr(hint, 'data-short-edge') };
      const saved = await download(page, row);
      const line = page.getByTestId('target-size-result').first();
      if (saved && (await line.count()) > 0) {
        row.target = {};
        for (const key of ['fits', 'target-bytes', 'planned-bytes', 'actual-bytes', 'attempts', 'short-edge', 'video-bitrate', 'audio-bitrate', 'encoder', 'mode']) {
          row.target[key] = await attr(line, `data-${key}`);
        }
        row.target.text = await text(line);
        row.videoWrittenRatio = Number((packetBytes(saved, 'v:0') * 8 / row.file.durationS / Number(row.target['video-bitrate'])).toFixed(4));
      }
      return saved;
    },
    checks: (row) => ({
      whatsappDefault: row.checked === 'whatsapp',
      under16MB: row.file.sizeBytes <= 16_000_000,
      saysFits: row.target?.fits === 'true',
      saysOwnSize: Number(row.target?.['actual-bytes']) === row.file.sizeBytes,
      duration: near(row.file.durationS, 21.7, 0.15),
      h264aac: video(row)?.codec === 'h264' && audio(row)?.codec === 'aac',
      plays: plays(row),
    }),
  },
  {
    id: 'yazi',
    task: 'yazi',
    label: 'Yazıya dök',
    source: 'speech-fleurs-en-01 (FLEURS, CC BY 4.0, English)',
    async run(page, row) {
      await putFile(page, '[data-testid="video-input"]', SOURCES.speech);
      await page.locator('[data-testid="model-download"], [data-testid="transcribe-start"], [data-testid="yazi-no-sound"]').first().waitFor({ timeout: 120_000 });
      row.largeOffered = (await page.getByTestId('option-model-turbo').count()) > 0;
      row.preselected = row.largeOffered ? ((await page.getByTestId('option-model-turbo').isChecked()) ? 'turbo' : 'base') : 'base';
      if (yaziModel === 'base' && row.largeOffered) {
        await page.getByTestId('option-model-base').check();
        await page.waitForTimeout(500);
      }
      row.model = yaziModel === 'base' ? 'base' : row.preselected;
      row.env = await page.evaluate(async () => ({
        webgpu: 'gpu' in navigator,
        storageQuotaBytes: (await navigator.storage.estimate?.())?.quota ?? null,
        connection: navigator.connection ? { type: navigator.connection.type ?? null, effectiveType: navigator.connection.effectiveType ?? null, downlinkMbps: navigator.connection.downlink ?? null } : null,
      }));
      const get = page.getByTestId('model-download');
      if ((await get.count()) > 0) {
        row.downloadLabel = await text(get);
        const before = await page.evaluate(async () => (await navigator.storage.estimate?.())?.usage ?? null);
        const startedAt = Date.now();
        await get.click();
        await page.locator('[data-testid="transcribe-start"], [data-testid="model-failed"]').first().waitFor({ timeout: 60 * 60_000 });
        row.modelDownloadS = seconds(Date.now() - startedAt);
        const after = await page.evaluate(async () => (await navigator.storage.estimate?.())?.usage ?? null);
        row.modelStoredBytes = before !== null && after !== null ? after - before : null;
        if ((await page.getByTestId('model-failed').count()) > 0) {
          row.modelFailed = await attr(page.getByTestId('model-failed'), 'data-reason');
          throw new Error(`model download failed: ${row.modelFailed}`);
        }
        row.downloadMbps = row.modelStoredBytes ? Number(((row.modelStoredBytes * 8) / 1e6 / row.modelDownloadS).toFixed(1)) : null;
      }
      // A newcomer presses "Yazıya dök", and after a failure the same button ("Tekrar dene") once more.
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const startedAt = Date.now();
        await page.getByTestId('transcribe-start').click();
        await page.locator('[data-testid="transcript-panel"], [data-testid="transcribe-failed"]').first().waitFor({ timeout: 30 * 60_000 });
        row.transcribeS = seconds(Date.now() - startedAt);
        if ((await page.getByTestId('transcribe-failed').count()) === 0) break;
        row.transcribeFailures = row.transcribeFailures ?? [];
        row.transcribeFailures.push({
          attempt,
          afterS: row.transcribeS,
          reason: await attr(page.getByTestId('transcribe-failed'), 'data-reason'),
          shown: await text(page.getByTestId('transcribe-failed')),
          detail: await text(page.getByTestId('transcribe-failed-detail')),
        });
        if (attempt === 2) throw new Error(`transcription failed twice: ${row.transcribeFailures.map((f) => f.reason).join(', ')}`);
      }
      row.summary = await text(page.getByTestId('yazi-summary'));
      row.transcript = (await page.locator('[data-testid="transcript-row"][data-kind="cue"] .transcript-text').allTextContents()).join(' ').trim();
      return download(page, row);
    },
    checks: (row) => ({
      transcriptAppears: /French people who had made peace with the Germans/i.test(row.transcript ?? ''),
      burnedInH264: video(row)?.codec === 'h264',
      hasSound: audio(row)?.codec === 'aac',
      plays: plays(row),
    }),
  },
  {
    id: 'muzik',
    task: 'muzik',
    label: 'Müzik ekle',
    source: 'other-8s (generated, 640×360) + tone-30s (generated)',
    async run(page, row) {
      await putFile(page, '[data-testid="video-input"]', SOURCES.other);
      await page.getByTestId('muzik-pick').waitFor({ timeout: 120_000 });
      row.waitsForMusic = await text(page.getByTestId('wizard-blocked'));
      await putFile(page, '[data-testid="audio-input"]', SOURCES.music);
      await page.getByTestId('muzik-picked').waitFor({ timeout: 60_000 });
      row.defaultChoice = (await page.getByTestId('option-keep').isChecked()) ? 'keep' : 'other';
      return download(page, row);
    },
    checks: (row) => ({
      duration8s: near(row.file.durationS, 8, 0.1),
      ownSize640x360: video(row)?.width === 640 && video(row)?.height === 360,
      h264aac: video(row)?.codec === 'h264' && audio(row)?.codec === 'aac',
      plays: plays(row),
    }),
  },
  {
    id: 'ses',
    task: 'ses',
    label: 'Sesini al',
    source: 'sample-24s (generated)',
    async run(page, row) {
      await putFile(page, '[data-testid="video-input"]', SOURCES.sample);
      await page.getByTestId('ses-info').waitFor({ timeout: 120_000 });
      return download(page, row);
    },
    checks: (row) => ({
      m4aName: /\.m4a$/.test(row.savedText ?? ''),
      audioOnlyAac: row.file.streams.length === 1 && audio(row)?.codec === 'aac',
      duration24s: near(row.file.durationS, 24, 0.01),
      plays: plays(row),
    }),
  },
  {
    id: 'sustur',
    task: 'sustur',
    label: 'Sesi kapat',
    source: 'sample-24s (generated)',
    async run(page, row) {
      await putFile(page, '[data-testid="video-input"]', SOURCES.sample);
      await page.getByTestId('sustur-info').waitFor({ timeout: 120_000 });
      return download(page, row);
    },
    checks: (row) => ({
      noAudioTrack: row.file.streams.length === 1 && video(row)?.codec === 'h264',
      duration24s: near(row.file.durationS, 24, 0.1),
      ownSize1280x720: video(row)?.width === 1280 && video(row)?.height === 720,
      copied: row.method === 'copy',
      playsSilent: plays(row) && row.play.audioBytes === 0,
    }),
  },
  {
    id: 'cevir-webm',
    task: 'cevir',
    label: 'Her yerde açılsın',
    source: 'tarayici-kaydi.webm (generated, VP9 + Opus, 640×360)',
    async run(page, row) {
      await putFile(page, '[data-testid="video-input"]', SOURCES.webm);
      await page.getByTestId('cevir-info').waitFor({ timeout: 120_000 });
      return download(page, row);
    },
    checks: (row) => ({
      h264aacMp4: video(row)?.codec === 'h264' && audio(row)?.codec === 'aac' && /mp4/.test(row.file.format ?? ''),
      ownSize640x360: video(row)?.width === 640 && video(row)?.height === 360,
      duration2s: near(row.file.durationS, 2, 0.1),
      plays: plays(row),
    }),
  },
  {
    id: 'cevir-r11',
    task: 'cevir',
    label: 'Her yerde açılsın',
    source: 'R11 (iPhone HEVC HLG)',
    async run(page, row) {
      await putFile(page, '[data-testid="video-input"]', SOURCES.R11);
      await page.getByTestId('cevir-info').waitFor({ timeout: 120_000 });
      return download(page, row);
    },
    checks: (row) => ({
      h264aacMp4: video(row)?.codec === 'h264' && audio(row)?.codec === 'aac' && /mp4/.test(row.file.format ?? ''),
      size1080x1920: video(row)?.width === 1080 && video(row)?.height === 1920,
      duration: near(row.file.durationS, 21.7, 0.15),
      plays: plays(row),
    }),
  },
  {
    id: 'iyilestir',
    task: 'iyilestir',
    label: 'İyileştir',
    source: 'karanlik (generated, 1280×720, 3 s, two stops dark)',
    async run(page, row) {
      await putFile(page, '[data-testid="video-input"]', SOURCES.dark);
      const openedAt = Date.now();
      await page.locator('[data-testid="enhance-preview"][data-status="ready"], [data-testid="enhance-preview"][data-status="failed"]').first().waitFor({ timeout: 300_000 });
      row.previewS = seconds(Date.now() - openedAt);
      const preview = page.getByTestId('enhance-preview');
      row.preview = { status: await attr(preview, 'data-status'), engine: await attr(preview, 'data-engine') };
      row.summary = await text(page.getByTestId('iyilestir-summary'));
      row.light = await attr(page.getByTestId('iyilestir-summary'), 'data-light');
      row.defaultChoice = await page.locator('[data-testid="iyilestir-choice"] input[type="radio"]:checked').getAttribute('value').catch(() => null);
      const saved = await download(page, row);
      const line = page.getByTestId('export-enhance');
      if (saved && (await line.count()) > 0) {
        row.enhance = {};
        for (const key of ['engine', 'accelerated', 'strength', 'enhanced-frames', 'analysed-frames', 'light']) row.enhance[key] = await attr(line, `data-${key}`);
        row.enhance.text = await text(line);
      }
      return saved;
    },
    checks: (row) => ({
      enhanced90: row.enhance?.['enhanced-frames'] === '90',
      onGpu: row.enhance?.accelerated === 'true',
      h264: video(row)?.codec === 'h264' && video(row)?.frames === 90,
      plays: plays(row),
    }),
  },
];

/**
 * Connects through the own-tabs proxy. When Android puts the browser in the background
 * the DevTools socket goes away and the connection drops; `freshTab` connects again.
 */
async function connect() {
  for (let attempt = 1; ; attempt += 1) {
    ensurePorts();
    try {
      return await chromium.connectOverCDP(await ownTabsEndpoint('http://127.0.0.1:9222'), { timeout: 180_000 });
    } catch (error) {
      if (attempt >= 20) throw error;
      console.error(`phone unreachable (${String(error.message).split(/\r?\n/)[0]}), retrying in 30 s`);
      await new Promise((r) => setTimeout(r, 30_000));
    }
  }
}
let browser = await connect();
let context = browser.contexts()[0];
const phone = {
  model: (adb('shell', 'getprop', 'ro.product.model').stdout ?? '').trim(),
  android: (adb('shell', 'getprop', 'ro.build.version.release').stdout ?? '').trim(),
  browser: version.Browser,
};
const result = { at: new Date().toISOString(), site, phone, mode: watchdogRounds > 0 ? 'watchdog' : 'cards', rows: [] };
const outFile = join(outDir, `phone-wizards-${watchdogRounds > 0 ? 'watchdog-' : ''}${Date.now()}.json`);
const save = () => writeFileSync(outFile, `${JSON.stringify(result, null, 1)}\n`);

/** A fresh tab of this script's own, watched for page errors, console errors and a crash. */
async function freshTab() {
  if (!browser.isConnected()) {
    console.error('connection to the phone dropped; connecting again');
    await waitInFront();
    browser = await connect();
    context = browser.contexts()[0];
  }
  const page = await context.newPage();
  const watch = { pageErrors: [], consoleErrors: [], recoveredLines: [], crashed: false };
  page.on('pageerror', (e) => watch.pageErrors.push(String(e.message).slice(0, 300)));
  page.on('console', (m) => {
    if (m.type() === 'error') watch.consoleErrors.push(m.text().slice(0, 300));
    if (m.text().startsWith('[page-recovered]')) watch.recoveredLines.push(m.text());
  });
  page.on('crash', () => {
    watch.crashed = true;
  });
  return { page, watch };
}

try {
  if (watchdogRounds > 0) {
    // ADR-044: the opening screen and two wizard pages, each load in a fresh tab.
    const paths = ['', 'yap/kes/', 'yap/yazi/'];
    for (let round = 1; round <= watchdogRounds; round += 1) {
      for (const path of paths) {
        ensurePorts();
        await waitInFront();
        const { page, watch } = await freshTab();
        await page.addInitScript(() => {
          window.__aliveAt = null;
          const mark = () => {
            if (window.__aliveAt === null && document.documentElement.hasAttribute('data-clip-alive')) window.__aliveAt = performance.now();
          };
          // The init script runs before <html> exists: watch the document itself.
          new MutationObserver(mark).observe(document, { attributes: true, subtree: true, attributeFilter: ['data-clip-alive'] });
        });
        const row = { round, path: `/${path}` };
        try {
          await page.goto(`${site}${path}`, { waitUntil: 'load', timeout: 60_000 });
          await page.locator('html[data-clip-alive]').waitFor({ state: 'attached', timeout: 45_000 }).catch(() => undefined);
          Object.assign(
            row,
            await page.evaluate(() => {
              const nav = performance.getEntriesByType('navigation')[0];
              let flag = null;
              try {
                flag = sessionStorage.getItem('clip:page-recovery');
              } catch {
                flag = 'unreadable';
              }
              return {
                alive: document.documentElement.hasAttribute('data-clip-alive'),
                aliveMs: window.__aliveAt === null ? null : Math.round(window.__aliveAt),
                domContentLoadedMs: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
                loadMs: nav ? Math.round(nav.loadEventEnd) : null,
                navigationType: nav?.type ?? null,
                transferBytes: nav?.transferSize ?? null,
                fromServiceWorker: Boolean(navigator.serviceWorker?.controller),
                recoveryFlag: flag,
                // The notice is always in the page; `data-state` says whether it is shown.
                deadNotice: document.getElementById('clip-page-dead')?.getAttribute('data-state') ?? null,
              };
            }),
          );
        } catch (error) {
          row.error = String(error.message ?? error).split('\n')[0];
        }
        Object.assign(row, { recoveredLines: watch.recoveredLines, pageErrors: watch.pageErrors, consoleErrors: watch.consoleErrors, crashed: watch.crashed });
        const last = round === watchdogRounds && path === paths.at(-1);
        if (last) result.cleanup = await clearSiteData(page);
        await page.close().catch(() => undefined);
        result.rows.push(row);
        save();
        console.log(JSON.stringify(row));
      }
    }
  } else {
    for (const card of CARDS) {
      if (only.length > 0 && !only.includes(card.id)) continue;
      ensurePorts();
      await waitInFront();
      const { page, watch } = await freshTab();
      await installSavePicker(page);
      const row = { id: card.id, task: card.task, source: card.source };
      const startedAt = Date.now();
      transferMs = 0;
      try {
        await openCard(page, row, card);
        const saved = await card.run(page, row);
        // From loading the opening screen to the saved file, without the USB transfer of the source.
        row.transferS = seconds(transferMs);
        row.resultS = seconds(Date.now() - startedAt - transferMs);
        if (saved && row.file) {
          row.checks = card.checks(row);
          row.ok = Object.values(row.checks).every(Boolean);
        } else {
          row.ok = false;
        }
      } catch (error) {
        row.outcome = row.outcome ?? `error: ${String(error.message ?? error).split('\n')[0]}`;
        row.ok = false;
        row.stuckAt = {
          url: page.url().replace(site, '/'),
          step: await attr(page.getByTestId('wizard'), 'data-step'),
          title: await text(page.getByTestId('wizard-title')),
          status: await text(page.locator('[role="status"]')),
          alert: await text(page.locator('[role="alert"]')),
        };
      }
      Object.assign(row, { pageErrors: watch.pageErrors, consoleErrors: watch.consoleErrors, crashed: watch.crashed });
      row.cleanup = watch.crashed ? 'tab crashed' : await clearSiteData(page);
      await page.close().catch(() => undefined);
      result.rows.push(row);
      save();
      console.log(JSON.stringify(row));
    }
  }
} finally {
  // A crashed or failed tab can leave storage behind: one more fresh tab of ours cleans the origin.
  // It opens the site's icon, not a page: no app code runs there, so no service worker is registered again.
  try {
    const { page } = await freshTab();
    await page.goto(`${site}icon.svg`, { waitUntil: 'load', timeout: 60_000 }).catch(() => undefined);
    result.finalCleanup = await clearSiteData(page);
    await page.close().catch(() => undefined);
  } catch (error) {
    result.finalCleanup = { error: String(error.message ?? error).split('\n')[0] };
  }
  result.finishedAt = new Date().toISOString();
  save();
  if (!process.argv.includes('--keep-ports')) removePorts();
  console.log(`phone-wizards: ${outFile}; final cleanup ${JSON.stringify(result.finalCleanup)}`);
}
// Only disconnect: never close the phone's own browser.
process.exit(0);
