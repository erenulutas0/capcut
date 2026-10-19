/**
 * The twelve task cards (ADR-034; GIF yap ADR-046, Sesi düzelt ADR-049) and
 * one English walk (ADR-048) on a REAL Android phone's Chrome over adb +
 * CDP, the way a newcomer walks them: the opening screen, the card (found by
 * its visible name), the video, the default choice, İndir. Every saved file
 * is copied back here and measured with ffprobe; the card's own promise is
 * checked (WhatsApp under 16 MB, 9:16 without enlarging, no audio track, an
 * M4A, ...). Time-to-result, page errors and console errors are recorded.
 *
 *   adb forward tcp:9222 localabstract:chrome_devtools_remote
 *   node scripts/android/phone-wizards.mjs [--url=https://erenulutas0.github.io/capcut/]
 *     [--only=kes-portrait,gif,...] [--label=<folder suffix>] [--media=<dir>] [--yazi-model=default|base]
 *     [--real] [--keep-site-data]
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
 * `--keep-site-data` (19 Oct): the site's storage is NOT cleared — the phone's
 * owner may have the installed app (same origin) with data of its own. Only
 * the files this script saved (`picked-*` in OPFS) are deleted, and the one
 * localStorage key the English case changes (`clip.language`) is put back as
 * it was; what is left on the site is recorded (names and counts only).
 *
 * Sources: generated or public test media. The R11 cases (a public-domain
 * iPhone 12 Pro recording in tests/media/real/, for real-world sizes) run only
 * with `--real` (or by name in `--only`); by default Kes, Dikey yap, Küçült and
 * Her yerde açılsın use generated stand-ins (portrait 720×1280, a 24.7 MB noisy
 * 720p clip, a VP9 HLG clip with a 90° rotation). Rows name sources by case
 * id, never by file name.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

import { ownTabsEndpoint } from './cdp-own-tabs.mjs';
import { installSavePicker, lastPickedName, readPickedFile } from '../lib/kesit-flow.mjs';
import { avSync } from '../lib/av-sync.mjs';

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const site = arg('url', 'https://erenulutas0.github.io/capcut/').replace(/\/?$/, '/');
const only = arg('only', '').split(',').filter(Boolean);
const label = arg('label', '');
const yaziModel = arg('yazi-model', 'default');
const watchdogRounds = Number(arg('watchdog', '0'));
const useReal = process.argv.includes('--real');
const keepSiteData = process.argv.includes('--keep-site-data');
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
  portrait: { file: join(media, 'matrix', 'm01-portrait-20s.mp4'), mime: 'video/mp4' }, // generated, 720×1280 H.264 + AAC, 20 s
  noisy: { file: join(media, 'targetsize', 'noisy-720p30-14s.mp4'), mime: 'video/mp4' }, // generated, 1280×720, 14 s, 24.7 MB
  hlg: { file: join(media, 'matrix', 'm10-hdr-hlg-vp9-rot90.mp4'), mime: 'video/mp4' }, // generated, VP9 10-bit HLG, 90° matrix, 4 s
  // Sesi düzelt (ADR-049): tests/e2e/soundfix-media.ts makes them (synthetic voice, test picture).
  quiet: { file: join(media, 'soundfix', 'kisik-konusma.mp4'), mime: 'video/mp4' }, // about −38 LUFS
  uneven: { file: join(media, 'soundfix', 'dengesiz-konusma.mp4'), mime: 'video/mp4' }, // one line 22 dB under the other
  sync: { file: join(media, 'soundfix', 'sync-clip.mp4'), mime: 'video/mp4' }, // scripts/lib/av-sync.mjs, 1080×1920, 12 s
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
 * A GIF read with rules of our own (as src/domain/gifInspect.ts does): the
 * header, the screen size, the frames, their delays, the NETSCAPE loop block.
 */
function inspectGif(bytes) {
  const header = bytes.subarray(0, 6).toString('latin1');
  if (header !== 'GIF89a' && header !== 'GIF87a') return { ok: false, reason: `header ${JSON.stringify(header)}` };
  const width = bytes.readUInt16LE(6);
  const height = bytes.readUInt16LE(8);
  let at = 13;
  if (bytes[10] & 0x80) at += 3 * 2 ** ((bytes[10] & 7) + 1);
  const skipSubBlocks = () => {
    while (at < bytes.length && bytes[at] !== 0) at += bytes[at] + 1;
    at += 1;
  };
  let frames = 0;
  let loops = null;
  const delaysCs = [];
  let trailer = false;
  while (at < bytes.length) {
    const kind = bytes[at];
    if (kind === 0x3b) {
      trailer = true;
      break;
    }
    if (kind === 0x21) {
      const label = bytes[at + 1];
      if (label === 0xf9) delaysCs.push(bytes.readUInt16LE(at + 4));
      if (label === 0xff && bytes.subarray(at + 3, at + 14).toString('latin1') === 'NETSCAPE2.0') loops = bytes.readUInt16LE(at + 16);
      at += 2;
      skipSubBlocks();
    } else if (kind === 0x2c) {
      frames += 1;
      const packed = bytes[at + 9];
      at += 10;
      if (packed & 0x80) at += 3 * 2 ** ((packed & 7) + 1);
      at += 1; // LZW minimum code size
      skipSubBlocks();
    } else {
      return { ok: false, reason: `unknown block 0x${kind?.toString(16)} at ${at}` };
    }
  }
  return { ok: trailer, header, width, height, frames, loops, delaysCs: [...new Set(delaysCs)], durationCs: delaysCs.reduce((a, b) => a + b, 0), bytes: bytes.length };
}

/** ffmpeg's own reading of a GIF: frames, size. */
function ffprobeGif(file) {
  const out = spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames,width,height', '-of', 'json', file], { encoding: 'utf8' });
  const stream = JSON.parse(out.stdout || '{}').streams?.[0];
  return { frames: Number(stream?.nb_read_frames), width: stream?.width ?? 0, height: stream?.height ?? 0 };
}

/** The first frame as RGB, decoded by ffmpeg. */
const firstFrameRgb = (file) => spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { maxBuffer: 1 << 26 }).stdout;

/** Mean absolute difference of two RGB frames over the rows [y0, y1). */
function bandDiff(a, b, width, y0, y1) {
  let sum = 0;
  for (let i = y0 * width * 3; i < y1 * width * 3; i += 1) sum += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
  return Number((sum / ((y1 - y0) * width * 3)).toFixed(2));
}

/** ffmpeg's EBU R128 meter over the whole sound (true peak 4× oversampled), as tests/e2e/soundfix-media.ts. */
function loudness(file) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-map', '0:a:0', '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const summary = result.stderr.slice(result.stderr.lastIndexOf('Summary:'));
  const number = (pattern) => {
    const match = pattern.exec(summary);
    return match ? Number(match[1]) : Number.NaN;
  };
  return { integratedLufs: number(/I:\s+(-?[\d.]+|-inf) LUFS/), lraLu: number(/LRA:\s+(-?[\d.]+) LU/), truePeakDbtp: number(/True peak:\s+Peak:\s+(-?[\d.]+|-inf) dBFS/) };
}

const frameMd5 = (file, copy) =>
  spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-map', '0:v:0', ...(copy ? ['-c', 'copy'] : []), '-f', 'framemd5', '-'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
    .stdout.split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split(',').pop()?.trim() ?? '');
const firstVideoPacket = (file) =>
  spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-map', '0:v:0', '-c', 'copy', '-frames:v', '1', '-f', 'data', '-'], { maxBuffer: 64 * 1024 * 1024 }).stdout;
function nalTypes(packet) {
  const types = [];
  for (let at = 0; at + 4 < packet.length; ) {
    const size = packet.readUInt32BE(at);
    types.push((packet[at + 4] ?? 0) & 0x1f);
    at += 4 + size;
  }
  return types;
}

/**
 * The copy path (ADR-027) as tests/e2e/sound-fix.spec.ts checks it: every video packet byte for byte the
 * source's, except that the first key frame carries the source's SPS/PPS in front of it; and so every
 * decoded picture the same pixels.
 */
function samePictures(saved, source) {
  const out = frameMd5(saved, true);
  const original = frameMd5(source, true);
  const first = firstVideoPacket(saved);
  const sourceFirst = firstVideoPacket(source);
  const decodedOut = frameMd5(saved, false);
  const decodedSource = frameMd5(source, false);
  return {
    packets: [out.length, original.length],
    samePacketCount: out.length === original.length,
    restEqual: out.length === original.length && out.slice(1).every((hash, i) => hash === original[i + 1]),
    firstEndsWithSource: first.length >= sourceFirst.length && first.subarray(first.length - sourceFirst.length).equals(sourceFirst),
    firstStartsSpsPps: nalTypes(first).slice(0, 2).join(',') === '7,8',
    decodedEqual: decodedOut.length === decodedSource.length && decodedOut.every((hash, i) => hash === decodedSource[i]),
  };
}

/** Duration of each stream and of the container (ffprobe). */
function durations(file) {
  const out = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,duration', '-of', 'json', file], { encoding: 'utf8' });
  const parsed = JSON.parse(out.stdout || '{}');
  const of = (type) => {
    const stream = (parsed.streams ?? []).find((item) => item.codec_type === type);
    return stream?.duration ? Number(stream.duration) : null;
  };
  return { format: Number(parsed.format?.duration), video: of('video'), audio: of('audio') };
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

/**
 * `--keep-site-data`: deletes only the files this script saved (the save stand-in's `picked-*` in OPFS),
 * nothing else of the site's storage.
 */
async function removeOwnFiles(page) {
  return page
    .evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const names = [];
      for await (const [name] of root.entries()) if (name.startsWith('picked-')) names.push(name);
      for (const name of names) await root.removeEntry(name).catch(() => undefined);
      let left = 0;
      for await (const [name] of root.entries()) if (name.startsWith('picked-')) left += 1;
      return { removedOwnFiles: names.length, ownFilesLeft: left };
    })
    .catch((error) => ({ error: String(error.message).split('\n')[0] }));
}

const cleanup = (page) => (keepSiteData ? removeOwnFiles(page) : clearSiteData(page));

/** What the site keeps on the phone: names of caches, databases and localStorage keys, counts of OPFS entries. No contents. */
function siteState(page) {
  return page
    .evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const opfs = { picked: 0, exportTemp: 0, other: 0 };
      for await (const [name] of root.entries()) {
        if (name.startsWith('picked-')) opfs.picked += 1;
        else if (name.startsWith('clip-export-')) opfs.exportTemp += 1;
        else opfs.other += 1;
      }
      let keys = null;
      try {
        keys = Object.keys(localStorage).sort();
      } catch {
        keys = 'unreadable';
      }
      return {
        opfs,
        caches: ((await globalThis.caches?.keys?.()) ?? []).sort(),
        indexedDb: ((await indexedDB.databases?.()) ?? []).map((db) => db.name).sort(),
        localStorageKeys: keys,
        serviceWorkers: ((await navigator.serviceWorker?.getRegistrations?.()) ?? []).length,
        usageBytes: (await navigator.storage.estimate?.())?.usage ?? null,
      };
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
/** The text of something that may not be on the screen, without waiting the 30 s default for it (it would count as the phone's time). */
const textIfThere = async (locator) => ((await locator.count()) > 0 ? text(locator) : null);
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

/**
 * Presses the wizard's İndir (by its name) and waits for the result. `into`: the object the facts go to
 * (a second download of the same card keeps its own); `gif`: the file is a GIF (read with our own rules
 * and ffprobe, shown on the phone as a picture, not played as a video).
 */
async function download(page, row, { button, gif = false, into = row, suffix = '' } = {}) {
  const go = button ?? page.getByTestId('wizard-download');
  into.downloadButton = await text(go);
  await go.waitFor({ timeout: 120_000 });
  for (let i = 0; i < 240 && !(await go.isEnabled()); i += 1) await page.waitForTimeout(500);
  if (!(await go.isEnabled())) {
    into.blocked = await text(page.getByTestId('wizard-blocked'));
    throw new Error(`İndir stayed off: ${into.blocked ?? 'no reason shown'}`);
  }
  const startedAt = Date.now();
  await go.click();
  into.outcome = await Promise.race([
    page.getByTestId('download-saved').first().waitFor({ timeout: 30 * 60_000 }).then(() => 'saved'),
    page.getByTestId('export-failed').first().waitFor({ timeout: 30 * 60_000 }).then(() => 'failed'),
    page.getByTestId('export-blocked').first().waitFor({ timeout: 30 * 60_000 }).then(() => 'blocked'),
  ]).catch((e) => `timeout: ${e.message.split('\n')[0]}`);
  into.exportS = seconds(Date.now() - startedAt);
  // The phone's part ends here: copying the file out and measuring it on this computer is not counted.
  into.savedAtMs = Date.now();
  if (into.outcome !== 'saved') {
    into.message = await text(page.locator('[data-testid="export-failed"], [data-testid="export-blocked"]'));
    return null;
  }
  into.savedText = await text(page.getByTestId('download-saved'));
  const name = await lastPickedName(page);
  const saved = join(outDir, `${row.id}${suffix}${name.slice(name.lastIndexOf('.'))}`);
  await readPickedFile(page, name, saved);
  if (gif) {
    into.resultLine = await text(page.getByTestId('gif-result-line'));
    into.gif = inspectGif(readFileSync(saved));
    into.ffprobe = ffprobeGif(saved);
    into.file = { sizeBytes: statSync(saved).size, format: 'gif' };
    into.shown = await showGifOnPhone(page, name);
    return saved;
  }
  const method = page.getByTestId('export-method').first();
  into.method = await attr(method, 'data-method');
  into.fallback = (await attr(method, 'data-fallback')) || null;
  into.methodText = await text(method);
  into.file = probe(saved);
  into.play = await playOnPhone(page, name);
  return saved;
}

/** Decodes the saved GIF in the phone's own image decoder: its size, or the error. */
function showGifOnPhone(page, name) {
  return page.evaluate(async (fileName) => {
    const root = await navigator.storage.getDirectory();
    const file = await (await root.getFileHandle(fileName)).getFile();
    const image = new Image();
    image.src = URL.createObjectURL(file);
    try {
      await image.decode();
      return { size: [image.naturalWidth, image.naturalHeight], type: file.type || null, error: null };
    } catch (error) {
      return { error: String(error?.message ?? error) };
    } finally {
      URL.revokeObjectURL(image.src);
    }
  }, name);
}

/** Words only the Turkish pages show (as tests/e2e/english.spec.ts's markers); and any word with a Turkish letter. */
const TURKISH_MARKERS = ['Ne yapmak istiyorsun?', 'Kendim düzenleyeceğim', 'Videonu seç', 'Bütün işler', 'İstediğin yerleri al', 'Video seç', 'Kaydedildi'];
/** The visible words of the page, the language button's own name ("Türkçe") left out. */
function englishCheck(page) {
  return page.evaluate((markers) => {
    const button = document.querySelector('[data-testid="language-switch"]')?.innerText ?? '';
    const visible = button ? document.body.innerText.replace(button, ' ') : document.body.innerText;
    const words = visible.split(/\s+/).filter((word) => /[çğıİöşüÇĞÖŞÜ]/.test(word));
    return {
      path: location.pathname,
      lang: document.documentElement.lang,
      title: document.querySelector('[data-testid="home-title"]')?.innerText?.trim() ?? null,
      languageButton: button.trim() || null,
      turkishWords: [...new Set(words)].slice(0, 20),
      turkishMarkers: markers.filter((marker) => visible.includes(marker)),
      words: visible.split(/\s+/).filter(Boolean).length,
    };
  }, TURKISH_MARKERS);
}

const near = (value, expected, tolerance) => Math.abs(value - expected) <= tolerance;
const video = (row) => row.file?.streams.find((s) => s.type === 'video') ?? null;
const audio = (row) => row.file?.streams.find((s) => s.type === 'audio') ?? null;
const plays = (row) => row.play && !row.play.error && row.play.playedS >= 1;

/**
 * The cards. `run` walks it (default choices), `checks` say what the card
 * promises of the file. `real`: an R11 case (only with --real or by name).
 * `open`: the case opens its own first page (the English walk).
 */
const CARDS = [
  {
    id: 'kes-r11',
    task: 'kes',
    label: 'Kes',
    source: 'R11',
    real: true,
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
    real: true,
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
    real: true,
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
      // A build with the cloud route (ADR-039) asks the cloud for minutes when an invite code is stored:
      // this script never contacts the cloud, so it stops before the video is chosen.
      if (await page.evaluate(() => localStorage.getItem('clip.cloudInvite') !== null)) throw new Error('not run: an invite code is stored (the choice screen would ask the cloud)');
      await putFile(page, '[data-testid="video-input"]', SOURCES.speech);
      await page.locator('[data-testid="route-choice"], [data-testid="model-download"], [data-testid="transcribe-start"], [data-testid="yazi-no-sound"]').first().waitFor({ timeout: 120_000 });
      // The cloud route's first screen (19 Oct, live with the cloud on): "on my device" by its button.
      if ((await page.getByTestId('route-choice').count()) > 0) {
        row.routeChoice = { title: await text(page.getByTestId('wizard-title')), device: await text(page.getByTestId('route-device')), invite: await attr(page.getByTestId('route-choice'), 'data-invite') };
        await page.getByTestId('route-device-go').click();
        await page.locator('[data-testid="model-download"], [data-testid="transcribe-start"], [data-testid="yazi-no-sound"], [data-testid="transcript-panel"]').first().waitFor({ timeout: 120_000 });
      }
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
        // After the download the cloud route's device path may start writing by itself.
        await page.locator('[data-testid="transcribe-start"], [data-testid="model-failed"], [data-testid="transcript-panel"], [data-testid="transcribe-failed"], [data-testid="transcribe-running"]').first().waitFor({ timeout: 60 * 60_000 });
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
        if (attempt === 1 && (await page.getByTestId('transcribe-start').count()) === 0) row.startedByItself = true;
        else await page.getByTestId('transcribe-start').click();
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
    real: true,
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
  // ---------------------------------------------------------------- generated stand-ins for R11 (19 Oct)
  {
    id: 'kes-portrait',
    task: 'kes',
    label: 'Kes',
    source: 'm01-portrait (generated, 720×1280 H.264, 20 s), 2–8 s',
    async run(page, row) {
      await putFile(page, '[data-testid="video-input"]', SOURCES.portrait);
      const openedAt = Date.now();
      await page.getByTestId('preview-video').waitFor({ timeout: 120_000 });
      row.openS = seconds(Date.now() - openedAt);
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
      ownSize720x1280: video(row)?.width === 720 && video(row)?.height === 1280,
      plays: plays(row),
    }),
  },
  {
    id: 'dikey-portrait',
    task: 'dikey',
    label: 'Dikey yap',
    source: 'm01-portrait (generated, 720×1280, already 9:16)',
    async run(page, row) {
      await putFile(page, '[data-testid="video-input"]', SOURCES.portrait);
      await page.locator('[data-testid="dikey-choice"], [data-testid="dikey-already"]').first().waitFor({ timeout: 120_000 });
      row.said = (await text(page.getByTestId('dikey-already'))) ?? (await text(page.getByTestId('dikey-size')));
      return download(page, row);
    },
    checks: (row) => ({
      already916: /zaten dikey/.test(row.said ?? ''),
      size720x1280: video(row)?.width === 720 && video(row)?.height === 1280,
      duration20s: near(row.file.durationS, 20, 0.15),
      plays: plays(row),
    }),
  },
  {
    id: 'kucult-noisy',
    task: 'kucult',
    label: 'Küçült',
    source: 'noisy-720p30-14s (generated noise, 1280×720, 14 s, 24.7 MB)',
    async run(page, row) {
      await putFile(page, '[data-testid="video-input"]', SOURCES.noisy);
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
      duration14s: near(row.file.durationS, 14, 0.15),
      h264aac: video(row)?.codec === 'h264' && audio(row)?.codec === 'aac',
      plays: plays(row),
    }),
  },
  {
    id: 'cevir-hlg',
    task: 'cevir',
    label: 'Her yerde açılsın',
    source: 'm10-hdr-hlg-vp9-rot90 (generated, VP9 10-bit HLG, coded 1280×720 + 90°, 4 s)',
    async run(page, row) {
      await putFile(page, '[data-testid="video-input"]', SOURCES.hlg);
      await page.getByTestId('cevir-info').waitFor({ timeout: 120_000 });
      return download(page, row);
    },
    checks: (row) => ({
      h264aacMp4: video(row)?.codec === 'h264' && audio(row)?.codec === 'aac' && /mp4/.test(row.file.format ?? ''),
      upright720x1280: video(row)?.width === 720 && video(row)?.height === 1280,
      duration4s: near(row.file.durationS, 4, 0.1),
      plays: plays(row),
    }),
  },
  // ---------------------------------------------------------------- GIF yap (ADR-046)
  {
    id: 'gif',
    task: 'gif',
    label: 'GIF yap',
    source: 'sample-24s (generated test card, 1280×720, 24 s); top text, default part, Küçük',
    async run(page, row) {
      await putFile(page, '[data-testid="video-input"]', SOURCES.sample);
      const openedAt = Date.now();
      const estimate = page.locator('[data-testid="gif-estimate"][data-state="ready"]');
      await estimate.waitFor({ timeout: 120_000 });
      row.readyS = seconds(Date.now() - openedAt);
      const range = page.getByTestId('gif-range-window');
      row.part = { startUs: Number(await attr(range, 'data-start-us')), endUs: Number(await attr(range, 'data-end-us')) };
      row.smallDefault = await page.getByTestId('gif-size-small').isChecked();
      // A newcomer types the top line.
      await page.getByLabel('Üst yazı').pressSequentially('PAZARTESİ SABAHI ığüşöç', { delay: 20 });
      await page.evaluate(() => document.activeElement?.blur());
      await page.waitForTimeout(500);
      await estimate.waitFor({ timeout: 60_000 });
      row.estimate = { text: await text(estimate), bytes: Number(await attr(estimate, 'data-bytes')), frames: Number(await attr(estimate, 'data-frames')), width: Number(await attr(estimate, 'data-width')) };
      const saved = await download(page, row, { gif: true });
      if (!saved) return null;
      row.resultTitle = await text(page.getByTestId('wizard-title'));
      // The same part once more without text: the reference for the text band (not part of time-to-result).
      const plainAt = Date.now();
      await page.getByTestId('wizard-again-same').click();
      await page.getByLabel('Üst yazı').fill('');
      await page.evaluate(() => document.activeElement?.blur());
      await page.waitForTimeout(500);
      await estimate.waitFor({ timeout: 60_000 });
      row.plain = {};
      const plain = await download(page, row, { gif: true, into: row.plain, suffix: '-plain' });
      row.excludedMs = Date.now() - plainAt;
      if (plain) {
        const a = firstFrameRgb(plain);
        const b = firstFrameRgb(saved);
        const w = row.gif.width;
        const h = row.gif.height;
        row.bands = { top: bandDiff(a, b, w, 0, Math.round(h / 4)), middle: bandDiff(a, b, w, Math.round(h * 0.39), Math.round(h * 0.61)) };
        let white = 0;
        let black = 0;
        for (let i = 0; i < Math.round(h / 4) * w * 3; i += 3) {
          // Pixels the text changed: near-white letters and a near-black edge (the phone's palette gives
          // black as 0,1,0, not 0,0,0 as the desktop e2e sees it).
          const changed = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 60;
          if (!changed) continue;
          if (b[i] >= 247 && b[i + 1] >= 247 && b[i + 2] >= 247) white += 1;
          if (b[i] <= 8 && b[i + 1] <= 8 && b[i + 2] <= 8) black += 1;
        }
        row.bands.whitePixels = white;
        row.bands.blackPixels = black;
      }
      return saved;
    },
    checks: (row) => ({
      gif89a: row.gif?.ok === true && row.gif.header === 'GIF89a',
      part0to4s: row.part?.startUs === 0 && row.part?.endUs === 4_000_000,
      smallDefault: row.smallDefault === true,
      size320x180: row.gif?.width === 320 && row.gif?.height === 180,
      frames50: row.gif?.frames === 50 && row.ffprobe?.frames === 50,
      loopsForever: row.gif?.loops === 0,
      length4s: row.gif?.durationCs === 400,
      plainSameShape: row.plain?.gif?.frames === 50 && row.plain?.gif?.width === 320,
      textInTopBand: (row.bands?.top ?? 0) > 8 && (row.bands?.whitePixels ?? 0) > 200 && (row.bands?.blackPixels ?? 0) > 200,
      middleUntouched: (row.bands?.middle ?? 99) < 2,
      estimateWithinQuarter: row.estimate?.bytes > 0 && row.file.sizeBytes / row.estimate.bytes > 0.75 && row.file.sizeBytes / row.estimate.bytes < 1.33,
      decodesOnPhone: !row.shown?.error && row.shown?.size?.[0] === 320,
    }),
  },
  // ---------------------------------------------------------------- Sesi düzelt (ADR-049)
  ...[
    { id: 'duzelt-quiet', source: SOURCES.quiet, said: 'kisik-konusma (generated: synthetic voice, about −38 LUFS)', uneven: false },
    { id: 'duzelt-uneven', source: SOURCES.uneven, said: 'dengesiz-konusma (generated: one line 22 dB quieter)', uneven: true },
    { id: 'duzelt-sync', source: SOURCES.sync, said: 'sync-clip (scripts/lib/av-sync.mjs, 1080×1920, 12 s)', uneven: false, sync: true },
  ].map((item) => ({
    id: item.id,
    task: 'duzelt',
    label: 'Sesi düzelt',
    source: item.said,
    async run(page, row) {
      await putFile(page, '[data-testid="video-input"]', item.source);
      const openedAt = Date.now();
      await page.locator('[data-testid="duzelt-summary"], [data-testid="duzelt-problem"], [data-testid="wizard-blocked"]').first().waitFor({ timeout: 300_000 });
      row.measureS = seconds(Date.now() - openedAt);
      const summary = page.getByTestId('duzelt-summary');
      row.screen = {
        beforeLufs: Number(await attr(summary, 'data-before-lufs')),
        afterLufs: Number(await attr(summary, 'data-after-lufs')),
        change: await textIfThere(page.getByTestId('duzelt-change')),
        body: await textIfThere(page.getByTestId('duzelt-body')),
        already: await textIfThere(page.getByTestId('duzelt-already')),
        unevenShown: (await page.getByTestId('duzelt-uneven').count()) > 0,
        title: await text(page.getByTestId('wizard-title')),
      };
      const saved = await download(page, row);
      if (!saved) return null;
      row.soundFixLine = await text(page.getByTestId('export-sound-fix'));
      row.loudness = { source: loudness(item.source.file), saved: loudness(saved) };
      row.lengths = { source: durations(item.source.file), saved: durations(saved) };
      row.pictures = samePictures(saved, item.source.file);
      if (item.sync) row.sync = { source: avSync(item.source.file), saved: avSync(saved) };
      return saved;
    },
    checks: (row) => {
      const frame = 1 / 30 + 0.001;
      const out = row.loudness?.saved ?? {};
      const p = row.pictures ?? {};
      const l = row.lengths ?? {};
      return {
        lufs16pm1: Math.abs(out.integratedLufs + 16) <= 1,
        truePeakUnderMinus1: out.truePeakDbtp <= -1,
        pageMeterAgreesWithFfmpeg: Math.abs(row.screen.beforeLufs - row.loudness.source.integratedLufs) <= 0.5,
        ...(item.uneven ? { evened: out.lraLu < row.loudness.source.lraLu - 8, unevenSaid: row.screen.unevenShown } : {}),
        copied: row.method === 'copy',
        packetsEqualButFirst: Boolean(p.samePacketCount && p.restEqual && p.firstEndsWithSource && p.firstStartsSpsPps),
        decodedEqual: p.decodedEqual === true,
        videoLengthSame: Math.abs((l.saved?.video ?? 0) - (l.source?.video ?? 0)) <= frame,
        audioWithVideo: Math.abs((l.saved?.audio ?? 0) - (l.saved?.video ?? 0)) <= frame,
        h264aac: video(row)?.codec === 'h264' && audio(row)?.codec === 'aac' && row.file.streams.length === 2,
        ...(item.sync
          ? {
              syncPairs: row.sync.saved.paired === row.sync.source.paired && row.sync.saved.paired > 10,
              syncMedian1ms: Math.abs((row.sync.saved.medianMs ?? 99) - (row.sync.source.medianMs ?? 0)) <= 1,
              syncMax: Math.abs(row.sync.saved.maxMs ?? 99) <= Math.abs(row.sync.source.maxMs ?? 0) + 1,
            }
          : {}),
        plays: plays(row),
      };
    },
  })),
  // ---------------------------------------------------------------- English (ADR-048)
  {
    id: 'english-gif',
    task: 'gif',
    label: 'Make a GIF',
    source: 'other-8s (generated, 640×360, 8 s); ?lang=en, Make a GIF, then the language button back',
    async open(page, row) {
      // The one key this case changes (clip.language) is read first, on a file of the site that runs no app code.
      await page.goto(`${site}icon.svg`, { waitUntil: 'load', timeout: 60_000 });
      row.languageBefore = await page.evaluate(() => {
        try {
          return { value: localStorage.getItem('clip.language') };
        } catch {
          return { unreadable: true };
        }
      });
      const loadAt = Date.now();
      await page.goto(`${site}?lang=en`, { waitUntil: 'load' });
      await page.locator('html[lang="en"][data-clip-alive]').waitFor({ state: 'attached', timeout: 60_000 });
      await page.getByTestId('home-title').waitFor({ timeout: 30_000 });
      row.homeAliveMs = Date.now() - loadAt;
      row.home = await englishCheck(page);
      const link = page.getByTestId('task-grid').getByRole('link', { name: /^Make a GIF/ });
      row.cardName = await text(link);
      await link.click();
      await page.waitForURL(/\/en\/yap\/gif\/?$/, { timeout: 30_000 });
      await page.getByTestId('wizard').waitFor({ timeout: 30_000 });
      row.cardStepTitle = await text(page.getByTestId('wizard-title'));
    },
    async run(page, row) {
      {
        await putFile(page, '[data-testid="video-input"]', SOURCES.other);
        const estimate = page.locator('[data-testid="gif-estimate"][data-state="ready"]');
        await estimate.waitFor({ timeout: 120_000 });
        row.estimate = { text: await text(estimate), bytes: Number(await attr(estimate, 'data-bytes')) };
        row.chooseScreen = await englishCheck(page);
        const saved = await download(page, row, { gif: true });
        if (!saved) return null;
        row.resultTitle = await text(page.getByTestId('wizard-title'));
        row.resultScreen = await englishCheck(page);
        // Back to the start screen; its language button goes to Turkish.
        await page.goto(`${site}en/`, { waitUntil: 'load' });
        await page.locator('html[data-clip-alive]').waitFor({ state: 'attached', timeout: 60_000 });
        const button = page.getByTestId('language-switch');
        row.languageButton = { text: await text(button), href: await attr(button, 'href') };
        await button.click();
        await page.waitForURL((url) => !/\/en\/?$/.test(url.pathname), { timeout: 30_000 });
        await page.locator('html[lang="tr"][data-clip-alive]').waitFor({ state: 'attached', timeout: 60_000 });
        row.afterSwitch = {
          path: new URL(page.url()).pathname,
          lang: await page.locator('html').getAttribute('lang'),
          homeTitle: await text(page.getByTestId('home-title')),
          stored: await page.evaluate(() => localStorage.getItem('clip.language')),
        };
        return saved;
      }
    },
    /** Always, also after a failure: clip.language back as it was before this case (an installed app of the site shares it). */
    async after(page, row) {
      if (!row.languageBefore || row.languageBefore.unreadable) return;
      if (!page.url().startsWith(site)) await page.goto(`${site}icon.svg`, { waitUntil: 'load', timeout: 60_000 }).catch(() => undefined);
      row.languageRestored = await page
        .evaluate((value) => {
          if (value === null) localStorage.removeItem('clip.language');
          else localStorage.setItem('clip.language', value);
          return localStorage.getItem('clip.language') === value;
        }, row.languageBefore.value)
        .catch((error) => `failed: ${String(error.message).split('\n')[0]}`);
      // The verdict was made before the restore: add it now.
      if (row.checks) {
        row.checks.languageRestored = row.languageRestored === true;
        row.ok = Object.values(row.checks).every(Boolean);
      }
    },
    checks: (row) => ({
      homeEnglish: row.home?.lang === 'en' && row.home?.title === 'What do you want to do?' && row.home?.turkishWords.length === 0,
      homeAddress: /\/en\/?$/.test(row.home?.path ?? ''),
      chooseEnglish: row.chooseScreen?.turkishWords.length === 0,
      resultEnglish: row.resultTitle === 'Saved' && row.resultScreen?.turkishWords.length === 0 && /^Saved:/.test(row.savedText ?? ''),
      gif: row.gif?.ok === true && row.gif.width === 320 && row.gif.height === 180 && row.gif.loops === 0 && row.ffprobe?.frames === row.gif.frames,
      wholeVideo8s: row.gif?.durationCs === 800,
      backToTurkish: row.afterSwitch?.lang === 'tr' && row.afterSwitch?.homeTitle === 'Ne yapmak istiyorsun?' && !/\/en\//.test(`${row.afterSwitch?.path}/`),
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
  const watch = { pageErrors: [], consoleErrors: [], recoveredLines: [], crashed: false, badResponses: [] };
  // Which address a "Failed to load resource" line is about (the console line does not say).
  page.on('response', (response) => {
    if (response.status() >= 400) watch.badResponses.push(`${response.status()} ${response.url().replace(site, '/')}`.slice(0, 200));
  });
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
        if (last) result.cleanup = await cleanup(page);
        await page.close().catch(() => undefined);
        result.rows.push(row);
        save();
        console.log(JSON.stringify(row));
      }
    }
  } else {
    // What the site keeps on the phone before this run (names and counts only), and the browser's languages.
    {
      await waitInFront();
      const { page } = await freshTab();
      await page.goto(`${site}icon.svg`, { waitUntil: 'load', timeout: 60_000 }).catch(() => undefined);
      result.siteBefore = await siteState(page);
      result.languages = await page.evaluate(() => navigator.languages).catch(() => null);
      await page.close().catch(() => undefined);
      save();
    }
    for (const card of CARDS) {
      if (only.length > 0 ? !only.includes(card.id) : card.real && !useReal) continue;
      ensurePorts();
      await waitInFront();
      const { page, watch } = await freshTab();
      await installSavePicker(page);
      const row = { id: card.id, task: card.task, source: card.source };
      const startedAt = Date.now();
      transferMs = 0;
      try {
        if (card.open) await card.open(page, row);
        else await openCard(page, row, card);
        const saved = await card.run(page, row);
        // From loading the opening screen to the saved file, without the USB transfer of the source.
        row.transferS = seconds(transferMs);
        // Up to the first saved file (a second, reference download and the measuring here are left out).
        row.resultS = seconds((row.savedAtMs ?? Date.now()) - startedAt - transferMs);
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
      if (card.after && !watch.crashed) await card.after(page, row).catch((error) => (row.afterError = String(error.message ?? error).split('\n')[0]));
      Object.assign(row, { pageErrors: watch.pageErrors, consoleErrors: watch.consoleErrors, badResponses: watch.badResponses, crashed: watch.crashed });
      row.cleanup = watch.crashed ? 'tab crashed' : await cleanup(page);
      await page.close().catch(() => undefined);
      result.rows.push(row);
      save();
      console.log(JSON.stringify(row));
    }
  }
} finally {
  // A crashed or failed tab can leave storage behind: one more fresh tab of ours cleans the origin
  // (with --keep-site-data: only the files this script saved).
  // It opens the site's icon, not a page: no app code runs there, so no service worker is registered again.
  try {
    const { page } = await freshTab();
    await page.goto(`${site}icon.svg`, { waitUntil: 'load', timeout: 60_000 }).catch(() => undefined);
    result.finalCleanup = await cleanup(page);
    result.siteAfter = await siteState(page);
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
