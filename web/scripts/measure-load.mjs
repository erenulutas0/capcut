/**
 * Load cost of the published pages, measured locally (docs/perf/*-load.md).
 *
 * Opens each page in a fresh browser context (cold cache) against the static
 * export served by scripts/serve-static.mjs, and reports:
 *   - every JS / CSS / font / document response: raw bytes and gzip bytes
 *     (GitHub Pages serves gzip; the local server does not compress, so the
 *     gzip figure is computed here from the same body);
 *   - which JS chunks carry mediabunny (doc 11: the landing page must not);
 *   - FCP, LCP, DOMContentLoaded, load, total blocking time and a TTI
 *     estimate (end of the last long task before a 5 s quiet window), with
 *     and without Lighthouse's "mobile" throttling (150 ms RTT, 1.6 Mbps
 *     down, 4x CPU) applied over the DevTools protocol.
 *
 * Nothing leaves the machine: the page is served from 127.0.0.1 and any
 * request to another origin is aborted and counted.
 *
 *   node scripts/serve-static.mjs --dir=out --base=/capcut --port=3104 &
 *   node scripts/measure-load.mjs --base=http://127.0.0.1:3104/capcut [--browser=chrome] [--runs=3] [--json=file]
 */
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { chromium } from '@playwright/test';

const arg = (name, fallback) => {
  const found = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};

const base = arg('base', 'http://127.0.0.1:3104/capcut').replace(/\/+$/, '');
const browserName = arg('browser', 'chromium');
const runs = Number(arg('runs', '3'));
const jsonOut = arg('json', '');
const PAGES = arg('pages', '/,/editor/').split(',');

/** Lighthouse's default mobile throttling (simulated there, applied here). */
const PROFILES = {
  desktop: { cpu: 1, network: null, viewport: { width: 1350, height: 940 } },
  mobile: {
    cpu: 4,
    network: { latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 },
    viewport: { width: 412, height: 823 },
  },
};

/** Strings that survive minification in mediabunny's bundle (its MP4 box names). */
const MEDIABUNNY_MARKERS = ['"moov"', 'unsupported or unrecognizable format'];

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null;
};

async function measure(browser, path, profileName) {
  const profile = PROFILES[profileName];
  const context = await browser.newContext({ viewport: profile.viewport });
  const page = await context.newPage();
  const outside = [];
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith('http://127.0.0.1:') || url.startsWith('blob:') || url.startsWith('data:')) return route.continue();
    outside.push(url);
    return route.abort();
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  if (profile.network) {
    await cdp.send('Network.emulateNetworkConditions', { offline: false, ...profile.network });
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpu });

  const resources = [];
  page.on('response', async (response) => {
    const type = response.request().resourceType();
    if (!['script', 'stylesheet', 'font', 'document', 'image'].includes(type)) return;
    try {
      const body = await response.body();
      const text = type === 'script' ? body.toString('utf8') : '';
      resources.push({
        type,
        url: response.url().replace(base, ''),
        raw: body.length,
        gzip: gzipSync(body).length,
        mediabunny: type === 'script' && MEDIABUNNY_MARKERS.some((m) => text.includes(m)),
      });
    } catch {
      // Redirects have no body.
    }
  });

  await page.addInitScript(() => {
    const w = window;
    w.__longTasks = [];
    w.__lcp = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__longTasks.push([e.startTime, e.duration]);
    }).observe({ type: 'longtask', buffered: true });
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__lcp = e.startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  });

  await page.goto(`${base}${path}`, { waitUntil: 'load' });
  // TTI needs a 5 s quiet window after the last long task.
  await page.waitForTimeout(6000);
  const timing = await page.evaluate(() => {
    const w = window;
    const nav = performance.getEntriesByType('navigation')[0];
    const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? 0;
    const tasks = w.__longTasks;
    let tti = Math.max(fcp, nav.domContentLoadedEventEnd);
    let tbt = 0;
    for (const [start, duration] of tasks) {
      if (start + duration > tti && start >= fcp - 1) tti = Math.max(tti, start + duration);
    }
    for (const [start, duration] of tasks) {
      if (start >= fcp && start + duration <= tti + 1) tbt += Math.max(0, duration - 50);
    }
    return {
      fcp: Math.round(fcp),
      lcp: Math.round(w.__lcp),
      dcl: Math.round(nav.domContentLoadedEventEnd),
      load: Math.round(nav.loadEventEnd),
      tti: Math.round(tti),
      tbt: Math.round(tbt),
      longTasks: tasks.length,
    };
  });
  await context.close();
  return { timing, resources, outside };
}

function summarize(resources) {
  const sum = (type, key) => resources.filter((r) => r.type === type).reduce((a, r) => a + r[key], 0);
  return {
    js: { files: resources.filter((r) => r.type === 'script').length, raw: sum('script', 'raw'), gzip: sum('script', 'gzip') },
    css: { files: resources.filter((r) => r.type === 'stylesheet').length, raw: sum('stylesheet', 'raw'), gzip: sum('stylesheet', 'gzip') },
    html: { raw: sum('document', 'raw'), gzip: sum('document', 'gzip') },
    font: { files: resources.filter((r) => r.type === 'font').length, raw: sum('font', 'raw') },
    mediabunnyChunks: resources.filter((r) => r.mediabunny).map((r) => r.url),
    largest: resources
      .filter((r) => r.type === 'script')
      .sort((a, b) => b.raw - a.raw)
      .slice(0, 6)
      .map((r) => `${r.url} ${r.raw} B (${r.gzip} B gz)${r.mediabunny ? ' [mediabunny]' : ''}`),
  };
}

const browser = await chromium.launch(browserName === 'chromium' ? {} : { channel: browserName === 'edge' ? 'msedge' : browserName });
const report = { base, browser: `${browserName} ${browser.version()}`, runs, at: new Date().toISOString(), pages: {} };
try {
  for (const path of PAGES) {
    report.pages[path] = {};
    for (const profileName of Object.keys(PROFILES)) {
      const samples = [];
      let last = null;
      for (let i = 0; i < runs; i += 1) {
        last = await measure(browser, path, profileName);
        samples.push(last.timing);
      }
      const keys = Object.keys(samples[0]);
      const med = Object.fromEntries(keys.map((k) => [k, median(samples.map((s) => s[k]))]));
      report.pages[path][profileName] = { median: med, bytes: summarize(last.resources), outside: last.outside };
      console.log(`${path} ${profileName}:`, JSON.stringify(med));
    }
    console.log(`${path} bytes:`, JSON.stringify(report.pages[path].desktop.bytes, null, 2));
  }
} finally {
  await browser.close();
}
if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify(report, null, 2)}\n`);
