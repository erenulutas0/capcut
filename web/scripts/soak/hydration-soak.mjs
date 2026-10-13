// Opens pages many times in fresh browser contexts and reports every load that
// did not become interactive by itself (ADR-044).
//
// A load counts as interactive when React has taken the page over (the hidden
// file input of a wizard is rendered only after hydration; `/` enables its
// search box). Since ADR-044 a page that does not get there reloads itself once
// (src/pageWatchdog.ts), so a load can end in three ways, and all are counted:
//
//   clean      interactive on the first try
//   recovered  interactive after the page's one automatic reload  -> RECOVERED line
//   failed     not interactive within --wait (the notice, or nothing) -> FAIL line
//
// For a recovered or failed load the requests that failed or were still
// pending are printed: that is the evidence of what a recovery recovered from.
//
// Usage: node scripts/soak/hydration-soak.mjs --base=http://127.0.0.1:3193 --n=1000 --parallel=6
//        [--wait=60000] [--paths=/yap/cevir,/yap/yazi,/yap/kes,/editor,/] [--out=soak.json]
//        [--burn=10]   that many processes doing nothing but using a CPU core, for a loaded machine
//        [--serve=3193] start `next start` on that port for the run (and stop it afterwards) instead of --base
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const arg = (name, fallback) => {
  const hit = process.argv.find((entry) => entry.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const servePort = arg('serve', '');
const base = servePort ? `http://127.0.0.1:${servePort}` : arg('base', 'http://127.0.0.1:3193');
const total = Number(arg('n', '300'));
const parallel = Number(arg('parallel', '6'));
// Long enough for the slowest self-healing path: 15 s after load, the reload, and hydration.
const waitMs = Number(arg('wait', '60000'));
const paths = arg('paths', '/yap/cevir,/yap/yazi,/yap/kes,/editor,/').split(',');
const outFile = arg('out', '');
const selectors = { '/': '[data-testid="finder-input"]:not([disabled])', '/editor': '[data-testid="download-all"]' };
const RECOVERY_KEY = 'clip:page-recovery';
const RECOVERED_LOG = '[page-recovered]';

let server = null;
if (servePort) {
  server = spawn(process.execPath, [join('node_modules', 'next', 'dist', 'bin', 'next'), 'start', '-p', servePort], { stdio: 'ignore' });
  let up = false;
  for (let i = 0; i < 120 && !up; i += 1) {
    up = await fetch(base).then(
      (response) => response.ok,
      () => false,
    );
    if (!up) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!up) {
    server.kill();
    throw new Error(`next start did not come up on ${base}`);
  }
}
const burners = Array.from({ length: Number(arg('burn', '0')) }, () => spawn(process.execPath, ['-e', 'for(;;){}'], { stdio: 'ignore' }));
// Whatever ends this script, nothing it started stays behind.
process.on('exit', () => {
  for (const burner of burners) burner.kill();
  server?.kill();
});
const browser = await chromium.launch();
let next = 0;
const failures = [];
const recoveries = [];
const timings = [];
const oddities = new Map();
const note = (key) => oddities.set(key, (oddities.get(key) ?? 0) + 1);

async function one(index) {
  const path = paths[index % paths.length];
  const context = await browser.newContext();
  const page = await context.newPage();
  const pending = new Map();
  const failed = [];
  const consoleLines = [];
  let documents = 0;
  let recoveredLine = false;
  page.on('request', (request) => {
    pending.set(request, `${request.resourceType()} ${request.url().replace(base, '')}`);
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents += 1;
  });
  page.on('requestfinished', (request) => pending.delete(request));
  page.on('requestfailed', (request) => {
    pending.delete(request);
    failed.push(`${request.url().replace(base, '')} ${request.failure()?.errorText}`);
    note(`requestfailed ${request.resourceType()} ${request.failure()?.errorText}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) note(`status ${response.status()} ${response.request().resourceType()}`);
  });
  page.on('console', (message) => {
    if (message.text().startsWith(RECOVERED_LOG)) recoveredLine = true;
    if (message.type() === 'error' || message.type() === 'warning') consoleLines.push(`${message.type()}: ${message.text().slice(0, 200)}`);
  });
  page.on('pageerror', (error) => consoleLines.push(`pageerror: ${error.name}: ${error.message.slice(0, 200)}`));
  const started = Date.now();
  let gotoError = null;
  try {
    await page.goto(base + path, { timeout: 60000 });
  } catch (error) {
    gotoError = String(error).slice(0, 200);
  }
  const selector = selectors[path] ?? '[data-testid="video-input"]';
  let interactive = true;
  try {
    await page.waitForSelector(selector, { state: 'attached', timeout: waitMs });
  } catch {
    interactive = false;
  }
  const afterMs = Date.now() - started;
  const state = await page
    .evaluate((key) => {
      let flag = null;
      try {
        flag = JSON.parse(sessionStorage.getItem(key) ?? 'null');
      } catch {
        flag = 'unreadable';
      }
      return {
        readyState: document.readyState,
        flag,
        alive: document.documentElement.hasAttribute('data-clip-alive'),
        notice: document.getElementById('clip-page-dead')?.getAttribute('data-state') ?? null,
        controller: navigator.serviceWorker?.controller?.state ?? null,
        scripts: Array.from(document.scripts).filter((s) => s.src).length,
        resources: performance.getEntriesByType('resource').length,
        visible: document.visibilityState,
      };
    }, RECOVERY_KEY)
    .catch((error) => ({ evaluateFailed: String(error).slice(0, 120) }));
  const evidence = { index, path, gotoError, afterMs, documents, state, pending: [...pending.values()].slice(0, 12), failed: failed.slice(0, 8), console: consoleLines.slice(0, 8) };
  // Two independent signs of a recovery: the tab's own note and a second request for the document.
  const reloaded = documents > 1 || recoveredLine || Boolean(state.flag);
  if (!interactive) {
    failures.push(evidence);
    console.log('FAIL', JSON.stringify(evidence));
  } else if (reloaded) {
    recoveries.push(evidence);
    console.log('RECOVERED', JSON.stringify(evidence));
  } else {
    timings.push(afterMs);
  }
  if (state.notice && state.notice !== 'hidden') note(`notice ${state.notice}`);
  await context.close();
}

async function lane() {
  while (next < total) {
    const index = next;
    next += 1;
    await one(index);
  }
}
await Promise.all(Array.from({ length: parallel }, lane));
await browser.close();
for (const burner of burners) burner.kill();
server?.kill();
timings.sort((a, b) => a - b);
const summary = {
  total,
  clean: timings.length,
  recovered: recoveries.length,
  failures: failures.length,
  medianMs: timings[Math.floor(timings.length / 2)],
  p99Ms: timings[Math.floor(timings.length * 0.99)],
  maxMs: timings[timings.length - 1],
  recoveredMs: recoveries.map((entry) => entry.afterMs),
};
console.log('ODD', JSON.stringify([...oddities]));
console.log(JSON.stringify(summary));
if (outFile) writeFileSync(outFile, JSON.stringify({ summary, oddities: [...oddities], recoveries, failures }, null, 1));
process.exit(failures.length > 0 ? 1 : 0);
