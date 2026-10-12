import { expect, test } from '@playwright/test';

import { installSavePicker, probeMp4, readSaved } from '../e2e/kesitFlow';
import { LONG_SECONDS, SCRIPT_WORDS, enterInvite, longSample, openChoice, realisticWords, startFake, type FakeWorker } from './cloudKit';

/**
 * The transcript written on the internet is an ordinary caption track: the
 * wizard's own "Altyazılı videoyu indir" must burn it in like an on-device one.
 *
 * The last test is the case of 11 Oct 2026 as closely as a test can make it:
 * a video of 4 min 13 s and a provider answer shaped like a real one. On the
 * founder's machine that download failed once ("Beklenmeyen bir hata oluştu")
 * and worked on the next press; the cause was not found (ADR-039, addendum
 * of 12 Oct 2026). This test does NOT reproduce that failure — it passed
 * before anything was changed. It is here so that this path, at this length
 * and with this kind of answer, is walked on every run.
 */

let fake: FakeWorker;
test.beforeAll(async ({}, testInfo) => {
  fake = await startFake(testInfo.project.use.baseURL);
});
test.afterAll(async () => {
  await fake.close();
});
test.beforeEach(() => fake.reset());

for (const languageCode of ['tr', 'en_us'] as const) {
  test(`a transcript written on the internet (${languageCode}) is burned into the download`, async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    await installSavePicker(page);
    const invite = fake.newInvite(60);
    fake.provider({ words: SCRIPT_WORDS, pollsUntilDone: 1, languageCode });

    await openChoice(page);
    await enterInvite(page, invite);
    await page.getByTestId('route-online-go').click();
    await expect(page.getByTestId('transcript-panel')).toBeVisible({ timeout: 120_000 });

    await expect(page.getByTestId('wizard-download')).toHaveText('Altyazılı videoyu indir');
    await page.getByTestId('wizard-download').click();
    await expect(page.getByTestId('download-saved'), errors.join('\n')).toBeVisible({ timeout: 180_000 });
    const name = (await page.getByTestId('download-saved').innerText()).replace(/^Kaydedildi: /, '');
    const probe = probeMp4(await readSaved(page, testInfo, name));
    expect(probe.videoCodec).toBe('h264');
    expect(errors).toEqual([]);
  });
}

test('4 min 13 s and a provider answer shaped like a real one: written, burned in, saved at the first press', async ({ page }, testInfo) => {
  test.setTimeout(900_000);
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  await installSavePicker(page);
  const invite = fake.newInvite(60);
  const words = realisticWords(LONG_SECONDS);
  // What makes the answer "real": turns that overlap, words of no length, a stretch without a full stop, a word past the end.
  expect(words.length).toBeGreaterThan(400);
  expect(words.filter((word) => word.end === word.start).length).toBeGreaterThan(0);
  expect(words.filter((word, index) => index > 0 && word.start < (words[index - 1]?.end ?? 0)).length).toBeGreaterThan(0);
  expect(words.filter((word) => word.end > LONG_SECONDS * 1000).length).toBe(2);
  expect(new Set(words.map((word) => word.speaker)).size).toBe(3);
  fake.provider({ words, pollsUntilDone: 2, languageCode: 'en_us' });

  const source = longSample();
  await openChoice(page, source);
  await enterInvite(page, invite);
  await page.getByTestId('route-online-go').click();
  await expect(page.getByTestId('transcript-panel')).toBeVisible({ timeout: 300_000 });
  // Many lines, three voices; nothing was refused as "empty" or "broken".
  const summary = await page.getByTestId('yazi-cloud-summary').innerText();
  expect(Number(/(\d+) satır yazıldı/.exec(summary)?.[1] ?? '0'), summary).toBeGreaterThan(60);
  expect(summary).toContain('3 ayrı kişi ayırt edildi.');
  // The sound that left the browser is as long as the video (the proxy is told whole seconds, rounded up).
  const declaredS = fake.uploads[0]?.durationS ?? 0;
  expect(declaredS).toBeGreaterThanOrEqual(LONG_SECONDS);
  expect(declaredS).toBeLessThanOrEqual(LONG_SECONDS + 1);

  // The first press — the one that failed on 11 Oct 2026.
  await page.getByTestId('wizard-download').click();
  await expect(page.getByTestId('download-saved').or(page.getByTestId('export-failed'))).toBeVisible({ timeout: 600_000 });
  if (await page.getByTestId('export-failed').isVisible()) {
    // Should it ever fail here: say what the failure card says, so the run's log names the stage and the error.
    const details = page.getByTestId('export-failed-details');
    if ((await details.count()) > 0) await details.locator('summary').click();
    throw new Error(`the first download failed: ${await page.getByTestId('export-failed').innerText()}`);
  }
  const name = (await page.getByTestId('download-saved').innerText()).replace(/^Kaydedildi: /, '');
  const probe = probeMp4(await readSaved(page, testInfo, name));
  expect(probe.videoCodec).toBe('h264');
  expect(probe.audioCodec).toBe('aac');
  expect(probe.width).toBe(1280);
  expect(probe.height).toBe(720);
  // Every frame of the video, none more: 253 s at 30 a second.
  expect(probe.frames).toBe(LONG_SECONDS * 30);
  expect(Math.abs(probe.durationS - LONG_SECONDS)).toBeLessThan(0.1);
  expect(errors).toEqual([]);
});
