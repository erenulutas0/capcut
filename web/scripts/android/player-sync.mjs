/**
 * What a browser's own <video> player does with an export's sound (ADR-032):
 * plays each file of a folder in a real `<video>` element and measures, per
 * white frame of the sync clip (scripts/lib/av-sync.mjs), when the player
 * shows it and when it plays the chirp that belongs to it.
 *
 *   node scripts/android/player-sync.mjs --files=<dir> [--desktop=chrome|msedge|chromium|firefox]
 *
 * Without --desktop it runs in the phone's Chrome (adb + CDP, as phone-run;
 * the files are served from this computer through `adb reverse`, never
 * uploaded anywhere). The page plays muted to the room: the element's sound
 * goes through Web Audio into a recorder whose output is silenced.
 *
 * Timing: the picture side is `requestVideoFrameCallback`'s
 * `expectedDisplayTime` of the first white frame; the sound side is the
 * chirp's first sample, put on the same clock with
 * `AudioContext.getOutputTimestamp()`. Both include the device's own
 * latencies, so the numbers are compared between files, not read alone: for
 * every file with an audio edit list the script also plays a copy whose
 * edit list says "start at 0" (`*.elst0.mp4`, the same bytes otherwise) —
 * the file a player that ignores edit lists would see. A player that honours
 * the edit list puts the two 2048/48000 s = 42.67 ms apart.
 */
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { chromium, firefox } from '@playwright/test';

import { soundEditList, withSoundMediaTime } from '../lib/av-sync.mjs';
import { ownTabsEndpoint } from './cdp-own-tabs.mjs';

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const filesDir = resolve(arg('files', '.'));
const desktop = arg('desktop', '');
const port = Number(arg('port', '3271'));
// Each playback has its own constant (how full the element's audio buffer is when it starts):
// files are played in turns, several times, and compared by the median of their runs.
const repeat = Number(arg('repeat', '3'));
const web = resolve(import.meta.dirname, '..', '..');
const outDir = join(web, 'matrix-results', 'player-sync');
mkdirSync(outDir, { recursive: true });

/** The served set: every .mp4 in the folder, plus an "edit list ignored" twin of each that has one. */
const served = join(outDir, 'served');
mkdirSync(served, { recursive: true });
const files = [];
for (const name of readdirSync(filesDir).filter((n) => n.endsWith('.mp4') && !n.endsWith('.elst0.mp4')).sort()) {
  copyFileSync(join(filesDir, name), join(served, name));
  files.push(name);
  const edit = soundEditList(readFileSync(join(served, name)));
  if (!edit || edit.mediaTime === 0) continue;
  const twin = withSoundMediaTime(readFileSync(join(served, name)), 0);
  const twinName = name.replace(/\.mp4$/, '.elst0.mp4');
  writeFileSync(join(served, twinName), twin);
  files.push(twinName);
}

const PAGE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>player sync</title><button id="go" style="font-size:40px;padding:40px">go</button><div id="host"></div>`;

const server = createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url, 'http://x').pathname);
  if (path === '/' || path === '/index.html') {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(PAGE);
    return;
  }
  const file = join(served, basename(path));
  if (!path.startsWith('/f/') || !files.includes(basename(path))) {
    response.writeHead(404).end();
    return;
  }
  const size = statSync(file).size;
  const range = /bytes=(\d+)-(\d*)/.exec(request.headers.range ?? '');
  const bytes = readFileSync(file);
  if (range) {
    const start = Number(range[1]);
    const end = range[2] ? Number(range[2]) : size - 1;
    response.writeHead(206, { 'content-type': 'video/mp4', 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
    response.end(bytes.subarray(start, end + 1));
  } else {
    response.writeHead(200, { 'content-type': 'video/mp4', 'accept-ranges': 'bytes', 'content-length': size });
    response.end(bytes);
  }
});
await new Promise((done) => server.listen(port, '127.0.0.1', done));

function adb(...args) {
  return spawnSync('adb', args, { encoding: 'utf8' });
}

let browser;
let context;
let page;
if (desktop) {
  const type = desktop === 'firefox' ? firefox : chromium;
  browser = await type.launch({ channel: ['chrome', 'msedge'].includes(desktop) ? desktop : undefined });
  context = await browser.newContext();
  page = await context.newPage();
} else {
  // Android freezes a browser that is not on screen; wait (30 min at most)
  // until the phone shows it again, never bring it there from here.
  for (let waited = 0; ; waited += 30) {
    adb('forward', 'tcp:9222', 'localabstract:chrome_devtools_remote');
    const top = adb('shell', 'dumpsys', 'activity', 'activities').stdout ?? '';
    if ((top.split('\n').find((l) => l.includes('topResumedActivity')) ?? '').includes('com.android.chrome')) break;
    if (waited >= 30 * 60) throw new Error('Chrome not in front for 30 minutes');
    if (waited % 300 === 0) console.error('Chrome is not on screen; waiting');
    await new Promise((done) => setTimeout(done, 30_000));
  }
  adb('reverse', `tcp:${port}`, `tcp:${port}`);
  browser = await chromium.connectOverCDP(await ownTabsEndpoint('http://127.0.0.1:9222'), { timeout: 180_000 });
  context = browser.contexts()[0];
  page = await context.newPage();
}

const results = [];
try {
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'load' });
  // A real tap: the sound may only start after one.
  await page.evaluate(() => {
    window.__go = new Promise((done) => document.getElementById('go').addEventListener('click', done, { once: true }));
  });
  await page.click('#go');
  await page.evaluate(async () => {
    await window.__go;
    const context = new AudioContext();
    await context.resume();
    const code = `class Onsets extends AudioWorkletProcessor {
      constructor() { super(); this.quiet = 0; }
      process(inputs) {
        const channel = inputs[0] && inputs[0][0];
        if (!channel) { this.quiet += 128; return true; }
        for (let i = 0; i < channel.length; i += 1) {
          if (Math.abs(channel[i]) >= 0.05) {
            if (this.quiet >= sampleRate * 0.1) this.port.postMessage(currentFrame + i);
            this.quiet = 0;
          } else this.quiet += 1;
        }
        return true;
      }
    }
    registerProcessor('onsets', Onsets);`;
    await context.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: 'application/javascript' })));
    window.__audio = context;
  });

  for (let round = 1; round <= repeat; round += 1) for (const name of files) {
    const row = await page.evaluate(async (src) => {
      const context = window.__audio;
      const video = document.createElement('video');
      video.playsInline = true;
      video.preload = 'auto';
      video.src = src;
      video.style.width = '120px';
      document.getElementById('host').replaceChildren(video);
      const source = context.createMediaElementSource(video);
      const recorder = new AudioWorkletNode(context, 'onsets');
      const silent = context.createGain();
      silent.gain.value = 0;
      source.connect(recorder).connect(silent).connect(context.destination);
      const onsetFrames = [];
      recorder.port.onmessage = (event) => onsetFrames.push(event.data);
      const clocks = [];
      const clockTimer = setInterval(() => {
        const stamp = context.getOutputTimestamp();
        if (stamp.contextTime > 0) clocks.push(stamp);
      }, 20);
      const canvas = new OffscreenCanvas(8, 8);
      const draw = canvas.getContext('2d', { willReadFrequently: true });
      const flashes = [];
      let wasWhite = false;
      let frames = 0;
      const onFrame = (_now, meta) => {
        draw.drawImage(video, 0, 0, 8, 8);
        const pixels = draw.getImageData(0, 0, 8, 8).data;
        let sum = 0;
        for (let i = 0; i < pixels.length; i += 4) sum += pixels[i];
        const white = sum / 64 > 128;
        if (white && !wasWhite) flashes.push({ shownAt: meta.expectedDisplayTime, mediaTime: meta.mediaTime });
        wasWhite = white;
        frames += 1;
        if (!video.ended) video.requestVideoFrameCallback(onFrame);
      };
      // A player that cannot open or finish the file is reported, not waited for.
      const limit = (promise, what) =>
        Promise.race([promise, new Promise((_, fail) => setTimeout(() => fail(new Error(`timeout: ${what}`)), 40_000))]);
      await limit(
        new Promise((done, fail) => {
          if (video.readyState >= 4) done();
          video.addEventListener('canplaythrough', done, { once: true });
          video.addEventListener('error', () => fail(new Error(`media error ${video.error?.code}`)), { once: true });
        }),
        'canplaythrough',
      );
      if (!('requestVideoFrameCallback' in video)) throw new Error('no requestVideoFrameCallback');
      video.requestVideoFrameCallback(onFrame);
      await limit(video.play(), 'play');
      await limit(new Promise((done) => video.addEventListener('ended', done, { once: true })), 'ended');
      await new Promise((done) => setTimeout(done, 300));
      clearInterval(clockTimer);
      source.disconnect();
      recorder.disconnect();
      // A chirp's first sample, on the performance clock: from the clock
      // reading taken closest to it.
      const heard = onsetFrames.map((frame) => {
        const at = frame / context.sampleRate;
        let best = clocks[0];
        for (const stamp of clocks) if (Math.abs(stamp.contextTime - at) < Math.abs(best.contextTime - at)) best = stamp;
        return best.performanceTime + (at - best.contextTime) * 1000;
      });
      const offsets = [];
      for (const flash of flashes) {
        let nearest = null;
        for (const t of heard) if (nearest === null || Math.abs(t - flash.shownAt) < Math.abs(nearest - flash.shownAt)) nearest = t;
        if (nearest !== null && Math.abs(nearest - flash.shownAt) < 150) offsets.push(nearest - flash.shownAt);
      }
      offsets.sort((a, b) => a - b);
      return {
        frames,
        flashes: flashes.length,
        onsets: heard.length,
        paired: offsets.length,
        medianMs: offsets.length ? Number(offsets[Math.floor(offsets.length / 2)].toFixed(2)) : null,
        minMs: offsets.length ? Number(offsets[0].toFixed(2)) : null,
        maxMs: offsets.length ? Number(offsets[offsets.length - 1].toFixed(2)) : null,
        outputLatencyMs: Number(((context.outputLatency ?? 0) * 1000).toFixed(1)),
      };
    }, `/f/${encodeURIComponent(name)}`).catch((error) => ({ error: String(error.message ?? error).split('\n')[0] }));
    results.push({ file: name, round, ...row });
    console.log(JSON.stringify({ file: name, round, ...row }));
  }
} finally {
  await page.evaluate(() => window.__audio?.close()).catch(() => undefined);
  await page.close().catch(() => undefined);
  if (desktop) await browser.close();
  else adb('reverse', '--remove', `tcp:${port}`);
  server.close();
}

const ua = desktop || 'phone';
const summary = files.map((file) => {
  const runs = results.filter((r) => r.file === file && r.medianMs !== null && r.medianMs !== undefined).map((r) => r.medianMs).sort((a, b) => a - b);
  return { file, runs: runs.length, medianMs: runs.length ? runs[Math.floor(runs.length / 2)] : null, spreadMs: runs.length ? Number((runs[runs.length - 1] - runs[0]).toFixed(2)) : null };
});
for (const row of summary) console.log(JSON.stringify(row));
writeFileSync(join(outDir, `player-sync-${ua}-${Date.now()}.json`), JSON.stringify({ desktop: desktop || null, at: new Date().toISOString(), summary, results }, null, 2));
// Never close the phone's own browser: only disconnect.
process.exit(0);
