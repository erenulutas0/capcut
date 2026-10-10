import { expect, test, type Browser } from '@playwright/test';

import { installSavePicker } from '../e2e/kesitFlow';
import { waitForResult } from './lib/app';
import { cameraLikeSource } from './lib/media';
import { BUILD, median, round, writeResult } from './lib/record';

/**
 * Section 7 — performance budgets.
 *
 * Load: the opening screen, a wizard and the editor, opened cold (a fresh
 * browser context, cache off) from the static export served with gzip like
 * GitHub Pages. Bytes are what really crossed the wire (the DevTools
 * protocol's encoded length), timings come from PerformanceObserver in the
 * page — the method of scripts/measure-load.mjs (docs/perf/2026-09-30-load.md),
 * so the numbers can be read next to those.
 *
 * Two profiles: this machine as it is, and Lighthouse's "mobile" throttling
 * (150 ms round trip, 1.6 Mbit/s down, CPU four times slower). The second is
 * an emulation on a desktop CPU, not a phone.
 *
 * Memory: the main thread's JavaScript heap, sampled over the protocol while
 * a 12-second 1080p video is turned vertical. The export's workers have
 * their own heaps and are NOT in this number (scripts/measure-export-memory.mjs
 * measures the whole process tree; it is not re-run here).
 *
 * Export speed is taken in output.spec.ts, where the files are made.
 */

test.use({ storageState: { cookies: [], origins: [] } });
test.skip(BUILD !== 'static', 'runs against the static export');

const PAGES = [
  { id: 'ana-ekran', path: '/' },
  { id: 'sihirbaz', path: '/yap/dikey/' },
  { id: 'editor', path: '/editor/' },
];

const PROFILES = {
  masaustu: { cpu: 1, network: null as null | Record<string, number>, viewport: { width: 1350, height: 940 } },
  'mobil-kisitli': {
    cpu: 4,
    network: { latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 },
    viewport: { width: 412, height: 823 },
  },
};

const RUNS = 3;

const CUT_SHORT = 'ölçüm betiği yarıda kaldı (zaman aşımı ya da hata); ayrıntı koşu günlüğünde';

interface LoadSample {
  fcp: number;
  lcp: number;
  dcl: number;
  load: number;
  tbt: number;
  longTasks: number;
  jsTransferred: number;
  jsRaw: number;
  jsFiles: number;
  cssTransferred: number;
  htmlTransferred: number;
  fontTransferred: number;
  totalTransferred: number;
  outsideRequests: number;
  heapAfterLoad: number;
}

async function measure(browser: Browser, baseURL: string, path: string, profile: (typeof PROFILES)[keyof typeof PROFILES]): Promise<LoadSample> {
  // serviceWorkers: 'block' — the first visit is what is measured; the worker's background downloads are not the page's load.
  const context = await browser.newContext({ viewport: profile.viewport, serviceWorkers: 'block' });
  const page = await context.newPage();
  let outside = 0;
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith(baseURL) || url.startsWith('blob:') || url.startsWith('data:')) return route.continue();
    outside += 1;
    return route.abort();
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  if (profile.network) await cdp.send('Network.emulateNetworkConditions', { offline: false, ...profile.network } as never);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpu });

  const types = new Map<string, string>();
  const transferred: Record<string, number> = {};
  const files: Record<string, number> = {};
  cdp.on('Network.responseReceived', (event) => types.set(event.requestId, event.type));
  cdp.on('Network.loadingFinished', (event) => {
    const type = types.get(event.requestId) ?? 'Other';
    transferred[type] = (transferred[type] ?? 0) + event.encodedDataLength;
    files[type] = (files[type] ?? 0) + 1;
  });
  let jsRaw = 0;
  page.on('response', async (response) => {
    if (response.request().resourceType() !== 'script') return;
    try {
      jsRaw += (await response.body()).length;
    } catch {
      // no body (a redirect)
    }
  });

  await page.addInitScript(() => {
    const w = window as unknown as { __longTasks: number[][]; __lcp: number };
    w.__longTasks = [];
    w.__lcp = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) w.__longTasks.push([entry.startTime, entry.duration]);
    }).observe({ type: 'longtask', buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) w.__lcp = entry.startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  });

  await page.goto(`${baseURL}${path}`, { waitUntil: 'load' });
  // Long tasks after load still count against the blocking time: a 5 s quiet window, as in measure-load.mjs.
  await page.waitForTimeout(5500);
  const timing = await page.evaluate(() => {
    const w = window as unknown as { __longTasks: number[][]; __lcp: number };
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? 0;
    let tbt = 0;
    for (const [start = 0, duration = 0] of w.__longTasks) if (start >= fcp) tbt += Math.max(0, duration - 50);
    return {
      fcp: Math.round(fcp),
      lcp: Math.round(w.__lcp),
      dcl: Math.round(nav.domContentLoadedEventEnd),
      load: Math.round(nav.loadEventEnd),
      tbt: Math.round(tbt),
      longTasks: w.__longTasks.length,
    };
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await cdp.send('HeapProfiler.collectGarbage');
  const heap = await cdp.send('Runtime.getHeapUsage');
  await context.close();
  return {
    ...timing,
    jsTransferred: Math.round(transferred.Script ?? 0),
    jsRaw,
    jsFiles: files.Script ?? 0,
    cssTransferred: Math.round(transferred.Stylesheet ?? 0),
    htmlTransferred: Math.round(transferred.Document ?? 0),
    fontTransferred: Math.round(transferred.Font ?? 0),
    totalTransferred: Math.round(Object.values(transferred).reduce((sum, value) => sum + value, 0)),
    outsideRequests: outside,
    heapAfterLoad: Math.round(heap.usedSize),
  };
}

for (const target of PAGES) {
  test(`perf: load — ${target.id}`, async ({ browser, baseURL }, testInfo) => {
    writeResult('perf', `${testInfo.project.name}.load-${target.id}`, { kind: 'load', id: target.id, path: target.path, measured: false, reason: CUT_SHORT });
    const rows: Record<string, unknown> = {};
    for (const [name, profile] of Object.entries(PROFILES)) {
      const samples: LoadSample[] = [];
      for (let i = 0; i < RUNS; i += 1) samples.push(await measure(browser, baseURL ?? '', target.path, profile));
      const keys = Object.keys(samples[0] ?? {}) as Array<keyof LoadSample>;
      rows[name] = {
        median: Object.fromEntries(keys.map((key) => [key, median(samples.map((sample) => sample[key]))])),
        runs: samples.map((sample) => ({ lcp: sample.lcp, tbt: sample.tbt, load: sample.load })),
      };
    }
    writeResult('perf', `${testInfo.project.name}.load-${target.id}`, { kind: 'load', id: target.id, path: target.path, measured: true, runs: RUNS, profiles: rows });
  });
}

test('perf: main-thread heap while a video is exported', async ({ page, context }, testInfo) => {
  await installSavePicker(page);
  const cdp = await context.newCDPSession(page);
  const used = async () => (await cdp.send('Runtime.getHeapUsage')).usedSize;
  await page.goto('/yap/dikey/');
  await cdp.send('HeapProfiler.collectGarbage');
  const idle = await used();
  await page.getByTestId('video-input').setInputFiles(cameraLikeSource());
  await expect(page.getByTestId('dikey-choice')).toBeVisible({ timeout: 120_000 });
  const beforeExport = await used();
  let peak = beforeExport;
  let samples = 0;
  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      const now = await used().catch(() => 0);
      if (now > peak) peak = now;
      samples += 1;
      await new Promise((done) => setTimeout(done, 100));
    }
  })();
  const pressed = Date.now();
  await page.getByTestId('wizard-download').click();
  const phase = await waitForResult(page);
  const exportS = (Date.now() - pressed) / 1000;
  sampling = false;
  await sampler;
  await cdp.send('HeapProfiler.collectGarbage');
  const afterExport = await used();
  writeResult('perf', `${testInfo.project.name}.heap-export`, {
    kind: 'heap',
    phase,
    exportS: round(exportS, 2),
    samples,
    idleBytes: Math.round(idle),
    beforeExportBytes: Math.round(beforeExport),
    peakBytes: Math.round(peak),
    afterExportBytes: Math.round(afterExport),
  });
});
