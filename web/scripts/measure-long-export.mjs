/**
 * Measures what a long export actually costs, so the 5 minute policy limit is
 * backed by a number instead of an assumption.
 *
 * The output is held in memory (BufferTarget + fastStart), so the interesting
 * figures are peak JS heap and wall time as the output grows. Heap readings
 * come from Chromium's `performance.memory`, which is a rough but real signal;
 * on other browsers this reports "ölçülemedi" rather than guessing.
 *
 * Usage (server on :3100):
 *   node scripts/measure-long-export.mjs
 *   node scripts/measure-long-export.mjs --seconds=30,60,120 --browser=chrome
 */
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

import { ffprobeJson } from './lib/media-measure.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const mediaDir = join(root, 'tests', 'media', 'matrix');
const outDir = join(root, 'matrix-results');
const baseURL = process.env.SHOT_URL ?? 'http://127.0.0.1:3100';

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const found = args.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};
const durations = argValue('seconds', '15,30,60,120').split(',').map(Number);
const channel = argValue('browser', '');

mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch(channel ? { channel } : {});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  acceptDownloads: true,
});

const rows = [];

for (const seconds of durations) {
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto(`${baseURL}/editor`);
  await page.getByTestId('video-input').setInputFiles(join(mediaDir, 'm01-portrait-20s.mp4'));
  await page.getByTestId('preview-video').waitFor({ timeout: 60_000 });

  // The source is 20 s, so long outputs are built by reusing ranges. That is a
  // legitimate edit (doc 10 allows repeated source ranges) and it keeps the
  // fixture small while making the OUTPUT long.
  const perMoment = 10;
  const moments = Math.max(1, Math.round(seconds / perMoment));
  for (let i = 0; i < moments; i += 1) {
    const from = i % 2 === 0 ? 0 : 10;
    await page.getByTestId('range-start').fill(from.toFixed(3));
    await page.getByTestId('range-end').fill((from + perMoment).toFixed(3));
    await page.getByTestId('add-moment').click();
  }

  await page.getByTestId('open-export').click();
  await page.getByTestId('export-quality').selectOption('720');
  await page.getByTestId('export-ready').waitFor({ timeout: 90_000 });

  const readHeap = () =>
    page.evaluate(() => {
      const memory = performance.memory;
      return memory ? memory.usedJSHeapSize : null;
    });

  const heapBefore = await readHeap();
  const startedAt = Date.now();
  await page.getByTestId('export-create').click();

  let peakHeap = heapBefore ?? 0;
  let finished = false;
  while (Date.now() - startedAt < 600_000) {
    if ((await page.getByTestId('export-succeeded').count()) > 0) {
      finished = true;
      break;
    }
    if ((await page.getByTestId('export-failed').count()) > 0) break;
    const heap = await readHeap();
    if (heap !== null) peakHeap = Math.max(peakHeap, heap);
    await page.waitForTimeout(250);
  }

  const elapsedMs = Date.now() - startedAt;
  let row = {
    requestedSeconds: moments * perMoment,
    finished,
    elapsedMs,
    heapBeforeMb: heapBefore === null ? null : Number((heapBefore / 1048576).toFixed(1)),
    peakHeapMb: heapBefore === null ? null : Number((peakHeap / 1048576).toFixed(1)),
  };

  if (finished) {
    const artefact = join(outDir, `long-${row.requestedSeconds}s.mp4`);
    const download = page.waitForEvent('download', { timeout: 120_000 });
    await page.getByTestId('export-download').click();
    await (await download).saveAs(artefact);

    const probe = ffprobeJson(artefact);
    const video = probe?.streams.find((s) => s.codec_type === 'video');
    row = {
      ...row,
      measuredSeconds: probe ? Number(Number(probe.format.duration).toFixed(3)) : null,
      frames: video ? Number(video.nb_frames) : null,
      sizeMb: Number((statSync(artefact).size / 1048576).toFixed(1)),
    };
  } else {
    const failure = await page.getByTestId('export-failed').textContent().catch(() => null);
    row.failure = failure ? failure.replace(/\s+/g, ' ').trim() : 'zaman aşımı';
  }

  row.pageErrors = pageErrors;
  rows.push(row);
  await page.close();

  console.log(
    `${String(row.requestedSeconds).padStart(4)} s -> ` +
      `${row.finished ? 'OK ' : 'FAIL'} ` +
      `ölçülen ${row.measuredSeconds ?? '—'} s, ${row.frames ?? '—'} kare, ${row.sizeMb ?? '—'} MB, ` +
      `${(row.elapsedMs / 1000).toFixed(1)} s sürdü, ` +
      `tepe heap ${row.peakHeapMb ?? 'ölçülemedi'} MB` +
      (row.failure ? ` — ${row.failure}` : ''),
  );
}

await context.close();
await browser.close();

const report = {
  browser: channel || 'chromium',
  ranAt: new Date().toISOString(),
  note:
    'Çıktı bellekte tutuluyor (BufferTarget + fastStart in-memory). ' +
    'UYARI: Chromium performance.memory değeri gizlilik için kabaca yuvarlanır; ' +
    'bütün koşularda aynı değeri verdiği için bu ölçümden bellek tavanı çıkarılamaz. ' +
    'Ayrıca fixture sentetik bir test deseni olduğu için encoder hedef bitrate’in çok ' +
    'altında kalıyor; gerçek kamera görüntüsünde dosya boyutu ve dolayısıyla bellek ' +
    'kullanımı belirgin şekilde yüksek olur.',
  rows,
};
writeFileSync(join(outDir, 'long-export.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(`\nyazıldı: ${join(outDir, 'long-export.json')}`);
