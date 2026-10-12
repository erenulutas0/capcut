import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { cpus } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { expect, test, type Browser } from '@playwright/test';

import { installSavePicker } from '../e2e/kesitFlow';
import { installTranscriptTest, serveModels, testModels } from '../e2e/transcriptKit';
import { LONG_SECONDS, SAMPLE, enterInvite, longSample, openChoice, realisticWords, startFake, type FakeWorker } from '../cloud/cloudKit';

/**
 * See playwright.soak.config.ts. One iteration: a fresh browser context, the
 * video, a transcript (written "on the internet" by the local fake, or by the
 * on-device stand-in), then "Altyazılı videoyu indir" once. A failure is not
 * retried: what the failure card and the diagnostics say is written to
 * `soak-results/burnin.jsonl`, and the iteration fails.
 */

const ITERATIONS = Number(process.env.SOAK_ITERATIONS ?? '20');
const PARALLEL = Math.max(1, Number(process.env.SOAK_PARALLEL ?? '1'));
const ROUTE = process.env.SOAK_ROUTE === 'device' ? 'device' : 'cloud';
const PLAY = process.env.SOAK_PLAY === '1';
const LOAD = Math.max(0, Number(process.env.SOAK_LOAD ?? '0'));
const LONG = process.env.SOAK_FILE !== 'short';
/** A file more like one from the internet: 1920×1080, 23,976 pictures a second, 44,1 kHz sound, the index at the end. */
const FILM = process.env.SOAK_FILE === 'film';
/** Seconds the finished transcript is left on screen before the press (someone reading it first). */
const IDLE_S = Math.max(0, Number(process.env.SOAK_IDLE ?? '0'));
/** The page is put behind another tab right after the press (someone who goes to do something else while it works). */
const HIDE = process.env.SOAK_HIDE === '1';
const RESULTS = join(process.cwd(), 'soak-results');

let fake: FakeWorker;
const burners: Worker[] = [];

test.beforeAll(async ({}, testInfo) => {
  mkdirSync(RESULTS, { recursive: true });
  fake = await startFake(testInfo.project.use.baseURL, { rateLimitPerHour: 100_000, monthlyCapUsd: 1000 });
  // Busy threads: the export competes for the processor the way it would on a loaded machine.
  for (let i = 0; i < Math.min(LOAD, cpus().length); i += 1) {
    burners.push(new Worker('for (;;) { let x = 0; for (let i = 0; i < 1e7; i += 1) x += Math.sqrt(i); }', { eval: true }));
  }
});
test.afterAll(async () => {
  await Promise.all(burners.map((burner) => burner.terminate()));
  await fake.close();
});

function filmSample(): string {
  const dir = join(process.cwd(), 'tests', 'media', 'cloud');
  const file = join(dir, `film-${LONG_SECONDS}s-1080p.mp4`);
  if (existsSync(file)) return file;
  mkdirSync(dir, { recursive: true });
  const partial = `${file}.part.mp4`;
  rmSync(partial, { force: true });
  execFileSync(
    'ffmpeg',
    [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', `testsrc2=size=1920x1080:rate=24000/1001:duration=${LONG_SECONDS}`,
      '-f', 'lavfi', '-i', `aevalsrc=0.25*sin(2*PI*180*t)*gt(sin(2*PI*0.35*t)\\,-0.4):s=44100:d=${LONG_SECONDS}`,
      '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '28', '-g', '250', '-bf', '3',
      '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-shortest',
      partial,
    ],
    { stdio: 'pipe' },
  );
  renameSync(partial, file);
  return file;
}

interface Outcome {
  ok: boolean;
  /** The failure card's sentence and its "Ayrıntılar" line, when it failed. */
  reason?: string;
  detail?: string;
  /** The newest row of the export log in the diagnostics file. */
  log?: unknown;
  method?: string;
  /** With SOAK_HIDE: what the page said about itself once another tab was in front. */
  visibility?: string;
  /** Whether this browser offers a hardware H.264 encoder / decoder for the sample's picture (asked of the browser). */
  hardware?: { encoder: boolean | null; decoder: boolean | null };
  seconds: number;
  consoleErrors: string[];
}

async function oneFlow(browser: Browser, baseURL: string | undefined, file: string, iteration: number, slot: number): Promise<Outcome> {
  const context = await browser.newContext({ baseURL, locale: 'tr-TR', viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 300));
  });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.name}`));
  const started = Date.now();
  try {
    await installSavePicker(page);
    if (ROUTE === 'device') {
      const models = testModels();
      await serveModels(context, models);
      // The stand-in "hears" a line every ten seconds over the whole video.
      const S = 1_000_000;
      const seconds = LONG ? LONG_SECONDS : 24;
      const segments = [];
      for (let at = 1; at + 4 < seconds; at += 10) {
        const text = `Line at second ${at} of the video.`.split(' ');
        segments.push({
          startUs: at * S,
          endUs: (at + 4) * S,
          state: 'ok',
          words: text.map((item, index) => ({ text: item, startUs: Math.round((at + 0.1 + index * 0.4) * S), endUs: Math.round((at + 0.1 + (index + 1) * 0.4 - 0.03) * S) })),
        });
      }
      await installTranscriptTest(page, models, { stepMs: 5, segments });
      await openChoice(page, file);
      await page.getByTestId('route-device-go').click();
      await page.getByTestId('model-download').click();
      await expect(page.getByTestId('transcribe-start')).toBeVisible({ timeout: 120_000 });
      await page.getByTestId('transcribe-start').click();
    } else {
      const invite = fake.newInvite(600);
      await openChoice(page, file);
      await enterInvite(page, invite);
      await page.getByTestId('route-online-go').click();
    }
    await expect(page.getByTestId('transcript-panel')).toBeVisible({ timeout: 300_000 });
    const hardware = await page.evaluate(async ({ width, height }) => {
      const ask = async (work: () => Promise<{ supported?: boolean }>) => {
        try {
          return (await work()).supported === true;
        } catch {
          return null;
        }
      };
      return {
        encoder: await ask(() => VideoEncoder.isConfigSupported({ codec: 'avc1.640028', width, height, bitrate: 4_000_000, framerate: 30, hardwareAcceleration: 'prefer-hardware' })),
        decoder: await ask(() => VideoDecoder.isConfigSupported({ codec: 'avc1.640028', codedWidth: width, codedHeight: height, hardwareAcceleration: 'prefer-hardware' })),
      };
    }, FILM ? { width: 1920, height: 1080 } : { width: 1280, height: 720 });

    if (IDLE_S > 0) await page.waitForTimeout(IDLE_S * 1000);
    if (PLAY) {
      await page.evaluate(() => {
        const video = document.querySelector('video');
        if (video) {
          video.muted = true;
          video.loop = true;
          void video.play();
        }
      });
    }
    await page.getByTestId('wizard-download').click();
    let visibility: string | undefined;
    if (HIDE) {
      const other = await context.newPage();
      await other.goto('about:blank');
      await other.bringToFront();
      await page.waitForTimeout(1000);
      visibility = await page.evaluate(() => document.visibilityState);
    }
    const saved = page.getByTestId('download-saved');
    const failed = page.getByTestId('export-failed');
    await expect(saved.or(failed)).toBeVisible({ timeout: 900_000 });
    if (HIDE) await page.bringToFront();
    const seconds = Math.round((Date.now() - started) / 1000);
    if (await saved.isVisible()) {
      await page.locator('.dl-details summary').first().click();
      const method = await page.getByTestId('measured-method').innerText();
      return { ok: true, method, hardware, visibility, seconds, consoleErrors };
    }
    const reason = await page.getByTestId('export-failed-reason').innerText();
    let detail = '(no detail)';
    if ((await page.getByTestId('export-failed-details').count()) > 0) {
      await page.locator('[data-testid="export-failed-details"] summary').click();
      detail = await page.getByTestId('export-failed-detail').innerText();
    }
    // The same thing as the diagnostics file holds it.
    await page.getByTestId('export-report').click();
    await expect(page.getByTestId('diag-preview')).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 }).catch(() => undefined);
    const preview = (await page.getByTestId('diag-preview').textContent({ timeout: 20_000 }).catch(() => '')) ?? '';
    let log: unknown = null;
    try {
      const report = JSON.parse(preview) as { exportLog?: unknown[] };
      log = report.exportLog?.at(-1) ?? null;
    } catch {
      log = null;
    }
    await page.screenshot({ path: join(RESULTS, `failed-${iteration}-${slot}.png`) }).catch(() => undefined);
    return { ok: false, reason, detail, log, hardware, visibility, seconds, consoleErrors };
  } finally {
    await context.close();
  }
}

for (let iteration = 1; iteration <= ITERATIONS; iteration += 1) {
  test(`burn-in after a ${ROUTE} transcript, fresh page #${iteration}`, async ({ browser }, testInfo) => {
    test.setTimeout(1_800_000);
    const file = FILM ? filmSample() : LONG ? longSample() : SAMPLE;
    fake.reset();
    fake.provider({ words: realisticWords(LONG ? LONG_SECONDS : 24), pollsUntilDone: 1, languageCode: 'en_us' });
    const baseURL = testInfo.project.use.baseURL;
    const outcomes = await Promise.all(Array.from({ length: PARALLEL }, (_, slot) => oneFlow(browser, baseURL, file, iteration, slot)));
    for (const [slot, outcome] of outcomes.entries()) {
      appendFileSync(
        join(RESULTS, 'burnin.jsonl'),
        `${JSON.stringify({ at: new Date().toISOString(), browser: testInfo.project.name, version: browser.version(), route: ROUTE, play: PLAY, load: LOAD, parallel: PARALLEL, file: FILM ? 'film' : LONG ? 'long' : 'short', idleS: IDLE_S, hide: HIDE, repeat: testInfo.repeatEachIndex, iteration, slot, ...outcome })}\n`,
      );
    }
    for (const outcome of outcomes) {
      expect(outcome.ok, `${outcome.reason ?? ''} | ${outcome.detail ?? ''} | ${JSON.stringify(outcome.log ?? null)}`).toBe(true);
    }
  });
}
