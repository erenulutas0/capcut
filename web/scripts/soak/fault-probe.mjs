/**
 * What does the user see when one file of the app does not arrive? (ADR-044)
 *
 * Starts this build (`next start`) behind a small proxy that can break one
 * request in a chosen way, opens a page in a fresh browser context for every
 * (file, way of breaking) pair, and writes down what is on the screen: did
 * `load` fire, did React take over the page, is there any word about it.
 *
 * Ways of breaking (the proxy does them on the wire, as a network would):
 *   reset     the connection is closed without an answer
 *   hang      no answer, ever
 *   s500/s404 an error status with a small HTML body
 *   truncate  200, the first half of the file, a matching Content-Length
 *   cut       200, the full Content-Length, the connection closed half-way
 *   stall     200, half of the file, then silence
 *
 *   node scripts/soak/fault-probe.mjs --port=3193 --out=fault-probe.json [--groups=first,lazy,rsc,worker,sw]
 *
 * Needs a finished build (`CLIP_TEST_HOOKS=1 npm run build`).
 */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const arg = (name, fallback) => {
  const hit = process.argv.find((entry) => entry.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const port = Number(arg('port', '3193'));
const outFile = arg('out', 'fault-probe.json');
const groups = arg('groups', 'first,lazy,rsc,worker,sw').split(',');
const lanes = Number(arg('lanes', '4'));
const LOAD_MS = Number(arg('load', '12000'));
const ALIVE_MS = Number(arg('alive', '10000'));
/** After the verdict: how long to keep watching for the page's own recovery (0 = do not). */
const SETTLE_MS = Number(arg('settle', '0'));
const MODES = arg('modes', 'reset,hang,s500,s404,truncate,cut,stall').split(',');
const upstream = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------- server

const server = spawn(process.execPath, [join('node_modules', 'next', 'dist', 'bin', 'next'), 'start', '-p', String(port)], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stderr.on('data', (chunk) => process.stderr.write(`[next] ${chunk}`));
async function waitForServer() {
  for (let i = 0; i < 120; i += 1) {
    try {
      const response = await fetch(upstream);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  throw new Error('next start did not come up');
}

// ---------------------------------------------------------------- proxy

function makeProxy() {
  const state = { rules: [], held: new Set(), seen: [] };
  const proxy = http.createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    state.seen.push(req.url ?? '/');
    const rule = state.rules.find((entry) => entry.test(req.url ?? '/', path, req) && (entry.times === undefined || entry.times > 0));
    if (rule && rule.times !== undefined) rule.times -= 1;
    if (rule) rule.hits = (rule.hits ?? 0) + 1;
    const mode = rule?.mode ?? 'pass';
    if (mode === 'reset') {
      req.socket.destroy();
      return;
    }
    if (mode === 'hang') {
      state.held.add(req.socket);
      return;
    }
    if (mode === 's500' || mode === 's404') {
      const body = '<!doctype html><title>error</title><h1>error</h1>';
      res.writeHead(mode === 's500' ? 500 : 404, { 'content-type': 'text/html; charset=utf-8', 'content-length': Buffer.byteLength(body) });
      res.end(body);
      return;
    }
    const headers = { ...req.headers, host: `127.0.0.1:${port}` };
    if (mode !== 'pass') delete headers['accept-encoding'];
    const forward = http.request(upstream + req.url, { method: req.method, headers }, (answer) => {
      if (mode === 'pass') {
        res.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(res);
        return;
      }
      const parts = [];
      answer.on('data', (part) => parts.push(part));
      answer.on('end', () => {
        const whole = Buffer.concat(parts);
        const half = whole.subarray(0, Math.floor(whole.length / 2));
        const out = { ...answer.headers };
        delete out['transfer-encoding'];
        delete out['content-encoding'];
        out['content-length'] = String(mode === 'truncate' ? half.length : whole.length);
        res.writeHead(answer.statusCode ?? 502, out);
        if (mode === 'truncate') {
          res.end(half);
        } else if (mode === 'cut') {
          res.write(half, () => req.socket.destroy());
        } else {
          res.write(half);
          state.held.add(req.socket);
        }
      });
    });
    forward.on('error', () => req.socket.destroy());
    req.pipe(forward);
  });
  return new Promise((resolve) => {
    proxy.listen(0, '127.0.0.1', () => {
      const address = proxy.address();
      resolve({
        origin: `http://127.0.0.1:${address.port}`,
        state,
        reset() {
          state.rules = [];
          state.seen = [];
          for (const socket of state.held) socket.destroy();
          state.held.clear();
        },
        close() {
          for (const socket of state.held) socket.destroy();
          proxy.closeAllConnections?.();
          proxy.close();
        },
      });
    });
  });
}

// ---------------------------------------------------------------- observing

function watch(page, origin) {
  // `documents`: how often the tab asked for a page. 1 = it was never reloaded.
  const log = { console: [], pageErrors: [], failed: [], bad: [], documents: 0 };
  page.on('console', (message) => {
    if (message.type() === 'error') log.console.push(message.text().replaceAll(origin, '').slice(0, 160));
  });
  page.on('pageerror', (error) => log.pageErrors.push(`${error.name}: ${error.message}`.replaceAll(origin, '').slice(0, 160)));
  page.on('requestfailed', (request) => log.failed.push(`${request.url().replace(origin, '')} ${request.failure()?.errorText}`));
  page.on('response', (response) => {
    if (response.status() >= 400) log.bad.push(`${response.status()} ${response.url().replace(origin, '')}`);
  });
  page.on('request', (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) log.documents += 1;
  });
  return log;
}

const HYDRATED = { '/': '[data-testid="finder-input"]:not([disabled])', '/gizlilik': 'body' };
const hydratedSelector = (path) => HYDRATED[path] ?? (path.startsWith('/editor') ? '[data-testid="download-all"]' : '[data-testid="video-input"]');

async function screen(page) {
  return page
    .evaluate(() => {
      const text = (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim();
      const pick = document.querySelector('[data-testid="pick-video"]');
      const box = document.getElementById('clip-page-dead');
      const noticeState = box?.getAttribute('data-state') ?? null;
      const notice = noticeState && noticeState !== 'hidden' ? box.querySelector('[data-clip-lang]:not([hidden])') : null;
      const chunkNotice = document.querySelector('[data-clip-chunk-error]');
      return {
        readyState: document.readyState,
        heading: document.querySelector('h1')?.textContent ?? null,
        pickDisabled: pick ? pick.disabled : null,
        nextError: /Application error|This page couldn.t load|client-side exception/i.test(text),
        text: text.slice(0, 220),
        styled: getComputedStyle(document.body).backgroundColor,
        noticeState,
        alive: document.documentElement.getAttribute('data-clip-alive'),
        notice: notice ? (notice.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) : null,
        chunkNotice: chunkNotice ? (chunkNotice.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) : null,
        recovery: (() => {
          try {
            return sessionStorage.getItem('clip:page-recovery');
          } catch {
            return 'unreadable';
          }
        })(),
        controller: Boolean(navigator.serviceWorker?.controller),
      };
    })
    .catch((error) => ({ evaluateFailed: String(error).slice(0, 160) }));
}

/** Opens `path` and says what became of it. */
async function open(page, origin, path, log) {
  const started = Date.now();
  let loadFired = true;
  let gotoError = null;
  try {
    await page.goto(origin + path, { waitUntil: 'load', timeout: LOAD_MS });
  } catch (error) {
    loadFired = false;
    gotoError = String(error).split('\n')[0].replaceAll(origin, '').slice(0, 160);
  }
  const loadMs = Date.now() - started;
  let hydrated = true;
  try {
    await page.waitForSelector(hydratedSelector(path), { state: 'attached', timeout: ALIVE_MS });
  } catch {
    hydrated = false;
  }
  const hydratedMs = hydrated ? Date.now() - started : null;
  let settled = null;
  if (SETTLE_MS > 0 && !hydrated) {
    // Since ADR-044 the page may heal itself or say that it could not: wait for either.
    settled = await page
      .waitForFunction(
        (selector) => document.querySelector(selector) || !['hidden', null].includes(document.getElementById('clip-page-dead')?.getAttribute('data-state') ?? null),
        hydratedSelector(path),
        { timeout: SETTLE_MS },
      )
      .then(
        () => Date.now() - started,
        () => null,
      );
    await sleep(1500);
  }
  const healed = await page.$(hydratedSelector(path)).then(Boolean, () => false);
  return { loadFired, loadMs, gotoError, hydrated, hydratedMs, settledMs: settled, healed, ...(await screen(page)), ...log };
}

function sniff(path) {
  try {
    const text = readFileSync(join('.next', 'static', ...path.replace('/_next/static/', '').split('/')), 'utf8');
    const tags = [];
    if (path.endsWith('.css')) tags.push('css');
    if (/turbopack-[^/]+\.js$/.test(path)) tags.push('turbopack runtime');
    if (text.includes('hydrateRoot')) tags.push('react-dom/next client');
    if (text.includes('pick-video')) tags.push('wizard page code');
    if (text.includes('clip-sw:activate')) tags.push('layout: PwaClient');
    if (text.includes('finder-input')) tags.push('home page code');
    if (text.includes('download-all')) tags.push('editor code');
    if (text.includes('diag-download')) tags.push('ReportDialog');
    return `${Math.round(text.length / 1024)} KB${tags.length ? ` (${tags.join(', ')})` : ''}`;
  } catch {
    return '?';
  }
}

// ---------------------------------------------------------------- cases

const results = [];
const cases = [];
const add = (group, name, run) => cases.push({ group, name, run });

async function pageResources(browser, proxy, path) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  await page.goto(proxy.origin + path, { waitUntil: 'load' });
  await page.waitForSelector(hydratedSelector(path), { state: 'attached' });
  const inHtml = await page.evaluate(() => [
    ...Array.from(document.querySelectorAll('script[src]')).map((s) => ({ kind: s.noModule ? 'nomodule' : 'script', path: new URL(s.src).pathname })),
    ...Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map((l) => ({ kind: 'css', path: new URL(l.href).pathname })),
  ]);
  await context.close();
  return inHtml;
}

/** The requests an action makes that the page had not made before it. */
async function lateRequests(browser, proxy, path, prepare, action) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  const urls = [];
  let armed = false;
  page.on('request', (request) => {
    if (armed) urls.push(new URL(request.url()).pathname + new URL(request.url()).search);
  });
  await page.goto(proxy.origin + path, { waitUntil: 'load' });
  await page.waitForSelector(hydratedSelector(path), { state: 'attached' });
  await prepare(page);
  await sleep(1500);
  armed = true;
  await action(page);
  await sleep(2500);
  await context.close();
  return [...new Set(urls)].filter((url) => !url.startsWith('blob:'));
}

const VIDEO = join(process.cwd(), 'tests', 'media', 'other-8s.mp4');

async function main() {
  await waitForServer();
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const setup = await makeProxy();

  if (groups.includes('first')) {
    for (const path of arg('paths', '/yap/cevir,/yap/yazi').split(',')) {
      const resources = await pageResources(browser, setup, path);
      for (const resource of resources) {
        if (resource.kind === 'nomodule') continue;
        for (const mode of MODES) {
          add('first', `${path} ${resource.kind} ${resource.path.split('/').pop()} [${sniff(resource.path)}] ${mode}`, async (proxy) => {
            const context = await browser.newContext({ serviceWorkers: 'block' });
            const page = await context.newPage();
            const log = watch(page, proxy.origin);
            proxy.state.rules.push({ test: (_url, p) => p === resource.path, mode });
            const result = await open(page, proxy.origin, path, log);
            await context.close();
            return result;
          });
        }
      }
    }
  }

  if (groups.includes('rsc')) {
    for (const mode of MODES) {
      add('rsc', `home -> task card (client navigation), ?_rsc request ${mode}`, async (proxy) => {
        const context = await browser.newContext({ serviceWorkers: 'block' });
        const page = await context.newPage();
        const log = watch(page, proxy.origin);
        await page.goto(proxy.origin + '/', { waitUntil: 'load' });
        await page.waitForSelector(hydratedSelector('/'), { state: 'attached' });
        proxy.state.rules.push({ test: (url) => url.includes('_rsc='), mode });
        await page.getByTestId('task-cevir').click();
        let arrived = true;
        try {
          await page.waitForSelector('[data-testid="video-input"]', { state: 'attached', timeout: ALIVE_MS });
        } catch {
          arrived = false;
        }
        const result = { arrived, url: page.url().replace(proxy.origin, ''), ...(await screen(page)), ...log };
        await context.close();
        return result;
      });
    }
  }

  if (groups.includes('lazy')) {
    const lazy = [
      {
        label: 'editor from a wizard (/yap/dikey: Daha fazla ayar)',
        path: '/yap/dikey',
        prepare: async (page) => {
          await page.getByTestId('video-input').setInputFiles(VIDEO);
          await page.waitForSelector('[data-testid="dikey-choice"]', { timeout: 60000 });
        },
        action: async (page) => page.getByTestId('wizard-open-editor').click(),
        done: '[data-testid="preview-video"]',
      },
      {
        label: 'ReportDialog (editor: Daha fazla -> Yardım -> Sorun bildir)',
        path: '/editor',
        prepare: async (page) => {
          await page.getByTestId('open-more').click();
          await page.getByTestId('open-help').click();
        },
        action: async (page) => page.getByTestId('open-report').click(),
        done: '[data-testid="diag-preview"]',
      },
    ];
    for (const item of lazy) {
      const urls = await lateRequests(browser, setup, item.path, item.prepare, item.action).catch((error) => {
        console.log(`lazy discovery failed for ${item.label}: ${String(error).slice(0, 200)}`);
        return [];
      });
      const chunks = urls.filter((url) => url.startsWith('/_next/static/chunks/') && url.endsWith('.js'));
      console.log(`lazy: ${item.label}: ${chunks.join(' ')}`);
      for (const chunk of chunks) {
        for (const mode of MODES) {
          add('lazy', `${item.label} chunk ${chunk.split('/').pop()} [${sniff(chunk)}] ${mode}`, async (proxy) => {
            const context = await browser.newContext({ serviceWorkers: 'block' });
            const page = await context.newPage();
            const log = watch(page, proxy.origin);
            proxy.state.rules.push({ test: (_url, p) => p === chunk, mode });
            await page.goto(proxy.origin + item.path, { waitUntil: 'load' });
            await page.waitForSelector(hydratedSelector(item.path), { state: 'attached' });
            let prepared = true;
            try {
              await item.prepare(page);
              await item.action(page);
            } catch (error) {
              prepared = String(error).split('\n')[0].slice(0, 160);
            }
            let opened = true;
            try {
              await page.waitForSelector(item.done, { timeout: ALIVE_MS });
            } catch {
              opened = false;
            }
            const result = { prepared, opened, ...(await screen(page)), ...log };
            await context.close();
            return result;
          });
        }
      }
    }
  }

  if (groups.includes('worker')) {
    // The loudness worker of "Boşlukları at": its script and the chunks it imports.
    const urls = await lateRequests(browser, setup, '/yap/bosluk', async () => {}, async (page) => {
      await page.getByTestId('video-input').setInputFiles(VIDEO);
    }).catch(() => []);
    const scripts = urls.filter((url) => url.startsWith('/_next/static/') && url.split('#')[0].endsWith('.js'));
    console.log(`worker: ${scripts.join(' ')}`);
    for (const script of scripts) {
      for (const mode of MODES) {
        add('worker', `/yap/bosluk worker file ${script.split('/').pop()} [${sniff(script)}] ${mode}`, async (proxy) => {
          const context = await browser.newContext({ serviceWorkers: 'block' });
          const page = await context.newPage();
          const log = watch(page, proxy.origin);
          await page.goto(proxy.origin + '/yap/bosluk', { waitUntil: 'load' });
          await page.waitForSelector(hydratedSelector('/yap/bosluk'), { state: 'attached' });
          await sleep(1000);
          proxy.state.rules.push({ test: (_url, p) => p === script, mode });
          await page.getByTestId('video-input').setInputFiles(VIDEO);
          await sleep(ALIVE_MS);
          const result = { ...(await screen(page)), ...log };
          await context.close();
          return result;
        });
      }
    }
  }

  if (groups.includes('sw')) {
    const path = '/yap/cevir';
    const resources = await pageResources(browser, setup, path);
    const scripts = resources.filter((r) => r.kind === 'script').map((r) => r.path);
    const main = scripts.find((p) => sniff(p).includes('react-dom')) ?? scripts[0];
    /** A context whose pages are controlled by the installed service worker. */
    const controlled = async (proxy) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(proxy.origin + path, { waitUntil: 'load' });
      await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.ready;
        const worker = registration.active;
        if (worker && worker.state !== 'activated') {
          await new Promise((resolve) => worker.addEventListener('statechange', () => worker.state === 'activated' && resolve(null)));
        }
      });
      await page.reload({ waitUntil: 'load' });
      await page.waitForSelector(hydratedSelector(path), { state: 'attached' });
      if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) throw new Error('no controller');
      return { context, page };
    };
    const swCase = (name, arrange) =>
      add('sw', name, async (proxy) => {
        const { context, page } = await controlled(proxy);
        const log = watch(page, proxy.origin);
        await arrange(proxy, page);
        // The renderer's memory cache and the HTTP cache would hand the page (and the worker) the good
        // copy they still hold from a moment ago; a user who comes back tomorrow has neither.
        const cdp = await context.newCDPSession(page);
        await cdp.send('Network.clearBrowserCache');
        await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
        const result = await open(page, proxy.origin, path, log);
        await context.close();
        return result;
      });
    swCase('controlled load, network fine (baseline)', async () => {});
    swCase('controlled load, every request reset (offline, full cache)', async (proxy) => {
      proxy.state.rules.push({ test: () => true, mode: 'reset' });
    });
    swCase('controlled load, every request hangs (dead connection, full cache)', async (proxy) => {
      proxy.state.rules.push({ test: () => true, mode: 'hang' });
    });
    for (const mode of ['reset', 'hang', 's404']) {
      swCase(`controlled load, main chunk missing from the cache, its network request ${mode}`, async (proxy, page) => {
        await page.evaluate(async (target) => {
          for (const name of await caches.keys()) await (await caches.open(name)).delete(target);
        }, main);
        proxy.state.rules.push({ test: (_url, p) => p === main, mode });
      });
    }
    swCase('controlled load, main chunk in the cache is cut in half (broken stored copy), network fine', async (_proxy, page) => {
      await page.evaluate(async (target) => {
        for (const name of await caches.keys()) {
          const cache = await caches.open(name);
          const copy = await cache.match(target);
          if (!copy) continue;
          const text = await copy.text();
          await cache.put(target, new Response(text.slice(0, Math.floor(text.length / 2)), { headers: copy.headers }));
        }
      }, main);
    });
    swCase('controlled load, main chunk in the cache is an HTML page (a hotspot sign-in page stored as the file), network fine', async (_proxy, page) => {
      await page.evaluate(async (target) => {
        for (const name of await caches.keys()) {
          const cache = await caches.open(name);
          if (await cache.match(target)) await cache.put(target, new Response('<!doctype html><title>Sign in</title>', { headers: { 'content-type': 'text/html' } }));
        }
      }, main);
    });
    swCase('controlled load, the whole app cache deleted, every request reset (offline, nothing stored)', async (proxy, page) => {
      await page.evaluate(async () => {
        for (const name of await caches.keys()) await caches.delete(name);
      });
      proxy.state.rules.push({ test: () => true, mode: 'reset' });
    });
    add('sw', 'first visit, one file of the precache list cannot be fetched (install fails)', async (proxy) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      const log = watch(page, proxy.origin);
      // A build file this page does not use itself.
      proxy.state.rules.push({ test: (_url, p) => p.startsWith('/_next/static/chunks/') && !scripts.includes(p) && p.endsWith('.js'), mode: 'reset' });
      const result = await open(page, proxy.origin, path, log);
      await sleep(3000);
      result.registration = await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        return registration ? { active: Boolean(registration.active), installing: Boolean(registration.installing), waiting: Boolean(registration.waiting) } : null;
      });
      result.cacheNames = await page.evaluate(() => caches.keys());
      const second = await open(page, proxy.origin, path, watch(page, proxy.origin));
      result.secondLoad = { hydrated: second.hydrated, controller: second.controller };
      await context.close();
      return result;
    });
  }
  setup.close();

  console.log(`${cases.length} cases`);
  let next = 0;
  async function lane() {
    const proxy = await makeProxy();
    while (next < cases.length) {
      const item = cases[next];
      next += 1;
      proxy.reset();
      let result;
      try {
        result = await item.run(proxy);
      } catch (error) {
        result = { probeError: String(error).slice(0, 300) };
      }
      results.push({ group: item.group, name: item.name, ...result });
      const summary = result.probeError
        ? `PROBE-ERROR ${result.probeError}`
        : `load=${result.loadFired ?? '-'} alive=${result.hydrated ?? result.opened ?? result.arrived ?? '-'} healed=${result.healed ?? "-"} nextError=${result.nextError} pick=${result.pickDisabled} notice=${result.notice ? 'yes' : 'no'} chunkNotice=${result.chunkNotice ? 'yes' : 'no'} documents=${result.documents ?? '-'} console=${result.console?.length ?? 0} pageErrors=${result.pageErrors?.length ?? 0}`;
      console.log(`${item.group} | ${item.name} | ${summary}`);
    }
    proxy.close();
  }
  await Promise.all(Array.from({ length: lanes }, lane));
  await browser.close();
  writeFileSync(outFile, JSON.stringify(results, null, 1));
  console.log(`written ${outFile}`);
}

let failed = false;
try {
  await main();
} catch (error) {
  failed = true;
  console.error(error);
} finally {
  server.kill();
}
process.exit(failed ? 1 : 0);
