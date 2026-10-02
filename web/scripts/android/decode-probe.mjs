/**
 * Which source frame does each decoded `VideoFrame` really show, and when
 * does that stop being true? (ADR-033: stale frames at kesit ends on a real
 * Android phone.)
 *
 * Decodes the sync clip (`scripts/lib/av-sync.mjs`: every frame carries its
 * own number as a barcode) in a worker of the browser, the way the export
 * does or in a variant, and reads the barcode of every frame from an
 * OffscreenCanvas it was drawn into. The worker's `VideoDecoder` is wrapped
 * so the log also says when frames came out of the decoder and when
 * `flush()` / `close()` were called, in the same order as the draws.
 *
 *   node scripts/android/decode-probe.mjs [--desktop=chrome|msedge|chromium] [--port=3272]
 *     [--clip=<sync clip>] [--only=<experiment ids>]
 *
 * Without --desktop it runs in the phone's Chrome (adb + CDP through
 * cdp-own-tabs.mjs; the page, mediabunny and the clip are served from this
 * computer through `adb reverse`, never uploaded anywhere). The page stores
 * nothing; the tab is closed at the end and the reverse mapping removed.
 */
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

import { ownTabsEndpoint } from './cdp-own-tabs.mjs';

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const web = resolve(import.meta.dirname, '..', '..');
const desktop = arg('desktop', '');
const port = Number(arg('port', '3272'));
const clip = resolve(arg('clip', join(web, 'tests', 'media', 'android', 'sync-clicks-1080x1920.mp4')));
const only = arg('only', '').split(',').filter(Boolean);
const outDir = join(web, 'matrix-results', 'decode-probe');
mkdirSync(outDir, { recursive: true });

/**
 * id, decoded range (source seconds, half-open like a kesit), how the frames
 * are pulled. `delayMs` stands for the encoder: the export draws a frame and
 * then waits for the encoder before it pulls the next one.
 */
const EXPERIMENTS = [
  { id: 'sink-fast-O', how: 'sink', from: 1.2, to: 6.5, delayMs: 0 },
  { id: 'sink-slow-O', how: 'sink', from: 1.2, to: 6.5, delayMs: 15 },
  { id: 'sink-slow-Q', how: 'sink', from: 0, to: 12, delayMs: 15 },
  // The candidate fix: mediabunny's decoder is closed only after the last frame was drawn.
  { id: 'sink-slow-O-defer', how: 'sink', from: 1.2, to: 6.5, delayMs: 15, defer: true },
  { id: 'sink-slow-Q-defer', how: 'sink', from: 0, to: 12, delayMs: 15, defer: true },
  // A 24 fps source on the 30 fps grid: some frames are drawn twice.
  { id: 'sink24-slow-O-defer', how: 'sink', clip: 24, sourceFps: 24, from: 1.2, to: 6.5, delayMs: 15, defer: true },
  { id: 'sink24-slow-Q-defer', how: 'sink', clip: 24, sourceFps: 24, from: 0, to: 12, delayMs: 15, defer: true },
  // Plain WebCodecs over the end of O's range (frames 180-194, more fed past it) and of the clip (Q).
  { id: 'raw-O-beforeFlush', how: 'raw', from: 6, to: 6.5, hold: 4, readAt: 'beforeFlush' },
  { id: 'raw-O-afterFlush', how: 'raw', from: 6, to: 6.5, hold: 4, readAt: 'afterFlush' },
  { id: 'raw-O-afterClose', how: 'raw', from: 6, to: 6.5, hold: 4, readAt: 'afterClose' },
  { id: 'raw-Q-afterFlush', how: 'raw', from: 11, to: 12, hold: 4, readAt: 'afterFlush' },
  { id: 'raw-Q-afterClose', how: 'raw', from: 11, to: 12, hold: 4, readAt: 'afterClose' },
];

const WORKER = String.raw`
import * as mb from '/mediabunny.mjs';

let log = [];
let seq = 0;
const note = (what, extra = {}) => log.push({ seq: seq++, what, ...extra });

// Every decoder the worker makes (mediabunny's too) reports its outputs,
// flushes and closes into the log.
const Original = self.VideoDecoder;
self.VideoDecoder = class extends Original {
  constructor(init) {
    super({ ...init, output: (frame) => { note('output', { ts: frame.timestamp }); init.output(frame); } });
  }
  flush() {
    note('flush');
    return super.flush().then((value) => { note('flushed'); return value; });
  }
  close() {
    note('close');
    return super.close();
  }
};

const canvas = new OffscreenCanvas(1080, 1920);
const context = canvas.getContext('2d', { willReadFrequently: true });

/** The frame number the barcode shows (12 white/black 64x48 blocks on the top edge). */
function barcode() {
  const strip = context.getImageData(0, 0, 768, 48).data;
  let number = 0;
  for (let bit = 0; bit < 12; bit += 1) if (strip[(24 * 768 + bit * 64 + 32) * 4] > 128) number += 2 ** bit;
  return number;
}

function drawFrame(frame) {
  context.fillStyle = '#808080';
  context.fillRect(0, 0, 1080, 1920);
  if (frame.draw) frame.draw(context, 0, 0, 1080, 1920);
  else context.drawImage(frame, 0, 0, 1080, 1920);
  return barcode();
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const FPS = 30;

/**
 * Keeps mediabunny's decoder open (its close deferred) until the returned
 * release is called: the candidate fix.
 */
function deferClose(sink) {
  const original = sink._createDecoder.bind(sink);
  let pending = null;
  let released = false;
  sink._createDecoder = async (...args) => {
    const wrapper = await original(...args);
    const close = wrapper.close.bind(wrapper);
    wrapper.close = () => {
      if (released) close();
      else pending = close;
    };
    return wrapper;
  };
  return () => {
    released = true;
    note('release');
    pending?.();
  };
}

async function sinkRun(blob, from, to, delayMs, defer, sourceFps) {
  const input = new mb.Input({ formats: mb.ALL_FORMATS, source: new mb.BlobSource(blob) });
  const track = await input.getPrimaryVideoTrack();
  const sink = new mb.VideoSampleSink(track);
  const release = defer ? deferClose(sink) : () => undefined;
  // The output grid (30 fps), as the export asks for it: first target to last + 1 ms.
  const targets = [];
  for (let k = 0; k < Math.round((to - from) * FPS); k += 1) targets.push(from + k / FPS);
  const lastTs = targets[targets.length - 1];
  // The export's picker, simplified: each target shows the newest frame that started by then.
  let current = null;
  let index = 0;
  const show = async (frame, target) => {
    if (delayMs) await sleep(delayMs);
    const shows = drawFrame(frame);
    note('draw', { ts: frame.timestamp, target, expected: Math.floor((target + 0.001) * sourceFps), shows });
  };
  try {
    for await (const sample of sink.samples(from, lastTs + 0.001)) {
      while (current && index < targets.length && targets[index] < sample.timestamp - 0.001) {
        await show(current, targets[index]);
        index += 1;
      }
      current?.close();
      current = sample;
      if (index >= targets.length) break;
    }
    while (current && index < targets.length) {
      await show(current, targets[index]);
      index += 1;
    }
  } finally {
    current?.close();
    release();
  }
}

/**
 * Plain WebCodecs, drawn as the frames come out except the newest \`hold\`,
 * which are kept undrawn through the end of the range: read before the
 * flush, after it, or only after the decoder is closed (one per run).
 */
async function rawRun(blob, from, to, hold, readAt) {
  const input = new mb.Input({ formats: mb.ALL_FORMATS, source: new mb.BlobSource(blob) });
  const track = await input.getPrimaryVideoTrack();
  const packets = new mb.EncodedPacketSink(track);
  const config = await track.getDecoderConfig();
  const held = [];
  const read = (what, frame) => note(what, { ts: frame.timestamp / 1e6, shows: drawFrame(frame) });
  const decoder = new VideoDecoder({
    output: (frame) => {
      held.push(frame);
      while (held.length > hold) {
        const oldest = held.shift();
        read('read-streaming', oldest);
        oldest.close();
      }
    },
    error: (e) => note('error', { message: String(e) }),
  });
  decoder.configure(config);
  const key = await packets.getKeyPacket(from);
  for await (const packet of packets.packets(key)) {
    // A little past the range, so the B-frames of its last group are fed too.
    if (packet.timestamp >= to + 0.2) break;
    decoder.decode(packet.toEncodedVideoChunk());
    // A decoder whose output buffers are all held stops taking input: noted, not waited for forever.
    for (let waited = 0; decoder.decodeQueueSize > 4; waited += 2) {
      if (waited > 3000) {
        note('stalled', { queue: decoder.decodeQueueSize, held: held.length });
        break;
      }
      await sleep(2);
    }
  }
  await sleep(300);
  if (readAt === 'beforeFlush') for (const frame of held) read('read-before-flush', frame);
  const flushed = await Promise.race([decoder.flush().then(() => true), sleep(10000).then(() => false)]);
  note('flush-result', { flushed, held: held.length });
  if (readAt === 'afterFlush') for (const frame of held) read('read-after-flush', frame);
  decoder.close();
  await sleep(300);
  if (readAt === 'afterClose') for (const frame of held) read('read-after-close', frame);
  for (const frame of held) frame.close();
}

self.onmessage = async ({ data }) => {
  log = [];
  seq = 0;
  try {
    const blob = await (await fetch(data.clip === 24 ? '/clip24.mp4' : '/clip.mp4')).blob();
    if (data.how === 'sink') await sinkRun(blob, data.from, data.to, data.delayMs, data.defer, data.sourceFps ?? FPS);
    else await rawRun(blob, data.from, data.to, data.hold, data.readAt);
    self.postMessage({ ok: true, log });
  } catch (error) {
    self.postMessage({ ok: false, error: String(error && error.stack || error), log });
  }
};
`;

const PAGE = `<!doctype html><meta charset="utf-8"><title>decode probe</title><p>decode probe</p>
<script>
window.runProbe = (experiment) => new Promise((done) => {
  const worker = new Worker('/probe-worker.mjs', { type: 'module' });
  worker.onmessage = ({ data }) => { worker.terminate(); done(data); };
  worker.onerror = (event) => { worker.terminate(); done({ ok: false, error: String(event.message) }); };
  worker.postMessage(experiment);
});
</script>`;

const mediabunny = readFileSync(join(web, 'node_modules', 'mediabunny', 'dist', 'bundles', 'mediabunny.mjs'));
const clipBytes = readFileSync(clip);
const clip24 = resolve(arg('clip24', join(web, 'tests', 'media', 'android', 'sync-clicks-24fps-1080x1920.mp4')));
const clip24Bytes = existsSync(clip24) ? readFileSync(clip24) : null;
const server = createServer((request, response) => {
  const path = new URL(request.url, 'http://x').pathname;
  const send = (type, body) => {
    response.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    response.end(body);
  };
  if (path === '/') send('text/html', PAGE);
  else if (path === '/probe-worker.mjs') send('text/javascript', WORKER);
  else if (path === '/mediabunny.mjs') send('text/javascript', mediabunny);
  else if (path === '/clip.mp4') send('video/mp4', clipBytes);
  else if (path === '/clip24.mp4' && clip24Bytes) send('video/mp4', clip24Bytes);
  else response.writeHead(404).end();
});
await new Promise((done) => server.listen(port, '127.0.0.1', done));

const adb = (...args) => spawnSync('adb', args, { encoding: 'utf8' });

let browser;
let page;
if (desktop) {
  browser = await chromium.launch({ channel: desktop === 'chromium' ? undefined : desktop });
  page = await (await browser.newContext()).newPage();
} else {
  adb('forward', 'tcp:9222', 'localabstract:chrome_devtools_remote');
  adb('reverse', `tcp:${port}`, `tcp:${port}`);
  browser = await chromium.connectOverCDP(await ownTabsEndpoint('http://127.0.0.1:9222'), { timeout: 180_000 });
  page = await browser.contexts()[0].newPage();
}

/** Per experiment: the draws whose barcode is not the frame's own number, and where they sit. */
function summarize(log) {
  const draws = log.filter((entry) => entry.what === 'draw');
  const firstFlush = log.find((entry) => entry.what === 'flush')?.seq ?? Infinity;
  const firstClose = log.find((entry) => entry.what === 'close')?.seq ?? Infinity;
  const wrong = draws.filter((d) => d.shows !== d.expected);
  const reads = {};
  for (const what of ['read-streaming', 'read-before-flush', 'read-after-flush', 'read-after-close']) {
    const rows = log.filter((entry) => entry.what === what);
    if (rows.length === 0) continue;
    const bad = rows.filter((r) => r.shows !== Math.round(r.ts * 30));
    reads[what] = { frames: rows.length, wrong: bad.length, firstWrong: bad.slice(0, 6).map((r) => [Math.round(r.ts * 30), r.shows]) };
  }
  return {
    draws: draws.length,
    wrong: wrong.length,
    wrongDrawnAfterFlush: wrong.filter((d) => d.seq > firstFlush).length,
    wrongDrawnAfterClose: wrong.filter((d) => d.seq > firstClose).length,
    drawnAfterFlush: draws.filter((d) => d.seq > firstFlush).length,
    drawnAfterClose: draws.filter((d) => d.seq > firstClose).length,
    firstWrong: wrong.slice(0, 12).map((d) => [d.expected, d.shows]),
    outputs: log.filter((entry) => entry.what === 'output').length,
    reads,
  };
}

const results = [];
try {
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'load' });
  for (const experiment of EXPERIMENTS) {
    if (only.length > 0 && !only.includes(experiment.id)) continue;
    const result = await page.evaluate((e) => window.runProbe(e), experiment);
    const row = { ...experiment, ok: result.ok, error: result.error, ...summarize(result.log ?? []) };
    console.log(JSON.stringify(row));
    results.push({ ...row, log: result.log });
  }
} finally {
  await page.close().catch(() => undefined);
  if (desktop) await browser.close();
  else adb('reverse', '--remove', `tcp:${port}`);
  server.close();
}
const ua = desktop || 'phone';
writeFileSync(join(outDir, `decode-probe-${ua}-${Date.now()}.json`), JSON.stringify({ desktop: desktop || null, at: new Date().toISOString(), results }, null, 2));
// Never close the phone's own browser: only disconnect.
process.exit(0);
