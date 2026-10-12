import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

import { frameGray, installSavePicker, meanAbsDiff, probeMp4, readSaved } from '../e2e/kesitFlow';
import { LONG_SECONDS, enterInvite, longSample, openChoice, realisticWords, startFake, type FakeWorker } from '../cloud/cloudKit';

/**
 * What a burn-in download does when the browser's graphics process dies under
 * it — one known way for hardware decoding, hardware encoding and the canvas
 * to break for a moment and work again right after (the kind of failure that
 * is gone on the next press).
 *
 * Only with `SOAK_GPU_CRASH=<seconds after the press>`, and only meaningful in
 * an installed browser (`SOAK_CHANNEL=chrome|msedge`): Playwright's Chromium
 * decodes and encodes in software. The crash is asked of the browser itself
 * (`Browser.crashGpuProcess`); it restarts its graphics process on its own.
 *
 * Whatever happens is written to `soak-results/gpu-loss.jsonl`. The run fails
 * only on the one thing that must never happen: a file reported as saved whose
 * pictures are not the video's.
 */

const AFTER_S = Number(process.env.SOAK_GPU_CRASH || 'NaN');
const ROUNDS = Number.isFinite(AFTER_S) && AFTER_S > 0 ? Number(process.env.SOAK_ITERATIONS ?? '3') : 1;
const RESULTS = join(process.cwd(), 'soak-results');

test.skip(!Number.isFinite(AFTER_S) || AFTER_S <= 0, 'set SOAK_GPU_CRASH=<seconds>');

let fake: FakeWorker;
test.beforeAll(async ({}, testInfo) => {
  mkdirSync(RESULTS, { recursive: true });
  fake = await startFake(testInfo.project.use.baseURL, { rateLimitPerHour: 100_000, monthlyCapUsd: 1000 });
});
test.afterAll(async () => {
  await fake.close();
});

for (let round = 1; round <= ROUNDS; round += 1) {
  test(`the graphics process dies ${AFTER_S} s into the download, #${round}`, async ({ page, browser }, testInfo) => {
    test.setTimeout(1_200_000);
    fake.reset();
    fake.provider({ words: realisticWords(LONG_SECONDS), pollsUntilDone: 1, languageCode: 'en_us' });
    await installSavePicker(page);
    const source = longSample();
    await openChoice(page, source);
    await enterInvite(page, fake.newInvite(600));
    await page.getByTestId('route-online-go').click();
    await expect(page.getByTestId('transcript-panel')).toBeVisible({ timeout: 300_000 });

    await page.getByTestId('wizard-download').click();
    await page.waitForTimeout(AFTER_S * 1000);
    const progressAtCrash = await page.locator('[role="progressbar"]').first().getAttribute('aria-valuenow').catch(() => null);
    const cdp = await browser.newBrowserCDPSession();
    let crashAsked = true;
    try {
      await cdp.send('Browser.crashGpuProcess');
    } catch {
      crashAsked = false;
    }

    const saved = page.getByTestId('download-saved');
    const failed = page.getByTestId('export-failed');
    await expect(saved.or(failed)).toBeVisible({ timeout: 900_000 });
    const row: Record<string, unknown> = { at: new Date().toISOString(), browser: testInfo.project.name, version: browser.version(), afterS: AFTER_S, progressAtCrash, crashAsked, round };

    if (await failed.isVisible()) {
      row.outcome = 'failed';
      row.reason = await page.getByTestId('export-failed-reason').innerText();
      if ((await page.getByTestId('export-failed-details').count()) > 0) {
        await page.locator('[data-testid="export-failed-details"] summary').click();
        row.detail = await page.getByTestId('export-failed-detail').innerText();
      }
      // The next press, on the same page: does it work again?
      await page.getByTestId('download-dismiss').click();
      await page.getByTestId('wizard-download').click();
      await expect(saved.or(failed)).toBeVisible({ timeout: 900_000 });
      row.secondPress = (await saved.isVisible()) ? 'saved' : `failed: ${await page.getByTestId('export-failed-reason').innerText()}`;
    } else {
      row.outcome = 'saved';
    }

    let wrongPictures: number[] = [];
    if (await saved.isVisible()) {
      const name = (await saved.innerText()).replace(/^Kaydedildi: /, '');
      const file = await readSaved(page, testInfo, name);
      const probe = probeMp4(file);
      row.frames = probe.frames;
      row.durationS = probe.durationS;
      // Is every moment the video's own picture? (The top of the frame: no caption there.)
      const times = [2, 10, 20, 30, 45, 60, 90, 120, 150, 180, 210, 240, 250];
      const top = (picture: Buffer) => picture.subarray(0, 64 * 18);
      const diffs = times.map((at) => Math.round(meanAbsDiff(top(frameGray(file, at)), top(frameGray(source, at))) * 10) / 10);
      row.pictureDiffs = diffs;
      wrongPictures = times.filter((_, index) => (diffs[index] ?? 255) > 12);
      row.wrongPictures = wrongPictures;
      const missing = page.getByTestId('measured-frames-missing');
      await page.locator('.dl-details summary').first().click();
      row.framesMissingSaid = (await missing.count()) > 0 ? await missing.innerText() : null;
    }
    appendFileSync(join(RESULTS, 'gpu-loss.jsonl'), `${JSON.stringify(row)}\n`);
    expect(wrongPictures, `a saved file whose pictures at ${wrongPictures.join(', ')} s are not the video's: ${JSON.stringify(row)}`).toEqual([]);
    if (row.outcome === 'saved') expect(row.frames).toBe(LONG_SECONDS * 30);
  });
}
