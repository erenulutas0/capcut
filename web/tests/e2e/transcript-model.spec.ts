import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { STUB_SCRIPT, expectTestBuild, installTranscriptTest, serveModels, testModels, type ModelServer } from './transcriptKit';

/**
 * Which model is offered, which is selected to begin with, and what the
 * result says about how much was understood (ADR-036, 7 Oct 2026).
 *
 * - Where the large model can run it is the pre-selected, "Önerilen" choice,
 *   with its real size on the label and on the button; the small one stays
 *   as the smaller option. Nothing downloads without the button.
 * - A browser that already holds only the small model starts on the small
 *   model: no 596 MB download stands between the user and "Yazıya dök".
 * - After a run that left a meaningful part unwritten the result says how
 *   much was written, and — when the small model did it and the large one
 *   can run here — offers to write it again with the recommended model.
 *
 * "This browser can run the large model" is said by the test (the kit's
 * `largeModel`), not asked of the test machine's graphics card. The model
 * files are the kit's tiny ones; the recogniser is the scripted stand-in.
 */

const SAMPLE = join(process.cwd(), 'tests', 'media', 'sample-24s.mp4');
const S = 1_000_000;

test.describe.configure({ timeout: 300_000 });
test.use({ storageState: { cookies: [], origins: [] } });

/** Half of the found speech could not be written: three written stretches, three not. */
const HALF_UNCLEAR = {
  stepMs: 20,
  segments: [0, 1, 2].flatMap((k) => [
    {
      startUs: (1 + k * 7) * S,
      endUs: (4 + k * 7) * S,
      state: 'ok',
      words: [
        { text: 'Stretch', startUs: (1.1 + k * 7) * S, endUs: (1.6 + k * 7) * S },
        { text: `${k + 1}.`, startUs: (1.7 + k * 7) * S, endUs: (2.2 + k * 7) * S },
      ],
    },
    { startUs: (4.5 + k * 7) * S, endUs: (7.5 + k * 7) * S, state: 'unclear', words: [] },
  ]),
};

async function openStep(page: Page, context: BrowserContext, options: { largeModel: boolean; stub?: unknown }): Promise<ModelServer> {
  const models = testModels();
  const server = await serveModels(context, models);
  await installTranscriptTest(page, models, options.stub ?? STUB_SCRIPT, { largeModel: options.largeModel });
  await page.goto('/yap/yazi');
  await page.getByTestId('video-input').setInputFiles(SAMPLE);
  await expectTestBuild(page);
  await page.waitForSelector('[data-testid="model-download"], [data-testid="transcribe-start"]', { timeout: 60_000 });
  return server;
}

test.describe('Yazıya dök: the recommended model', () => {
  test('where the large model can run it is pre-selected and marked "Önerilen" with its size; nothing downloads by itself', async ({ page, context }) => {
    const server = await openStep(page, context, { largeModel: true });
    // Two choices, the recommended one first and selected.
    const options = page.getByTestId('transcribe-quality').locator('.wizard-option');
    await expect(options).toHaveCount(2);
    await expect(options.nth(0)).toHaveAttribute('data-recommended', 'true');
    await expect(options.nth(0).locator('.wizard-option-label')).toHaveText('Önerilen: büyük model (≈960 KB, bir kez iner)');
    await expect(options.nth(1).locator('.wizard-option-label')).toHaveText('Küçük model (≈360 KB)');
    await expect(page.getByTestId('option-model-turbo')).toBeChecked();
    await expect(page.getByTestId('option-model-base')).not.toBeChecked();
    // The button names the size of what it would download; until it is pressed, nothing is fetched.
    await expect(page.getByTestId('model-download')).toHaveText('Modeli indir (≈960 KB, bir kez)');
    expect(server.requests).toEqual([]);

    // The small model stays a choice, with its own size on the button.
    await page.getByTestId('option-model-base').check();
    await expect(page.getByTestId('model-download')).toHaveText('Modeli indir (≈360 KB, bir kez)');
    expect(server.requests).toEqual([]);

    // Back to the recommended one and download it: only then are its files asked for.
    await page.getByTestId('option-model-turbo').check();
    await page.getByTestId('model-download').click();
    await expect(page.getByTestId('transcribe-start')).toBeVisible({ timeout: 120_000 });
    expect(server.requests.map((request) => request.key).sort()).toEqual(['runtime-test/runtime.wasm', 'turbo-test/onnx/encoder.onnx', 'vad-test/onnx/model.onnx'].sort());
  });

  test('where the large model cannot run there is one model and no choice', async ({ page, context }) => {
    const server = await openStep(page, context, { largeModel: false });
    await expect(page.getByTestId('transcribe-quality')).toHaveCount(0);
    await expect(page.getByTestId('model-download')).toHaveText('Modeli indir (≈360 KB, bir kez)');
    expect(server.requests).toEqual([]);
  });

  test('a browser that holds only the small model starts on the small model: "Yazıya dök" is ready, the large one is still offered', async ({ page, context }) => {
    const server = await openStep(page, context, { largeModel: true });
    await page.getByTestId('option-model-base').check();
    await page.getByTestId('model-download').click();
    await expect(page.getByTestId('transcribe-start')).toBeVisible({ timeout: 120_000 });
    const fetched = server.requests.length;

    // The next visit (same browser storage).
    await page.goto('/yap/yazi');
    await page.getByTestId('video-input').setInputFiles(SAMPLE);
    await expect(page.getByTestId('transcribe-start')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('option-model-base')).toBeChecked();
    await expect(page.getByTestId('model-download')).toHaveCount(0);
    // The recommended model is still there to choose, labelled as such; choosing it shows what is LEFT to download
    // (the runtime and the speech detector are shared and already here)…
    await expect(page.getByTestId('transcribe-quality').locator('.wizard-option').nth(0).locator('.wizard-option-label')).toContainText('Önerilen: büyük model');
    await page.getByTestId('option-model-turbo').check();
    await expect(page.getByTestId('model-download')).toHaveText('İndirmeye devam et (kalan ≈900 KB)');
    // …and nothing was fetched by looking.
    expect(server.requests.length).toBe(fetched);

    // Once the large model is here too, it is the one selected next time.
    await page.getByTestId('model-download').click();
    await expect(page.getByTestId('transcribe-start')).toBeVisible({ timeout: 120_000 });
    await page.goto('/yap/yazi');
    await page.getByTestId('video-input').setInputFiles(SAMPLE);
    await expect(page.getByTestId('transcribe-start')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('option-model-turbo')).toBeChecked();
  });
});

test.describe('Yazıya dök: how much was understood', () => {
  test('a run that left half unwritten says so in numbers, and offers the recommended model — which is never fetched by itself', async ({ page, context }) => {
    const server = await openStep(page, context, { largeModel: true, stub: HALF_UNCLEAR });
    await page.getByTestId('option-model-base').check();
    await page.getByTestId('model-download').click();
    await page.getByTestId('transcribe-start').click({ timeout: 120_000 });
    await expect(page.getByTestId('transcript-panel')).toBeVisible({ timeout: 60_000 });

    const note = page.getByTestId('yazi-coverage');
    await expect(note).toContainText('Bulunan konuşmanın yaklaşık yüzde 50 kadarı yazıldı; 3 yer anlaşılamadı.');
    await expect(note).toContainText('Bu, küçük modelle yazıldı. Önerilen büyük model anlaşılamayan yerlerin çoğunu yazabilir.');
    const before = server.requests.length;
    await page.getByTestId('yazi-try-larger').click();

    // One step back: the recommended model selected, its size on the button, nothing fetched yet; the old lines are gone.
    await expect(page.getByTestId('option-model-turbo')).toBeChecked();
    await expect(page.getByTestId('model-download')).toHaveText('İndirmeye devam et (kalan ≈900 KB)');
    await expect(page.getByTestId('transcript-panel')).toHaveCount(0);
    expect(server.requests.length).toBe(before);

    // With the recommended model the same sentence is not repeated as advice.
    await page.getByTestId('model-download').click();
    await page.getByTestId('transcribe-start').click({ timeout: 120_000 });
    await expect(page.getByTestId('transcript-panel')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('yazi-coverage')).toContainText('yaklaşık yüzde 50 kadarı yazıldı; 3 yer anlaşılamadı.');
    await expect(page.getByTestId('yazi-try-larger')).toHaveCount(0);
  });

  test('where only the small model can run the numbers are said without advice that cannot be followed', async ({ page, context }) => {
    await openStep(page, context, { largeModel: false, stub: HALF_UNCLEAR });
    await page.getByTestId('model-download').click();
    await page.getByTestId('transcribe-start').click({ timeout: 120_000 });
    await expect(page.getByTestId('yazi-coverage')).toContainText('yaklaşık yüzde 50 kadarı yazıldı; 3 yer anlaşılamadı.', { timeout: 60_000 });
    await expect(page.getByTestId('yazi-try-larger')).toHaveCount(0);
    await expect(page.getByTestId('yazi-coverage')).not.toContainText('Önerilen');
  });

  test('a run that wrote nearly everything says nothing extra', async ({ page, context }) => {
    const nearlyAll = {
      stepMs: 20,
      segments: [
        { startUs: 1 * S, endUs: 20 * S, state: 'ok', words: [{ text: 'Almost', startUs: 1.2 * S, endUs: 1.8 * S }, { text: 'everything.', startUs: 1.9 * S, endUs: 2.6 * S }] },
        { startUs: 21 * S, endUs: 22 * S, state: 'unclear', words: [] },
      ],
    };
    await openStep(page, context, { largeModel: true, stub: nearlyAll });
    await page.getByTestId('option-model-base').check();
    await page.getByTestId('model-download').click();
    await page.getByTestId('transcribe-start').click({ timeout: 120_000 });
    await expect(page.getByTestId('yazi-summary')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('yazi-coverage')).toHaveCount(0);
    // The one place is still counted where it always was.
    await expect(page.getByTestId('transcript-machine-note')).toContainText('1 yer anlaşılamadı');
  });

  test('editor: the same sentence in the dialog, and "Önerilen modelle yeniden yaz" goes one step back in it', async ({ page, context }) => {
    const models = testModels();
    const server = await serveModels(context, models);
    await installTranscriptTest(page, models, HALF_UNCLEAR, { largeModel: true });
    await page.goto('/editor');
    await page.getByTestId('video-input').setInputFiles(SAMPLE);
    await expect(page.getByTestId('preview-video')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('open-more').click();
    await page.getByTestId('open-transcribe').click();
    await expect(page.getByRole('dialog')).toContainText('Videoyu yazıya dök');
    await page.getByTestId('option-model-base').check();
    await page.getByTestId('model-download').click();
    await page.getByTestId('transcribe-start').click({ timeout: 120_000 });
    await expect(page.getByTestId('transcribe-coverage')).toContainText('Bulunan konuşmanın yaklaşık yüzde 50 kadarı yazıldı; 3 yer anlaşılamadı.', { timeout: 60_000 });
    const before = server.requests.length;
    await page.getByTestId('transcribe-try-larger').click();
    await expect(page.getByTestId('option-model-turbo')).toBeChecked();
    await expect(page.getByTestId('model-download')).toHaveText('İndirmeye devam et (kalan ≈900 KB)');
    expect(server.requests.length).toBe(before);
    // Once the model is here the step says that the lines written a moment ago will be replaced.
    await page.getByTestId('model-download').click();
    await expect(page.getByTestId('transcribe-replace-note')).toBeVisible({ timeout: 120_000 });
  });
});
