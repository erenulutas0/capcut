/**
 * W2 matrix runner.
 *
 * Drives the real editor through each doc 22 case in a chosen browser, exports,
 * saves the produced file and measures it with ffprobe/ffmpeg. Writes a
 * machine-readable result file per browser.
 *
 * Usage (server must be running on :3100):
 *   node scripts/run-matrix.mjs                        # bundled Chromium
 *   node scripts/run-matrix.mjs --browser=chrome
 *   node scripts/run-matrix.mjs --browser=firefox
 *   node scripts/run-matrix.mjs --case=M01,M07
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from '@playwright/test';

import { CASES } from './lib/matrix-cases.mjs';
import { createDriver } from './lib/matrix-driver.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const mediaDir = join(root, 'tests', 'media', 'matrix');
const outDir = join(root, 'matrix-results');
const baseURL = process.env.SHOT_URL ?? 'http://127.0.0.1:3100';

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const found = args.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};
const browserName = argValue('browser', 'chromium');
const caseFilter = argValue('case', '');
const selected = caseFilter ? caseFilter.split(',').map((s) => s.trim()) : null;

mkdirSync(outDir, { recursive: true });

const LAUNCHERS = {
  chromium: () => chromium.launch(),
  chrome: () => chromium.launch({ channel: 'chrome' }),
  edge: () => chromium.launch({ channel: 'msedge' }),
  firefox: () => firefox.launch(),
  webkit: () => webkit.launch(),
};

if (!LAUNCHERS[browserName]) {
  console.error(`unknown browser: ${browserName}. one of ${Object.keys(LAUNCHERS).join(', ')}`);
  process.exit(2);
}

const { drive, assess, waitForAny } = createDriver({ mediaDir, outDir, baseURL });

/* ------------------------------------------------------------------- main */

const cases = CASES.filter((c) => !selected || selected.includes(c.id));
const missing = cases
  .filter((c) => c.setup?.video)
  .filter((c) => !existsSync(join(mediaDir, c.setup.video)));
if (missing.length > 0) {
  console.error(
    `eksik fixture: ${missing.map((c) => c.setup.video).join(', ')}\n` +
      'önce: node scripts/generate-matrix-media.mjs',
  );
  process.exit(2);
}

const browser = await LAUNCHERS[browserName]();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  acceptDownloads: true,
});

// Record what the browser itself claims, independently of any case.
const probePage = await context.newPage();
await probePage.goto(`${baseURL}/editor`);
const browserCapability = await probePage.evaluate(async () => {
  const g = globalThis;
  const check = async (kind, config) => {
    try {
      const api = kind === 'video' ? g.VideoEncoder : g.AudioEncoder;
      if (typeof api !== 'function') return 'api-missing';
      return (await api.isConfigSupported(config)).supported === true;
    } catch (error) {
      return `error:${error.name}`;
    }
  };
  return {
    userAgent: navigator.userAgent,
    secureContext: isSecureContext,
    videoEncoder: typeof g.VideoEncoder,
    audioEncoder: typeof g.AudioEncoder,
    offscreenCanvas: typeof g.OffscreenCanvas,
    h264: await check('video', { codec: 'avc1.42001f', width: 1280, height: 720, framerate: 30, bitrate: 3e6 }),
    aac: await check('audio', { codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 128e3 }),
  };
});
await probePage.close();
console.log(`${browserName} capability: ${JSON.stringify(browserCapability)}\n`);

/**
 * Smoke test: can this browser open the baseline fixture at all?
 *
 * Playwright's WebKit build on Windows ships without proprietary codecs, so it
 * refuses every H.264 file. Running the matrix there would produce 16 red rows
 * that say nothing about our code. The run is marked not-testable instead, with
 * the reason recorded — that is a real finding, not a pass and not a failure.
 */
const smokePage = await context.newPage();
await smokePage.goto(`${baseURL}/editor`);
await smokePage.getByTestId('video-input').setInputFiles(join(mediaDir, 'm01-portrait-20s.mp4'));
const smokeOutcome = await waitForAny(smokePage, ['preview-video', 'media-error'], 60_000);
const smokeMessage =
  smokeOutcome === 'media-error'
    ? ((await smokePage.getByTestId('media-error').textContent().catch(() => '')) ?? '')
        .replace(/\s+/g, ' ')
        .trim()
    : '';
await smokePage.close();

const notTestable =
  smokeOutcome !== 'preview-video'
    ? `Bu tarayıcı temel H.264 fixture'ını açamıyor, dolayısıyla matris burada çalıştırılamaz. ` +
      `Uygulamanın mesajı: "${smokeMessage || 'görünmedi'}".`
    : null;

if (notTestable) console.log(`${browserName}: NOT_TESTABLE — ${notTestable}\n`);

const results = [];
let failures = 0;

for (const testCase of cases) {
  if (notTestable) {
    results.push({ id: testCase.id, title: testCase.title, status: 'NOT_RUN', reason: notTestable });
    continue;
  }
  if (testCase.notRun) {
    results.push({ id: testCase.id, title: testCase.title, status: 'NOT_RUN', reason: testCase.notRun });
    console.log(`NOT_RUN  ${testCase.id}  ${testCase.title}\n         ${testCase.notRun}`);
    continue;
  }

  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  const artefactPath = join(outDir, `${testCase.id}-${browserName}.mp4`);
  let record;
  try {
    const driveResult = await drive(page, testCase, artefactPath);
    const { checks, measured, unsupported } = assess(testCase, driveResult, artefactPath);
    checks.push({ label: 'sayfada JS hatası yok', ok: pageErrors.length === 0, detail: pageErrors.join(' | ') });

    const ok = checks.every((c) => c.ok);
    if (!ok) failures += 1;
    record = {
      id: testCase.id,
      title: testCase.title,
      expectation: testCase.expectation,
      status: ok ? (unsupported ? 'UNSUPPORTED' : 'PASS') : 'FAIL',
      gate: driveResult.gate ?? null,
      notes: driveResult.notes ?? [],
      measured,
      checks,
    };
  } catch (error) {
    failures += 1;
    record = {
      id: testCase.id,
      title: testCase.title,
      expectation: testCase.expectation,
      status: 'ERROR',
      error: String(error).split('\n')[0].slice(0, 300),
      checks: [],
    };
  } finally {
    await page.close();
  }

  results.push(record);
  console.log(`${record.status.padEnd(7)} ${record.id}  ${record.title}`);
  for (const check of record.checks ?? []) {
    console.log(`         ${check.ok ? 'ok  ' : 'FAIL'} ${check.label}${check.detail ? ` — ${check.detail}` : ''}`);
  }
  for (const note of record.notes ?? []) console.log(`         · ${note}`);
  if (record.error) console.log(`         ! ${record.error}`);
}

await context.close();
await browser.close();

const summary = {
  browser: browserName,
  ranAt: new Date().toISOString(),
  capability: browserCapability,
  notTestable,
  platform: `${process.platform} ${process.arch}`,
  totals: {
    pass: results.filter((r) => r.status === 'PASS').length,
    unsupported: results.filter((r) => r.status === 'UNSUPPORTED').length,
    fail: results.filter((r) => r.status === 'FAIL').length,
    error: results.filter((r) => r.status === 'ERROR').length,
    notRun: results.filter((r) => r.status === 'NOT_RUN').length,
  },
  results,
};
writeFileSync(join(outDir, `matrix-${browserName}.json`), `${JSON.stringify(summary, null, 2)}\n`);

console.log(
  `\n${browserName}: ${summary.totals.pass} PASS, ${summary.totals.unsupported} UNSUPPORTED, ` +
    `${summary.totals.fail} FAIL, ${summary.totals.error} ERROR, ${summary.totals.notRun} NOT_RUN`,
);
process.exit(failures === 0 ? 0 : 1);
