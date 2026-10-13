import { expect, test } from '@playwright/test';

import { expectDetail, fault, faultBeforeLoad, nextFault, watchLogs, type FaultKind } from '../e2e/workerFaultKit';
import { SCRIPT_LINES, SCRIPT_WORDS, ct, expectHonestFailure, lineTexts, openReady, startFake, type FakeWorker } from './cloudKit';

/**
 * The cloud sound worker (ADR-039) under the rules of ADR-042 (addendum of
 * 13 Oct 2026): making the sound-only file is the step before anything is
 * sent. Until now an unexpected failure there said only "something went
 * wrong", and a worker that stood still, could not be read or could not be
 * given the request left "preparing the sound…" on screen for ever.
 *
 * Against the LOCAL FAKE of our proxy (cloudKit.ts); nothing leaves the
 * machine. The break is made on purpose (`window.__clipWorkerFault`, test
 * builds only) and the error's text is given a path, a file name, a caption
 * line and a blob address: none of it may be on screen, in stored state, in
 * a log line of the app, in the diagnostics file — or sent to the proxy.
 */

let fake: FakeWorker;
test.beforeAll(async ({}, testInfo) => {
  fake = await startFake(testInfo.project.use.baseURL);
});
test.afterAll(async () => {
  await fake.close();
});
test.beforeEach(() => fake.reset());

const sent = () => fake.requests.filter((request) => request.method !== 'OPTIONS').map((request) => `${request.method} ${request.path.replace(/[0-9a-f-]{36}/, ':id')}`);

const STALL_MS = 2500;
const KINDS: FaultKind[] = ['throw', 'crash', 'stall', 'unsendable'];

function expected(kind: FaultKind) {
  if (kind === 'throw') {
    return {
      line: /^EncodingError · audio · decoding_error · preparing$/,
      detail: { errorName: 'EncodingError', stage: 'audio', via: 'exception', hint: 'decoding_error', phase: 'preparing', pageWasHidden: false },
    };
  }
  if (kind === 'crash') {
    return {
      line: /^WorkerError · worker_crash · worker_error_event · preparing$/,
      detail: { errorName: 'WorkerError', stage: 'worker_crash', via: 'worker_error_event', hint: null, phase: 'preparing', pageWasHidden: false },
    };
  }
  if (kind === 'stall') {
    return {
      line: /^Stalled · audio · stalled · preparing$/,
      detail: { errorName: 'Stalled', stage: 'audio', via: 'stalled', hint: null, phase: 'preparing', pageWasHidden: false },
    };
  }
  return {
    line: /^DataCloneError · unknown · request_not_sent$/,
    detail: { errorName: 'DataCloneError', stage: 'unknown', via: 'request_not_sent', hint: null, phase: null, pageWasHidden: false },
  };
}

test('every way the sound file\'s making can break ends as a failure that says where; nothing is sent; the next press works', async ({ page }) => {
  test.setTimeout(300_000);
  const logs = watchLogs(page);
  const invite = fake.newInvite(60);
  fake.provider({ words: SCRIPT_WORDS, pollsUntilDone: 1, languageCode: 'tr' });
  await faultBeforeLoad(page, fault('cloud_audio', 'throw'), STALL_MS);
  await openReady(page, invite);

  for (const kind of KINDS) {
    await test.step(kind, async () => {
      await page.getByTestId('route-online-go').click();
      await expectHonestFailure(page, 'cloud.failed.internal_error', fake);
      await expectDetail(page, logs, { testId: 'cloud-failed', area: 'cloud_audio', code: 'internal_error', label: `cloud/${kind}`, ...expected(kind) });
      // Nothing was sent: no upload, no job — only the question about the minutes.
      expect(fake.uploads).toHaveLength(0);
      expect(sent().filter((entry) => !entry.startsWith('GET /v1/quota'))).toEqual([]);
      const next = KINDS[KINDS.indexOf(kind) + 1];
      await nextFault(page, next ? fault('cloud_audio', next) : null, STALL_MS);
      await expect(page.getByTestId('route-online-go')).toBeVisible({ timeout: 30_000 });
    });
  }

  // The same page, no fault: the sound is made, sent, and the text comes back.
  await page.getByTestId('route-online-go').click();
  await expect(page.getByTestId('transcript-panel')).toBeVisible({ timeout: 120_000 });
  expect(await lineTexts(page)).toEqual(SCRIPT_LINES);
  expect(fake.uploads).toHaveLength(1);
});

test('“Durdur” ends a sound file that stands still at once; a healthy one is never ended by the watch', async ({ page }) => {
  test.setTimeout(180_000);
  const invite = fake.newInvite(60);
  fake.provider({ words: SCRIPT_WORDS, pollsUntilDone: 1, languageCode: 'tr' });
  // The stall itself is not waited out here: the press comes first.
  await faultBeforeLoad(page, fault('cloud_audio', 'stall'), 600_000);
  await openReady(page, invite);
  await page.getByTestId('route-online-go').click();
  await expect(page.getByTestId('cloud-stop')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1200);
  await page.getByTestId('cloud-stop').click();
  await expect(page.getByTestId('cloud-notice')).toContainText(ct('cloud.stopped'), { timeout: 15_000 });
  // Stopped by the user: not a failure, no "Ayrıntılar"; nothing was sent.
  await expect(page.getByTestId('cloud-failed-details')).toHaveCount(0);
  expect(fake.uploads).toHaveLength(0);

  // No fault, and a limit of one second: a file that keeps reporting is never "standing still".
  await nextFault(page, null, 1000);
  await page.getByTestId('route-online-go').click();
  await expect(page.getByTestId('transcript-panel')).toBeVisible({ timeout: 120_000 });
});
