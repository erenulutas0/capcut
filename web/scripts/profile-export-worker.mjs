/**
 * A CPU profile of the export worker during one download (long-export soak,
 * docs/perf/2026-10-15-long-export.md): which functions the worker's own
 * thread spends its time in, by self time. The stage clock (ADR-028) says
 * which stage is slow; this says why.
 *
 * The browser is started with a debugging port; a plain CDP connection
 * attaches to the page and every worker it starts (flat sessions, the method
 * of `lib/cdp-heap.mjs`) and runs the V8 sampling profiler in the export
 * worker from the click until the download is saved. Measurement only;
 * nothing here is part of the app. Takes the measurement lock.
 *
 *   node scripts/profile-export-worker.mjs --source=<file> --task=ses --browser=chrome
 *   node scripts/profile-export-worker.mjs --source=<file> --task=kes --kesit=10.5,590.5
 *
 *   --task     editor | kes | ses | sustur | cevir (as in measure-long-export.mjs)
 *   --top      how many functions to list (default 30)
 *   --out      also write the .cpuprofile (DevTools "Performance" can load it)
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

import { addKesit, installSavePicker } from './lib/kesit-flow.mjs';
import { acquire, release } from './lib/measure-lock.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
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
const task = argValue('task', 'ses');
const channel = argValue('browser', '');
const kesit = argValue('kesit', '').split(',').map(Number).filter((n) => Number.isFinite(n));
const top = Number(argValue('top', '30'));
const outFile = argValue('out', '');
const port = Number(argValue('port', '9339'));

async function connect() {
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  const listeners = [];
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());
    if (message.id !== undefined) {
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(`${waiter.method}: ${message.error.message}`));
      else waiter.resolve(message.result);
      return;
    }
    for (const listener of listeners) listener(message);
  });
  const send = (method, params = {}, sessionId = undefined) =>
    new Promise((resolve, reject) => {
      const id = nextId;
      nextId += 1;
      pending.set(id, { resolve, reject, method });
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  return { send, listeners, close: () => socket.close() };
}

/** Self time per function (name + url:line), from a V8 CPU profile. */
function selfTimes(profile) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const dt = new Map();
  const { samples, timeDeltas } = profile;
  for (let i = 0; i < samples.length; i += 1) dt.set(samples[i], (dt.get(samples[i]) ?? 0) + (timeDeltas[i] ?? 0));
  const totals = new Map();
  let all = 0;
  for (const [id, us] of dt) {
    const node = byId.get(id);
    const f = node.callFrame;
    const url = f.url ? f.url.slice(f.url.lastIndexOf('/') + 1) : '';
    const key = `${f.functionName || '(anonymous)'} ${url}${url ? `:${f.lineNumber + 1}` : ''}`;
    totals.set(key, (totals.get(key) ?? 0) + us);
    all += us;
  }
  return { all, rows: [...totals.entries()].sort((a, b) => b[1] - a[1]) };
}

await acquire(`profile-export-worker ${task}`);
const profileDir = mkdtempSync(join(root, 'matrix-results', 'long-export', 'profiles', 'cpu-'));
let context = null;
let cdp = null;
try {
  mkdirSync(dirname(profileDir), { recursive: true });
  context = await chromium.launchPersistentContext(profileDir, {
    ...(channel ? { channel } : {}),
    viewport: { width: 1440, height: 900 },
    args: [`--remote-debugging-port=${port}`],
  });
  const page = await context.newPage();
  await installSavePicker(page);
  const url = task === 'editor' || task === 'kes' ? `${baseURL}/editor/` : `${baseURL}/yap/${task}/`;
  await page.goto(url, { waitUntil: 'load' });
  await page.locator('html[data-clip-alive]').waitFor({ state: 'attached', timeout: 60_000 });

  cdp = await connect();
  const { targetInfos } = await cdp.send('Target.getTargets');
  const pageTarget = targetInfos.find((t) => t.type === 'page' && t.url.startsWith(baseURL));
  const { sessionId: pageSession } = await cdp.send('Target.attachToTarget', { targetId: pageTarget.targetId, flatten: true });
  let exportSession = null;
  const profiling = new Promise((resolve) => {
    cdp.listeners.push((message) => {
      if (message.method !== 'Target.attachedToTarget' || message.params.targetInfo.type !== 'worker') return;
      const { sessionId, targetInfo } = message.params;
      const name = targetInfo.title || targetInfo.url;
      const start = async () => {
        if (name.startsWith('clip-export') && exportSession === null) {
          exportSession = sessionId;
          await cdp.send('Profiler.enable', {}, sessionId);
          await cdp.send('Profiler.setSamplingInterval', { interval: 200 }, sessionId);
          await cdp.send('Profiler.start', {}, sessionId);
          resolve(name);
        }
        await cdp.send('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => undefined);
      };
      start().catch(() => undefined);
    });
  });
  // Workers wait for the debugger, so the profiler is running before the worker's first line.
  await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, pageSession);

  await page.getByTestId('video-input').setInputFiles(source);
  let button = page.getByTestId('wizard-download');
  if (task === 'editor' || task === 'kes') {
    await page.getByTestId('preview-video').waitFor({ timeout: 180_000 });
    if (kesit.length === 2) {
      await addKesit(page, kesit[0].toFixed(3), kesit[1].toFixed(3));
      button = task === 'kes' ? page.getByTestId('kesit-download').first() : page.getByTestId('download-all');
    } else {
      button = page.getByTestId('download-all');
    }
  } else {
    await page.getByTestId(`${task}-info`).waitFor({ timeout: 10 * 60_000 });
  }
  await page.waitForTimeout(3000);
  const startedAt = Date.now();
  await button.first().click();
  const workerName = await Promise.race([profiling, new Promise((resolve) => setTimeout(() => resolve(null), 60_000))]);
  if (!workerName) throw new Error('the export worker never attached');
  await page
    .locator('[data-testid="download-saved"], [data-testid="export-succeeded"], [data-testid="export-failed"]')
    .first()
    .waitFor({ timeout: 60 * 60_000 });
  const elapsedS = (Date.now() - startedAt) / 1000;
  const { profile } = await cdp.send('Profiler.stop', {}, exportSession);
  if (outFile) writeFileSync(outFile, JSON.stringify(profile));
  const { all, rows } = selfTimes(profile);
  console.log(`${task} ${sourceArg} ${channel || 'chromium'}: ${elapsedS.toFixed(1)} s, worker ${workerName}, sampled ${(all / 1e6).toFixed(1)} s`);
  for (const [key, us] of rows.slice(0, top)) {
    console.log(`  ${(us / 1e6).toFixed(2).padStart(7)} s ${((us / all) * 100).toFixed(1).padStart(5)} %  ${key}`);
  }
} finally {
  cdp?.close();
  if (context) await context.close().catch(() => undefined);
  rmSync(profileDir, { recursive: true, force: true });
  release();
}
