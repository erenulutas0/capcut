import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

import { installSavePicker, opfsFiles } from './kesitFlow';

/**
 * A download that breaks in a way nobody planned for (11 Oct 2026: once on a
 * real machine, gone on the next press, and nothing was known afterwards).
 *
 * The break is made on purpose here (`window.__clipExportFault`, test builds
 * only): the encoder hand-off of one frame throws, or the worker itself
 * crashes. What is checked:
 *
 * - the failure card says where it broke and with what kind of error, behind
 *   "Ayrıntılar", and the diagnostics file holds the same;
 * - the error's own TEXT — which is given a path and a file name here — is on
 *   no screen and in no file;
 * - nothing is left behind, and pressing download again works.
 */

const OTHER = join(process.cwd(), 'tests', 'media', 'other-8s.mp4'); // 640×360, H.264 + AAC, 8 s, 240 frames

/** What a browser's or a library's error text could give away. */
const SECRET_PATH = 'C:\\Users\\ayse\\Videos\\aile-tatili-antalya.mp4';
const SECRETS = ['ayse', 'aile-tatili', 'antalya', 'Users\\\\', 'Videos'];

interface Fault {
  kind: 'encode' | 'crash';
  atFrame: number;
  errorName?: string;
  message?: string;
}

async function openDikey(page: Page, fault: Fault) {
  await installSavePicker(page);
  await page.addInitScript((value) => {
    (window as unknown as { __clipExportFault: unknown }).__clipExportFault = value;
  }, fault);
  await page.goto('/');
  await page.getByTestId('task-dikey').click();
  await page.getByTestId('video-input').setInputFiles(OTHER);
  await expect(page.getByTestId('dikey-choice')).toBeVisible({ timeout: 60_000 });
}

/** Sets the fault for the NEXT download of the open page. */
async function nextFault(page: Page, fault: Fault) {
  await page.evaluate((value) => {
    (window as unknown as { __clipExportFault: unknown }).__clipExportFault = value;
  }, fault);
}

async function diagnostics(page: Page): Promise<{ text: string; exportLog: Array<Record<string, unknown>>; sessionErrors: Array<Record<string, unknown>> }> {
  await page.getByTestId('export-report').click();
  await expect(page.getByTestId('diag-preview')).toHaveAttribute('aria-busy', 'false');
  const text = (await page.getByTestId('diag-preview').textContent()) ?? '';
  const json = JSON.parse(text) as { exportLog: Array<Record<string, unknown>>; sessionErrors: Array<Record<string, unknown>> };
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('diag-preview')).toHaveCount(0);
  return { text, ...json };
}

async function expectNoSecret(page: Page, more: string) {
  const screen = await page.evaluate(() => document.documentElement.innerHTML);
  for (const secret of SECRETS) {
    expect(screen, `the page holds "${secret}"`).not.toContain(secret.replace('\\\\', '\\'));
    expect(more, `the diagnostics hold "${secret}"`).not.toContain(secret);
  }
}

test('an unexpected failure says where it broke, keeps nothing of the error text, and the next press works', async ({ page }) => {
  test.setTimeout(240_000);
  await openDikey(page, { kind: 'encode', atFrame: 12, errorName: 'EncodingError', message: `Encoding error. Could not process ${SECRET_PATH}` });

  await page.getByTestId('wizard-download').click();
  await expect(page.getByTestId('export-failed')).toBeVisible({ timeout: 120_000 });
  // Plain words first: what happened and what to do.
  await expect(page.getByTestId('export-failed-reason')).toHaveText('Beklenmeyen bir hata oluştu. Bir kez daha dene; yine olursa “Sorun bildir”e bas.');
  // The engineering line is one press away, closed until asked for.
  const details = page.getByTestId('export-failed-details');
  await expect(details).not.toHaveAttribute('open', '');
  await expect(page.getByTestId('export-failed-detail')).toBeHidden();
  await details.locator('summary').click();
  await expect(page.getByTestId('export-failed-detail')).toHaveText(
    /^EncodingError · encode · encoding_error · kare 12\/240 · enc avc1\.[0-9a-f]{6} no-preference hw[+-] · dec avc1\.[0-9A-Fa-f]{6} no-preference · file$/,
  );

  // The diagnostics file: the same facts, as checked values.
  const first = await diagnostics(page);
  expect(first.exportLog).toHaveLength(1);
  expect(first.exportLog[0]).toMatchObject({
    outcome: 'failed',
    failureCode: 'internal_error',
    failureDetail: {
      errorName: 'EncodingError',
      stage: 'encode',
      via: 'exception',
      hint: 'encoding_error',
      phase: 'encoding',
      framesDone: 12,
      totalFrames: 240,
      route: 'file',
      pageWasHidden: false,
      attemptInSession: 0,
      audioEncoder: { codec: 'mp4a.40.2', hardwareAcceleration: 'no-preference' },
    },
  });
  const detail = first.exportLog[0]?.failureDetail as Record<string, unknown>;
  expect(Object.keys(detail).sort()).toEqual(
    ['attemptInSession', 'audioEncoder', 'errorName', 'framesDone', 'hardwareEncoderAvailable', 'hint', 'pageWasHidden', 'phase', 'route', 'stage', 'totalFrames', 'via', 'videoDecoder', 'videoEncoder', 'videoPacketsOut'].sort(),
  );
  expect(first.sessionErrors).toEqual(expect.arrayContaining([expect.objectContaining({ area: 'export', code: 'internal_error' })]));
  await expectNoSecret(page, first.text);
  // Nothing of the failed attempt is left: not the chosen file, not a temporary one.
  expect(await opfsFiles(page)).toEqual({});

  // The same page, the same video: once more, and it is saved.
  await page.getByTestId('download-dismiss').click();
  await page.getByTestId('wizard-download').click();
  await expect(page.getByTestId('download-saved')).toBeVisible({ timeout: 120_000 });
  expect(Object.keys(await opfsFiles(page))).toEqual(['saved-other-8s_dikey.mp4']);
});

test('a worker that crashes under a running download ends as a failure that says so, is stopped, and the next press starts a new one', async ({ page }) => {
  test.setTimeout(240_000);
  await openDikey(page, { kind: 'crash', atFrame: 30, message: `crashed while reading ${SECRET_PATH}` });

  await page.getByTestId('wizard-download').click();
  await expect(page.getByTestId('export-failed')).toBeVisible({ timeout: 120_000 });
  // It WAS working: not "could not be started".
  await expect(page.getByTestId('export-failed-reason')).toHaveText('Beklenmeyen bir hata oluştu. Bir kez daha dene; yine olursa “Sorun bildir”e bas.');
  await page.getByTestId('export-failed-details').locator('summary').click();
  await expect(page.getByTestId('export-failed-detail')).toHaveText(/^WorkerError · worker_crash · worker_error_event · kare \d+\/240$/);

  const report = await diagnostics(page);
  expect(report.exportLog.at(-1)).toMatchObject({
    outcome: 'failed',
    failureCode: 'internal_error',
    failureDetail: { errorName: 'WorkerError', stage: 'worker_crash', via: 'worker_error_event', phase: 'encoding', totalFrames: 240, videoEncoder: null },
  });
  await expectNoSecret(page, report.text);

  // The broken worker was stopped: it writes nothing more, and what it had begun is gone.
  await page.waitForTimeout(1500);
  expect(await opfsFiles(page)).toEqual({});

  await page.getByTestId('download-dismiss').click();
  await page.getByTestId('wizard-download').click();
  await expect(page.getByTestId('download-saved')).toBeVisible({ timeout: 120_000 });
  expect(Object.keys(await opfsFiles(page))).toEqual(['saved-other-8s_dikey.mp4']);
});

test('a codec the browser took back is not called a full disk; a full disk still is', async ({ page }) => {
  test.setTimeout(240_000);
  // Chromium closes a reclaimed codec with a QuotaExceededError — the same name a full disk has.
  await openDikey(page, { kind: 'encode', atFrame: 5, errorName: 'QuotaExceededError', message: 'Codec reclaimed due to inactivity.' });
  await page.getByTestId('wizard-download').click();
  await expect(page.getByTestId('export-failed')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId('export-failed-reason')).toContainText('Beklenmeyen bir hata oluştu.');
  await page.getByTestId('export-failed-details').locator('summary').click();
  await expect(page.getByTestId('export-failed-detail')).toContainText('QuotaExceededError · encode · codec_reclaimed · kare 5/240');

  await page.getByTestId('download-dismiss').click();
  await nextFault(page, { kind: 'encode', atFrame: 5, errorName: 'QuotaExceededError', message: 'The quota has been exceeded.' });
  await page.getByTestId('wizard-download').click();
  await expect(page.getByTestId('export-failed')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId('export-failed-reason')).not.toContainText('Beklenmeyen bir hata');
  const report = await diagnostics(page);
  expect(report.exportLog.map((row) => row.failureCode)).toEqual(['internal_error', 'output_storage_full']);
  expect(report.exportLog[1]?.failureDetail).toMatchObject({ errorName: 'QuotaExceededError', hint: null, attemptInSession: 1 });
});
