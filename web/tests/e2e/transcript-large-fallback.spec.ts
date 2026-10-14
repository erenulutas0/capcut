import { join } from 'node:path';
import { devices, expect, test, type BrowserContext, type Page } from './fixtures';

import { STUB_LINES, STUB_SCRIPT, expectTestBuild, installTranscriptTest, lineTexts, serveModels, testModels, type ModelServer } from './transcriptKit';
import { SECRET_LINE, SECRET_PATH, SECRET_URL, diagnosticsFrom, expectDetail, watchLogs } from './workerFaultKit';

/**
 * "Yazıya dök" where the large model is not proven (ADR-036, addendum of
 * 14 Oct 2026). On a Galaxy S23 (Chrome 155, WebGPU with shader-f16) the
 * large model was pre-selected and "Önerilen"; it downloaded (605 MB) and
 * then failed every time while writing, with a WebGPU buffer read error.
 *
 * - On a phone the large model is not offered at all (second addendum, same
 *   day: it failed 3 of 3 on the S23): no choice, one line "Büyük model
 *   telefon ve tablette yok.", the small model. A large model stored there from
 *   before is still not offered, and its room can be freed.
 * - On desktop Chromium nothing changed: the large model leads.
 * - When the large model fails while writing, the screen offers "Küçük
 *   modelle dene" (its download size said first) and keeps "Tekrar dene";
 *   the diagnostics say which happened, without the error's text; this
 *   browser stops recommending the large model, offers to free its room,
 *   and forgets the note when asked (privacy page) or when the large model
 *   later works here.
 *
 * "This browser can run the large model" is said by the test (the kit's
 * `largeModel`); the phone is Playwright's Pixel 7 (its user agent and
 * client hints). The stand-in recogniser fails like the phone did — an
 * `Error` with onnxruntime's sentence, raised while writing, only for the
 * large model — and carries a path, a caption line and a blob address that
 * must travel nowhere.
 */

const SAMPLE = join(process.cwd(), 'tests', 'media', 'sample-24s.mp4');

test.describe.configure({ timeout: 300_000 });
test.use({ storageState: { cookies: [], origins: [] } });

/** What onnxruntime's WebGPU backend says when a buffer cannot be read back (the phone's console, 14 Oct). */
const PHONE_SENTENCE =
  'failed to call OrtRun(). ERROR_CODE: 1, ERROR_MESSAGE: /onnxruntime/onnxruntime/core/providers/webgpu/buffer_manager.cc:418 void onnxruntime::webgpu::BufferManager::Download(WGPUBuffer, void *, size_t) const map_async_result.status == wgpu::MapAsyncStatus::Success was false.';

/** The large model fails after its first stretch, the small one writes. */
const FAILS_LARGE = {
  ...STUB_SCRIPT,
  failAs: { model: 'turbo', errorName: 'Error', message: `${PHONE_SENTENCE} ${SECRET_PATH} — ${SECRET_LINE} — ${SECRET_URL}` },
};

async function openStep(page: Page, context: BrowserContext, stub: unknown = STUB_SCRIPT): Promise<ModelServer> {
  const models = testModels();
  const server = await serveModels(context, models);
  await installTranscriptTest(page, models, stub, { largeModel: true });
  await page.goto('/yap/yazi');
  await page.getByTestId('video-input').setInputFiles(SAMPLE);
  await expectTestBuild(page);
  await page.waitForSelector('[data-testid="model-download"], [data-testid="transcribe-start"]', { timeout: 60_000 });
  return server;
}

const option = (page: Page, index: number) => page.getByTestId('transcribe-quality').locator('.wizard-option').nth(index);
const note = (page: Page) => page.evaluate(() => window.localStorage.getItem('clip.transcriptLargeFailed'));

test.describe('on a phone', () => {
  // Playwright's Pixel 7: an Android Chrome user agent, `userAgentData.mobile` true, a phone's screen.
  const { defaultBrowserType: _browser, ...pixel } = devices['Pixel 7'];
  test.use({ ...pixel });

  test('the large model is not offered: no choice, one plain line, the small model writes', async ({ page, context }) => {
    const server = await openStep(page, context);
    await expect(page.getByTestId('transcribe-large-phone')).toHaveText('Büyük model telefon ve tablette yok.');
    // No choice at all: no radio for either model, and nothing that names the large one's size.
    await expect(page.getByTestId('transcribe-quality')).toHaveCount(0);
    await expect(page.getByTestId('option-model-turbo')).toHaveCount(0);
    await expect(page.getByTestId('option-model-base')).toHaveCount(0);
    await expect(page.getByTestId('model-download')).toHaveText('Modeli indir (≈360 KB, bir kez)');
    await expect(page.getByTestId('transcribe-steps')).not.toContainText('960 KB');
    await expect(page.getByTestId('large-space')).toHaveCount(0);
    // Nothing is fetched by looking.
    expect(server.requests).toEqual([]);

    // The default path writes, and does not then advise the large model the phone did not run.
    await page.getByTestId('model-download').click();
    await page.getByTestId('transcribe-start').click({ timeout: 120_000 });
    await expect(page.getByTestId('transcript-panel')).toBeVisible({ timeout: 60_000 });
    expect(await lineTexts(page)).toEqual(STUB_LINES);
    await expect(page.getByTestId('yazi-try-larger')).toHaveCount(0);
    expect(server.requests.some((request) => request.key.startsWith('turbo-test/'))).toBe(false);
    expect(await note(page)).toBeNull();
  });

  test('a large model stored on the phone from before is still not offered; "Büyük modeli sil" frees its room', async ({ page, context }) => {
    // "Before": this browser looked like a computer (the large model was a choice then) and stored it.
    // The override is read from this tab's storage by an init script, so it can be dropped below.
    await page.addInitScript(() => {
      if (window.sessionStorage.getItem('e2e.looksLikeComputer') !== '1') return;
      const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36';
      const data = { mobile: false, platform: 'Windows', brands: [{ brand: 'Chromium', version: '155' }, { brand: 'Google Chrome', version: '155' }] };
      Object.defineProperty(Navigator.prototype, 'userAgent', { get: () => userAgent, configurable: true });
      Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => data, configurable: true });
    });
    const server = await openStep(page, context);
    await page.evaluate(() => window.sessionStorage.setItem('e2e.looksLikeComputer', '1'));
    await page.reload();
    await page.getByTestId('video-input').setInputFiles(SAMPLE);
    await expect(page.getByTestId('option-model-turbo')).toBeChecked({ timeout: 60_000 });
    await page.getByTestId('model-download').click();
    await expect(page.getByTestId('transcribe-start')).toBeVisible({ timeout: 120_000 });
    expect(server.requests.some((request) => request.key.startsWith('turbo-test/'))).toBe(true);

    // Now: the phone as it is. The large model's files are here, and it is still not offered.
    await page.evaluate(() => window.sessionStorage.removeItem('e2e.looksLikeComputer'));
    await page.reload();
    await page.getByTestId('video-input').setInputFiles(SAMPLE);
    await expect(page.getByTestId('transcribe-large-phone')).toHaveText('Büyük model telefon ve tablette yok.', { timeout: 60_000 });
    await expect(page.getByTestId('transcribe-quality')).toHaveCount(0);
    await expect(page.getByTestId('option-model-turbo')).toHaveCount(0);
    // The small model is what runs (its own files are not here yet; the shared ones came with the large one).
    await expect(page.getByTestId('model-download')).toHaveText('İndirmeye devam et (kalan ≈300 KB)');
    // Its room is offered back, never freed alone.
    await expect(page.getByTestId('large-space-size')).toHaveText('Büyük model bu tarayıcıda ≈900 KB yer kaplıyor.');
    await page.getByTestId('large-delete').click();
    await expect(page.getByTestId('large-deleted')).toHaveText('Büyük model silindi.');
    await expect(page.getByTestId('large-delete')).toHaveCount(0);
    expect(await note(page)).toBeNull();

    // The next visit: nothing of the large model is left to offer back.
    await page.reload();
    await page.getByTestId('video-input').setInputFiles(SAMPLE);
    await expect(page.getByTestId('transcribe-large-phone')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('model-download')).toBeVisible();
    await expect(page.getByTestId('large-space')).toHaveCount(0);
  });
});

test.describe('on a computer (desktop Chromium)', () => {
  test('unchanged: the large model leads, its line warns of nothing, nothing extra is shown', async ({ page, context }) => {
    await openStep(page, context);
    await expect(page.getByTestId('transcribe-quality')).toHaveAttribute('data-standing', 'proven');
    await expect(option(page, 0).locator('.wizard-option-label')).toHaveText('Önerilen: büyük model (≈960 KB, bir kez iner)');
    await expect(option(page, 1).locator('.wizard-option-label')).toHaveText('Küçük model (≈360 KB)');
    await expect(page.getByTestId('option-model-turbo')).toBeChecked();
    await expect(page.getByTestId('option-model-turbo-hint')).toHaveText(
      'Konuşmayı çok daha iyi anlar; sohbette ve gürültüde de. İndirmesi büyüktür, ekran kartını kullanır ve çok bellek ister.',
    );
    await expect(page.getByTestId('large-space')).toHaveCount(0);
  });

  test('the large model fails while writing: "Küçük modelle dene" writes the text; "Tekrar dene" stays; the diagnostics say which, and nothing of the error', async ({ page, context }) => {
    const logs = watchLogs(page);
    const server = await openStep(page, context, FAILS_LARGE);
    await page.getByTestId('model-download').click();
    await page.getByTestId('transcribe-start').click({ timeout: 120_000 });

    const failed = page.getByTestId('transcribe-failed');
    await expect(failed).toBeVisible({ timeout: 60_000 });
    await expect(failed).toHaveAttribute('data-reason', 'internal_error');
    await expect(failed).toHaveAttribute('data-large-failure', 'gpu');
    await expect(failed).toHaveText('Büyük model bu cihazda yazıya dökemedi. Küçük modelle deneyebilirsin: daha küçüktür ve denediğimiz telefonda da çalıştı.');
    // The way forward, with what it downloads first (the shared files are already here).
    await expect(page.getByTestId('transcribe-try-small')).toHaveText('Küçük modelle dene');
    await expect(page.getByTestId('transcribe-try-small-note')).toHaveText('Önce küçük model iner (≈300 KB, bir kez), sonra yazıya döker.');
    await expect(page.getByTestId('transcribe-start')).toHaveText('Tekrar dene');
    // No partial transcript is kept.
    await expect(page.getByTestId('transcript-panel')).toHaveCount(0);

    // This browser stops recommending the large model, and says so on the choice itself.
    await expect(page.getByTestId('transcribe-quality')).toHaveAttribute('data-standing', 'failed_here');
    await expect(option(page, 0).locator('.wizard-option-label')).toHaveText('Önerilen: küçük model (≈360 KB, bir kez iner)');
    await expect(page.getByTestId('option-model-turbo-hint')).toHaveText('Bu cihazda daha önce yazıya dökerken durdu. Yine de seçebilirsin. İndirmesi çok büyüktür.');
    expect(await note(page)).toBe('1');
    // Its room can be freed — offered, not done.
    await expect(page.getByTestId('large-space-size')).toHaveText('Büyük model bu tarayıcıda ≈900 KB yer kaplıyor.');

    // "Ayrıntılar" and "Sorun bildir": where it broke, the known sentence's label — never the sentence, the path, the line.
    await expectDetail(page, logs, {
      testId: 'transcribe-failed',
      area: 'transcript',
      code: 'internal_error',
      label: 'large model on a phone',
      line: /^Error · recognise · gpu_buffer_read · writing$/,
      detail: { errorName: 'Error', stage: 'recognise', via: 'exception', hint: 'gpu_buffer_read', phase: 'writing', pageWasHidden: false },
    });

    // "Tekrar dene": the large model again, and the same failure.
    await page.getByTestId('transcribe-start').click();
    await expect(page.getByTestId('transcribe-steps')).toHaveAttribute('data-job', 'transcribing');
    await expect(page.getByTestId('transcribe-steps')).toHaveAttribute('data-job', 'failed', { timeout: 60_000 });
    await expect(failed).toHaveAttribute('data-large-failure', 'gpu');
    // "Ayrıntılar" is closed again for the new failure.
    await page.getByTestId('transcribe-failed-details').locator('summary').click();
    const report = await diagnosticsFrom(page, 'transcribe-failed-report');
    expect(report.sessionErrors.filter((row) => row.area === 'transcript').map((row) => row.code)).toEqual([
      'large_model_failed_gpu',
      'internal_error',
      'large_model_retry',
      'large_model_failed_gpu',
      'internal_error',
    ]);
    // The classification rows carry no detail; the failure rows carry only the checked one.
    for (const row of report.sessionErrors.filter((entry) => entry.code.startsWith('large_model_'))) expect(row.detail).toBeUndefined();
    expect(report.text).not.toMatch(/BufferManager|map_async|onnxruntime|ayse|Mehmet|secretblob/);
    // The note is the only new thing stored, and it is "1".
    expect(await page.evaluate(() => ({ ...window.localStorage }))).toEqual({ 'clip.transcriptLargeFailed': '1' });

    // "Küçük modelle dene": only the small model's own files are fetched, then it writes.
    const before = server.requests.length;
    await page.getByTestId('transcribe-try-small').click();
    await expect(page.getByTestId('transcript-panel')).toBeVisible({ timeout: 120_000 });
    expect(await lineTexts(page)).toEqual(STUB_LINES);
    expect(
      server.requests
        .slice(before)
        .map((request) => request.key)
        .filter((key, index, all) => all.indexOf(key) === index)
        .sort(),
    ).toEqual(['base-test/config.json', 'base-test/onnx/encoder.onnx']);
    // Written by the small model: no advice to go back to the large one.
    await expect(page.getByTestId('yazi-try-larger')).toHaveCount(0);

    // The next visit: the small model is selected and ready; the large one's room is offered back.
    await page.goto('/yap/yazi');
    await page.getByTestId('video-input').setInputFiles(SAMPLE);
    await expect(page.getByTestId('transcribe-start')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('option-model-base')).toBeChecked();
    await expect(page.getByTestId('transcribe-quality')).toHaveAttribute('data-standing', 'failed_here');
    await expect(page.getByTestId('large-space-size')).toHaveText('Büyük model bu tarayıcıda ≈900 KB yer kaplıyor.');
    await page.getByTestId('large-delete').click();
    await expect(page.getByTestId('large-deleted')).toHaveText('Büyük model silindi.');
    await expect(page.getByTestId('large-delete')).toHaveCount(0);
    // Only the large model went: the small one still starts at once; the large one would need its own files again.
    await expect(page.getByTestId('transcribe-start')).toBeVisible();
    await page.getByTestId('option-model-turbo').check();
    await expect(page.getByTestId('model-download')).toHaveText('İndirmeye devam et (kalan ≈900 KB)');
    await page.getByTestId('option-model-base').check();
    await expect(page.getByTestId('transcribe-start')).toBeVisible();

    // The note can be cleared on the privacy page; the large model is then recommended here again.
    await page.goto('/gizlilik');
    await expect(page.getByTestId('stored-largeNote')).toContainText('“clip.transcriptLargeFailed”');
    await expect(page.getByTestId('model-large-note')).toBeVisible();
    await page.getByTestId('model-large-note-forget').click();
    await expect(page.getByTestId('model-large-note-message')).toHaveText('Not silindi.');
    await expect(page.getByTestId('model-large-note')).toHaveCount(0);
    expect(await note(page)).toBeNull();
    await page.goto('/yap/yazi');
    await page.getByTestId('video-input').setInputFiles(SAMPLE);
    await expect(page.getByTestId('transcribe-start')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('transcribe-quality')).toHaveAttribute('data-standing', 'proven');
    await expect(option(page, 0).locator('.wizard-option-label')).toHaveText('Önerilen: büyük model (≈960 KB, bir kez iner)');
  });

  test('editor: the same way forward in the dialog, and the diagnostics say the small model then wrote it', async ({ page, context }) => {
    const models = testModels();
    await serveModels(context, models);
    await installTranscriptTest(page, models, FAILS_LARGE, { largeModel: true });
    await page.goto('/editor');
    await page.getByTestId('video-input').setInputFiles(SAMPLE);
    await expect(page.getByTestId('preview-video')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('open-more').click();
    await page.getByTestId('open-transcribe').click();
    await expect(page.getByTestId('option-model-turbo')).toBeChecked({ timeout: 60_000 });
    await page.getByTestId('model-download').click();
    await page.getByTestId('transcribe-start').click({ timeout: 120_000 });
    await expect(page.getByTestId('transcribe-failed')).toHaveAttribute('data-large-failure', 'gpu', { timeout: 60_000 });
    await page.getByTestId('transcribe-try-small').click();
    await expect(page.getByTestId('transcribe-done')).toBeVisible({ timeout: 120_000 });
    // A quarter of the found speech was not written — said, without advising the large model that failed here.
    await expect(page.getByTestId('transcribe-coverage')).toBeVisible();
    await expect(page.getByTestId('transcribe-try-larger')).toHaveCount(0);
    await page.getByTestId('transcribe-close').click();

    await page.getByTestId('open-more').click();
    await page.getByTestId('open-help').click();
    await page.getByTestId('open-report').click();
    await expect(page.getByTestId('diag-preview')).toHaveAttribute('aria-busy', 'false');
    const text = (await page.getByTestId('diag-preview').textContent()) ?? '';
    const json = JSON.parse(text) as { sessionErrors: { area: string; code: string }[] };
    expect(json.sessionErrors.filter((row) => row.area === 'transcript').map((row) => row.code)).toEqual([
      'large_model_failed_gpu',
      'internal_error',
      'large_model_fallback_small',
      'large_model_fallback_small_done',
    ]);
    expect(text).not.toMatch(/BufferManager|map_async|onnxruntime|ayse|Mehmet|secretblob/);
  });

  test('the note goes by itself when the large model later writes here', async ({ page, context }) => {
    await openStep(page, context);
    await page.evaluate(() => window.localStorage.setItem('clip.transcriptLargeFailed', '1'));
    await page.reload();
    await page.getByTestId('video-input').setInputFiles(SAMPLE);
    await expect(page.getByTestId('transcribe-quality')).toHaveAttribute('data-standing', 'failed_here', { timeout: 60_000 });
    await expect(page.getByTestId('option-model-base')).toBeChecked();
    // The user chooses the large model anyway, and this time it works.
    await page.getByTestId('option-model-turbo').check();
    await page.getByTestId('model-download').click();
    await page.getByTestId('transcribe-start').click({ timeout: 120_000 });
    await expect(page.getByTestId('transcript-panel')).toBeVisible({ timeout: 60_000 });
    expect(await note(page)).toBeNull();
  });
});
