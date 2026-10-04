import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

import { watchCsp } from './cspWatch';
import { installSavePicker, probeMp4, readSaved } from './kesitFlow';
import {
  BIG_BYTES,
  STUB_LINES,
  STUB_SCRIPT,
  expectTestBuild,
  installTranscriptTest,
  lineTexts,
  panelLines,
  serveModels,
  testModels,
} from './transcriptKit';
import { wizardFixture } from './wizard-media';

/**
 * "Yazıya dök" (ADR-036) through the UI, from the card to the saved files.
 *
 * The recogniser here is the scripted stand-in and the model files are the
 * kit's tiny ones (see transcriptKit.ts): what is under test is everything
 * around the model — the explicit download with real progress, the sha256
 * refusal, resume, the wizard's steps, the panel, the files it saves, cut by
 * text. The real model is run in transcript-real.spec.ts.
 */

const SAMPLE = join(process.cwd(), 'tests', 'media', 'sample-24s.mp4'); // 1280×720, H.264 + AAC, 24 s

test.describe.configure({ timeout: 300_000 });
test.use({ storageState: { cookies: [], origins: [] } });

const wizard = (page: Page) => page.getByTestId('wizard');
const title = (page: Page) => page.getByTestId('wizard-title');

async function openWizard(page: Page, file = SAMPLE) {
  await page.goto('/');
  await page.getByTestId('task-yazi').click();
  await expect(wizard(page)).toHaveAttribute('data-step', 'pick');
  await page.getByTestId('video-input').setInputFiles(file);
  await expectTestBuild(page);
}

async function downloadModel(page: Page) {
  await page.getByTestId('model-download').click();
  await expect(page.getByTestId('transcribe-start')).toBeVisible({ timeout: 120_000 });
}

async function transcribe(page: Page) {
  await page.getByTestId('transcribe-start').click();
  await expect(page.getByTestId('transcript-panel')).toBeVisible({ timeout: 60_000 });
}

/** Clicks a control that saves a small text file and returns what was saved. */
async function savedText(page: Page, testId: string): Promise<{ name: string; text: string }> {
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId(testId).click()]);
  const path = await download.path();
  return { name: download.suggestedFilename(), text: readFileSync(path, 'utf8') };
}

test.describe('Yazıya dök: the wizard', () => {
  test('card → video → explicit model download → Yazıya dök → the transcript and its four ways out', async ({
    page,
    context,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const models = testModels();
    const server = await serveModels(context, models);
    await installTranscriptTest(page, models);
    await installSavePicker(page);

    // The card exists and says what it is.
    await page.goto('/');
    await expect(page.getByTestId('task-yazi')).toContainText('Yazıya dök');
    await openWizard(page);
    await expect(page.getByTestId('wizard-step')).toContainText('Yazıya dök · Adım 2 / 3');
    await expect(title(page)).toHaveText('Videonu yazıya dökelim');

    // Said plainly before anything starts: English only, on this device.
    await expect(page.getByTestId('transcribe-english')).toContainText('Şimdilik yalnızca İngilizce konuşmaları yazıya döker.');
    await expect(page.getByTestId('transcribe-english')).toContainText('videon ve sesin hiçbir yere gönderilmez');

    // The model is NOT fetched by itself: no request for it until the button is pressed.
    await expect(page.getByTestId('model-download')).toBeVisible();
    expect(server.requests).toEqual([]);
    // Its real size is on the button (the kit's files: 360 KB).
    await expect(page.getByTestId('model-download')).toHaveText('Modeli indir (≈360 KB, bir kez)');
    expect(models.totalBytes('base')).toBe(360_013);
    await expect(page.getByTestId('transcribe-start')).toHaveCount(0);
    // No download and no editor link while there is nothing to download.
    await expect(page.getByTestId('wizard-download')).toHaveCount(0);

    await downloadModel(page);
    // Every file was asked for once, from this site.
    expect(server.requests.map((request) => request.key).sort()).toEqual(
      ['base-test/config.json', 'base-test/onnx/encoder.onnx', 'runtime-test/runtime.wasm', 'vad-test/onnx/model.onnx'].sort(),
    );
    await expect(page.getByTestId('transcribe-steps')).toHaveAttribute('data-model-ready', 'true');

    // "Yazıya dök": progress in real counts, then the result.
    await page.getByTestId('transcribe-start').click();
    await expect(page.getByTestId('transcribe-running')).toBeVisible();
    await expect(page.getByTestId('transcribe-phase')).toContainText(/Yazılıyor: \d \/ 4 konuşma parçası/, { timeout: 30_000 });
    const bar = page.getByTestId('transcribe-running').getByRole('progressbar');
    await expect(bar).toHaveAttribute('aria-valuemax', '4');
    await expect(page.getByTestId('transcript-panel')).toBeVisible({ timeout: 60_000 });

    // The result: the lines, the unclear span in its place, the honest label.
    expect(await lineTexts(page)).toEqual(STUB_LINES);
    await expect(page.getByTestId('transcript-count')).toHaveText('(5)');
    await expect(page.getByTestId('transcript-machine-note')).toContainText('Otomatik yazıldı — yanlış olabilir, düzeltebilirsin.');
    await expect(page.getByTestId('transcript-machine-note')).toContainText('1 yer anlaşılamadı');
    await expect(page.getByTestId('yazi-summary')).toContainText('4 satır yazıldı');
    await expect(panelLines(page).nth(1)).toHaveAttribute('data-kind', 'unclear');
    await expect(panelLines(page).first().locator('.transcript-time')).toHaveText('0:01');

    // A line is a button: it moves the video to its moment.
    await panelLines(page).nth(2).getByTestId('transcript-line').click();
    await expect
      .poll(() => page.getByTestId('wizard-video').evaluate((video: HTMLVideoElement) => video.currentTime))
      .toBeCloseTo(9.2, 1);
    await expect(panelLines(page).nth(2)).toHaveAttribute('data-active', 'true');
    await expect(panelLines(page).nth(2).getByTestId('transcript-line')).toHaveAttribute('aria-current', 'true');

    // "Metni indir": time-stamped text, the unclear span in words.
    const txt = await savedText(page, 'transcript-save-txt');
    expect(txt.name).toBe('sample-24s_yazi.txt');
    expect(txt.text.split('\r\n')).toEqual([
      'Clip ile bu cihazda otomatik yazıldı — yanlış olabilir.',
      '',
      '[00:01] Hello and welcome to the show.',
      '[00:06] (anlaşılamadı)',
      '[00:09] Today we cut a video by its text,',
      '[00:12] which is the fastest way to find a moment.',
      '[00:18] Thanks for watching.',
      '',
    ]);

    // SRT and VTT: the same lines, on the whole video's clock; the unclear span is not a subtitle.
    const srt = await savedText(page, 'transcript-save-srt');
    expect(srt.name).toBe('sample-24s_altyazi.srt');
    expect(srt.text.replace(/\r\n/g, '\n')).toContain('1\n00:00:01,100 --> 00:00:03,320\nHello and welcome to the show.\n');
    expect(srt.text).toContain('Hello and welcome to the show.');
    expect(srt.text).toContain('Thanks for watching.');
    expect(srt.text).not.toContain('anlaşılamadı');
    expect((srt.text.match(/-->/g) ?? []).length).toBe(4);
    const vtt = await savedText(page, 'transcript-save-vtt');
    expect(vtt.name).toBe('sample-24s_altyazi.vtt');
    expect(vtt.text.startsWith('WEBVTT')).toBe(true);
    expect((vtt.text.match(/-->/g) ?? []).length).toBe(4);

    // "Altyazılı videoyu indir": the wizard's download, the lines burned in.
    await expect(page.getByTestId('wizard-download')).toHaveText('Altyazılı videoyu indir');
    await page.getByTestId('wizard-download').click();
    await expect(page.getByTestId('download-saved')).toBeVisible({ timeout: 240_000 });
    await expect(page.getByTestId('download-saved')).toHaveText('Kaydedildi: saved-sample-24s_altyazili.mp4');
    const saved = await readSaved(page, test.info(), 'saved-sample-24s_altyazili.mp4');
    const probe = probeMp4(saved);
    expect(probe.videoCodec).toBe('h264');
    expect(probe.durationS).toBeCloseTo(24, 0);

    expect(errors).toEqual([]);
  });

  test('a line can be corrected in place and an unclear span typed by hand; both undo in the editor', async ({
    page,
    context,
  }) => {
    const models = testModels();
    await serveModels(context, models);
    await installTranscriptTest(page, models);
    await openWizard(page);
    await downloadModel(page);
    await transcribe(page);

    // Fix a wrong word: the pencil, type, Enter.
    await panelLines(page).first().getByTestId('transcript-edit').click();
    const field = page.getByTestId('transcript-field');
    await expect(field).toBeFocused();
    await expect(field).toHaveValue('Hello and welcome to the show.');
    await field.fill('Hello and welcome to our show.');
    await field.press('Enter');
    await expect(panelLines(page).first().locator('.transcript-text')).toHaveText('Hello and welcome to our show.');
    await expect(panelLines(page).first().getByTestId('transcript-line')).toBeFocused();

    // A refusal is said, and the old text is kept: an empty line is not a line.
    await panelLines(page).first().getByTestId('transcript-edit').click();
    await field.fill('   ');
    await page.getByTestId('transcript-save').click();
    await expect(page.getByTestId('transcript-edit-error')).toContainText('Satır boş kalamaz');
    await field.press('Escape');
    await expect(panelLines(page).first().locator('.transcript-text')).toHaveText('Hello and welcome to our show.');

    // The span that could not be written: listen, then type it.
    await panelLines(page).nth(1).getByTestId('transcript-edit').click();
    await expect(field).toHaveValue('');
    await field.fill('I typed this one myself.');
    await page.getByTestId('transcript-save').click();
    await expect(panelLines(page).nth(1)).toHaveAttribute('data-kind', 'cue');
    await expect(panelLines(page).nth(1).locator('.transcript-text')).toHaveText('I typed this one myself.');
    await expect(page.getByTestId('transcript-machine-note')).not.toContainText('anlaşılamadı');

    // The same recipe in the editor: the text tab is in front, and undo steps back through the edits.
    await page.getByTestId('wizard-open-editor').click();
    await expect(page.getByTestId('preview-video')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('side-tab-yazi')).toHaveAttribute('aria-selected', 'true');
    expect(await lineTexts(page)).toEqual([
      'Hello and welcome to our show.',
      'I typed this one myself.',
      'Today we cut a video by its text,',
      'which is the fastest way to find a moment.',
      'Thanks for watching.',
    ]);
    await page.getByTestId('undo').click();
    expect((await lineTexts(page))[1]).toBe('(anlaşılamadı)');
    await page.getByTestId('undo').click();
    expect((await lineTexts(page))[0]).toBe('Hello and welcome to the show.');
  });

  test('a video without sound is told so; no model is asked for', async ({ page, context }) => {
    const models = testModels();
    const server = await serveModels(context, models);
    await installTranscriptTest(page, models);
    await page.goto('/yap/yazi');
    await page.getByTestId('video-input').setInputFiles(wizardFixture('noAudio'));
    await expect(page.getByTestId('yazi-no-sound')).toHaveText('Bu videoda ses yok; yazıya dökülecek bir konuşma yok.');
    await expect(page.getByTestId('model-download')).toHaveCount(0);
    await expect(page.getByTestId('wizard-download')).toHaveCount(0);
    expect(server.requests).toEqual([]);
  });

  test('nothing heard is a result that is said, not an empty success', async ({ page, context }) => {
    const models = testModels();
    await serveModels(context, models);
    await installTranscriptTest(page, models, { segments: [], stepMs: 10 });
    await openWizard(page);
    await downloadModel(page);
    await page.getByTestId('transcribe-start').click();
    await expect(page.getByTestId('transcribe-failed')).toHaveText('Bu videoda konuşma bulunamadı; yazılacak bir şey çıkmadı.');
    await expect(page.getByTestId('transcript-panel')).toHaveCount(0);
    await expect(page.getByTestId('wizard-download')).toHaveCount(0);
  });

  test('only unclear spans: they are shown, and no subtitle download is offered', async ({ page, context }) => {
    const models = testModels();
    await serveModels(context, models);
    await installTranscriptTest(page, models, {
      stepMs: 10,
      segments: [
        { startUs: 2_000_000, endUs: 6_000_000, state: 'unclear', words: [] },
        { startUs: 10_000_000, endUs: 12_000_000, state: 'unclear', words: [] },
      ],
    });
    await openWizard(page);
    await downloadModel(page);
    await transcribe(page);
    expect(await lineTexts(page)).toEqual(['(anlaşılamadı)', '(anlaşılamadı)']);
    await expect(page.getByTestId('wizard-blocked')).toHaveText('Yazılabilen bir satır çıkmadı; altyazılı video hazırlanamaz.');
    await expect(page.getByTestId('wizard-download')).toBeDisabled();
    await expect(page.getByTestId('transcript-save-srt')).toBeDisabled();
    await expect(page.getByTestId('transcript-save-txt')).toBeEnabled();
  });

  test('stopping a transcription keeps nothing; a failure is said and can be retried', async ({ page, context }) => {
    const models = testModels();
    await serveModels(context, models);
    await installTranscriptTest(page, models, { ...STUB_SCRIPT, stepMs: 1500 });
    await openWizard(page);
    await downloadModel(page);
    await page.getByTestId('transcribe-start').click();
    await expect(page.getByTestId('transcribe-running')).toBeVisible();
    await page.getByTestId('transcribe-stop').click();
    await expect(page.getByTestId('transcribe-running')).toHaveCount(0);
    await expect(page.getByTestId('transcript-panel')).toHaveCount(0);
    await expect(page.getByTestId('transcribe-start')).toHaveText('Yazıya dök');

    // A run that fails half-way: the reason, no partial transcript, "Tekrar dene".
    await page.evaluate(() => {
      const hook = (window as unknown as { __clipTranscriptTest: { stub: { failWith?: string; stepMs: number } } }).__clipTranscriptTest;
      hook.stub.failWith = 'out_of_memory';
      hook.stub.stepMs = 20;
    });
    await page.getByTestId('transcribe-start').click();
    await expect(page.getByTestId('transcribe-failed')).toContainText('Bellek yetmedi');
    await expect(page.getByTestId('transcript-panel')).toHaveCount(0);
    await expect(page.getByTestId('transcribe-start')).toHaveText('Tekrar dene');
  });
});

test.describe('Yazıya dök: the model download', () => {
  test('a damaged file is refused, deleted and never used; a clean retry works', async ({ page, context }) => {
    const models = testModels();
    const server = await serveModels(context, models);
    server.behave('base-test/onnx/encoder.onnx', 'corrupt');
    await installTranscriptTest(page, models);
    await openWizard(page);
    await page.getByTestId('model-download').click();
    await expect(page.getByTestId('model-failed')).toHaveAttribute('data-reason', 'hash_mismatch');
    await expect(page.getByTestId('model-failed')).toHaveText('İndirilen dosya bozuk çıktı; silindi ve kullanılmadı. Tekrar dene.');
    // Not usable: no "Yazıya dök", and the damaged bytes are not in the store.
    await expect(page.getByTestId('transcribe-start')).toHaveCount(0);
    const stored = await page.evaluate(async () => {
      const cache = await caches.open('clip-models-v1');
      return (await cache.keys()).map((request) => new URL(request.url).pathname + new URL(request.url).search);
    });
    expect(stored.filter((key) => key.includes('encoder.onnx'))).toEqual([]);
    // The files that were fine are kept: the button now says what is left.
    await expect(page.getByTestId('model-download')).toHaveText('İndirmeye devam et (kalan ≈300 KB)');

    server.behave('base-test/onnx/encoder.onnx', 'ok');
    server.requests.length = 0;
    await downloadModel(page);
    // Only the refused file is fetched again.
    expect(server.requests.map((request) => request.key)).toEqual(['base-test/onnx/encoder.onnx']);
  });

  test('a dropped connection keeps the parts it has; the next try continues with the missing part', async ({
    page,
    context,
  }) => {
    const models = testModels({ big: true });
    const server = await serveModels(context, models);
    server.behave('base-test/onnx/encoder.onnx', 'abort-second-part');
    await installTranscriptTest(page, models);
    await openWizard(page);
    await page.getByTestId('model-download').click();
    await expect(page.getByTestId('model-failed')).toHaveAttribute('data-reason', 'offline', { timeout: 120_000 });
    await expect(page.getByTestId('model-failed')).toContainText('kaldığı yerden devam eder');
    // The large file was asked for in parts (HTTP Range), and its first part is stored.
    const ranges = server.requests.filter((request) => request.key === 'base-test/onnx/encoder.onnx').map((request) => request.range);
    expect(ranges).toEqual([`bytes=0-${32 * 1024 * 1024 - 1}`, `bytes=${32 * 1024 * 1024}-${BIG_BYTES - 1}`]);

    server.behave('base-test/onnx/encoder.onnx', 'ok');
    server.requests.length = 0;
    await page.getByTestId('model-download').click();
    await expect(page.getByTestId('transcribe-start')).toBeVisible({ timeout: 120_000 });
    // Resumed: only the second part travels again; the whole file then passed its sha256.
    expect(server.requests).toEqual([{ key: 'base-test/onnx/encoder.onnx', range: `bytes=${32 * 1024 * 1024}-${BIG_BYTES - 1}` }]);
    await transcribe(page);
    expect(await lineTexts(page)).toEqual(STUB_LINES);
  });

  test('a host that ignores Range still gives a verified file', async ({ page, context }) => {
    const models = testModels({ big: true });
    const server = await serveModels(context, models);
    server.behave('base-test/onnx/encoder.onnx', 'ignore-range');
    await installTranscriptTest(page, models);
    await openWizard(page);
    await downloadModel(page);
    await expect(page.getByTestId('transcribe-steps')).toHaveAttribute('data-model-ready', 'true');
  });

  test('a missing file is said; "Durdur" stops a download and keeps the button', async ({ page, context }) => {
    const models = testModels();
    const server = await serveModels(context, models);
    server.behave('vad-test/onnx/model.onnx', 'not-found');
    await installTranscriptTest(page, models);
    await openWizard(page);
    await page.getByTestId('model-download').click();
    await expect(page.getByTestId('model-failed')).toHaveText('Model dosyası bu sitede bulunamadı. Biraz sonra tekrar dene.');
    await expect(page.getByTestId('model-download')).toBeVisible();
  });

  test('the model survives a reload, is listed on the privacy page, and "Modeli sil" removes it', async ({
    page,
    context,
  }) => {
    const models = testModels();
    const server = await serveModels(context, models);
    await installTranscriptTest(page, models);
    await openWizard(page);
    await downloadModel(page);

    // A new visit: the model is there, nothing is fetched, "Yazıya dök" is ready at once.
    server.requests.length = 0;
    await page.goto('/yap/yazi');
    await page.getByTestId('video-input').setInputFiles(SAMPLE);
    await expect(page.getByTestId('transcribe-start')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('model-download')).toHaveCount(0);
    expect(server.requests).toEqual([]);

    // It is in a cache of its own, not in the app's offline cache.
    const caching = await page.evaluate(async () => {
      const names = await caches.keys();
      const inApp: string[] = [];
      for (const name of names.filter((item) => item.startsWith('clip-app-'))) {
        for (const request of await (await caches.open(name)).keys()) if (request.url.includes('/models/')) inApp.push(request.url);
      }
      return { names: names.filter((name) => name.startsWith('clip-models-')), inApp };
    });
    expect(caching.names).toEqual(['clip-models-v1']);
    expect(caching.inApp).toEqual([]);

    // The privacy page says what is stored, how much, and deletes it.
    await page.goto('/gizlilik');
    const card = page.getByTestId('stored-model');
    await expect(card).toContainText('Konuşma modeli');
    await expect(card).toContainText('clip-models-');
    await expect(page.getByTestId('model-storage-size')).toContainText('360 KB');
    await page.getByTestId('model-delete').click();
    await expect(page.getByTestId('model-storage-message')).toHaveText('Model silindi.');
    await expect(page.getByTestId('model-storage-size')).toHaveText('Bu tarayıcıda konuşma modeli yok.');
    expect(await page.evaluate(async () => (await caches.keys()).filter((name) => name.startsWith('clip-models-')))).toEqual([]);

    // Back in the wizard the model has to be downloaded again.
    await page.goto('/yap/yazi');
    await page.getByTestId('video-input').setInputFiles(SAMPLE);
    await expect(page.getByTestId('model-download')).toHaveText('Modeli indir (≈360 KB, bir kez)');
  });
});

test.describe('Yazıya dök: the transcript panel in the editor', () => {
  async function editorWithTranscript(page: Page, context: Parameters<typeof serveModels>[0]) {
    const models = testModels();
    await serveModels(context, models);
    await installTranscriptTest(page, models);
    await page.goto('/editor');
    await page.getByTestId('video-input').setInputFiles(SAMPLE);
    await expect(page.getByTestId('preview-video')).toBeVisible({ timeout: 60_000 });
    // "Diğer" → "Videoyu yazıya dök": the same steps, in a dialog.
    await page.getByTestId('open-more').click();
    await page.getByTestId('open-transcribe').click();
    await expectTestBuild(page);
    await expect(page.getByRole('dialog')).toContainText('Videoyu yazıya dök');
    await page.getByTestId('model-download').click();
    await expect(page.getByTestId('transcribe-start')).toBeVisible({ timeout: 120_000 });
    await page.getByTestId('transcribe-start').click();
    await expect(page.getByTestId('transcribe-done')).toContainText('4 satır yazıldı', { timeout: 60_000 });
    await page.getByTestId('transcribe-close').click();
    await expect(page.getByTestId('transcript-panel')).toBeVisible();
  }

  test('"Videoyu yazıya dök" fills the Yazı tab; the keyboard walks, seeks and selects; lines become kesitler in one undo step', async ({
    page,
    context,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await editorWithTranscript(page, context);

    await expect(page.getByTestId('side-tab-yazi')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('side-tab-yazi')).toHaveText('Yazı (5)');
    await expect(page.getByTestId('side-tab-kesit')).toHaveText('Kesitler (0)');
    expect(await lineTexts(page)).toEqual(STUB_LINES);
    // A proper list, named by its heading.
    const list = page.getByRole('list', { name: /Yazı/ });
    await expect(list.getByRole('listitem')).toHaveCount(5);

    // One Tab stop; arrows move between lines; Enter jumps the video there.
    const lineButton = (index: number) => panelLines(page).nth(index).getByTestId('transcript-line');
    await lineButton(0).focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(lineButton(2)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect.poll(async () => Number(await page.getByTestId('source-time-us').textContent())).toBe(9200);
    await expect(panelLines(page).nth(2)).toHaveAttribute('data-active', 'true');
    await page.keyboard.press('End');
    await expect(lineButton(4)).toBeFocused();
    await page.keyboard.press('Home');
    await expect(lineButton(0)).toBeFocused();
    // Only the current line is a Tab stop: Tab from it leaves the 5 lines behind in at most its own controls.
    expect(await page.locator('[data-testid="transcript-list"] [tabindex="0"]').count()).toBe(3);

    // Select with the keyboard: Space on the tick box, arrow down, Space again.
    const check = (index: number) => panelLines(page).nth(index).getByTestId('transcript-check');
    await check(0).focus();
    await page.keyboard.press('Space');
    await check(2).focus();
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowDown');
    await expect(check(3)).toBeFocused();
    await page.keyboard.press('Space');
    await expect(page.getByTestId('transcript-selected-count')).toHaveText('3 satır seçili');

    // "Bunlardan kesit yap": the two neighbours are one kesit; the line apart (an unticked line between) its own.
    await page.getByTestId('transcript-make-kesit').click();
    await expect(page.getByTestId('transcript-status')).toHaveText('2 kesit eklendi. Geri al ile vazgeçebilirsin.');
    await expect(page.getByTestId('side-tab-kesit')).toHaveText('Kesitler (2)');
    await expect(page.getByTestId('transcript-selected-count')).toHaveText('Kesit yapmak için satırları işaretle.');
    await page.getByTestId('side-tab-kesit').click();
    const ranges = await page.getByTestId('kesit-range').allTextContents();
    // Each from 0.15 s before its first word to where its last line leaves the screen
    // (0.95–3.32 s and 9.05–15.27 s; the exact microseconds are unit-tested).
    expect(ranges).toEqual(['00:00 → 00:03', '00:09 → 00:15']);
    expect(await page.getByTestId('kesit-length').allTextContents()).toEqual(['Süre 2,3 sn', 'Süre 6,2 sn']);

    // One undo step takes both kesitler back.
    await page.getByTestId('undo').click();
    await expect(page.getByTestId('side-tab-kesit')).toHaveText('Kesitler (0)');
    await page.getByTestId('redo').click();
    await expect(page.getByTestId('side-tab-kesit')).toHaveText('Kesitler (2)');

    expect(errors).toEqual([]);
  });

  test('the spoken line follows playback without moving focus, and stops following when the reader scrolls', async ({
    page,
    context,
  }) => {
    await editorWithTranscript(page, context);
    const video = page.getByTestId('preview-video');
    // Focus sits on a control outside the list while the video plays.
    await page.getByTestId('side-tab-yazi').focus();
    await video.evaluate((element: HTMLVideoElement) => {
      element.muted = true;
      element.currentTime = 17.8;
    });
    await page.getByTestId('play-toggle').click();
    await expect(panelLines(page).nth(4)).toHaveAttribute('data-active', 'true', { timeout: 20_000 });
    await expect(panelLines(page).filter({ has: page.locator('[aria-current="true"]') })).toHaveCount(1);
    await page.getByTestId('play-toggle').click();
    // Focus was not taken by the list.
    expect(await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))).toBe('play-toggle');

    // Walking the list with the keyboard stops the following; "Şimdiye dön" resumes it.
    await panelLines(page).first().getByTestId('transcript-line').focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('transcript-follow')).toHaveText('Şimdiye dön');
    await page.getByTestId('transcript-follow').click();
    await expect(page.getByTestId('transcript-follow')).toHaveCount(0);
  });

  test('more lines than the kesit limit: nothing is added and the room is said', async ({ page, context }) => {
    const models = testModels();
    await serveModels(context, models);
    // 22 short stretches, each its own line, far enough apart not to be joined.
    const segments = Array.from({ length: 22 }, (_, index) => ({
      startUs: index * 1_000_000,
      endUs: index * 1_000_000 + 450_000,
      state: 'ok',
      words: [{ text: `Line${index + 1}.`, startUs: index * 1_000_000 + 50_000, endUs: index * 1_000_000 + 400_000 }],
    }));
    await installTranscriptTest(page, models, { segments, stepMs: 5 });
    await page.goto('/editor');
    await page.getByTestId('video-input').setInputFiles(SAMPLE);
    await expect(page.getByTestId('preview-video')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('open-more').click();
    await page.getByTestId('open-transcribe').click();
    await page.getByTestId('model-download').click();
    await page.getByTestId('transcribe-start').click();
    await page.getByTestId('transcribe-close').click();
    await expect(page.getByTestId('transcript-count')).toHaveText('(22)');
    // Every other line: 11 selections that are not neighbours… then all 22 as separate picks is 1 kesit; pick odd ones.
    for (let index = 0; index < 22; index += 2) await panelLines(page).nth(index).getByTestId('transcript-check').click();
    await page.getByTestId('transcript-make-kesit').click();
    await expect(page.getByTestId('transcript-status')).toHaveText('11 kesit eklendi. Geri al ile vazgeçebilirsin.');
    for (let index = 1; index < 22; index += 2) await panelLines(page).nth(index).getByTestId('transcript-check').click();
    await page.getByTestId('transcript-make-kesit').click();
    await expect(page.getByTestId('transcript-status')).toContainText('Seçtiklerin 11 kesit ediyor ama yalnızca 9 kesit daha sığıyor');
    await expect(page.getByTestId('side-tab-kesit')).toHaveText('Kesitler (11)');
  });
});

test.describe('Yazıya dök: policy and network', () => {
  test('the whole flow makes no request outside this site and breaks no policy', async ({ page, context }) => {
    const models = testModels();
    await serveModels(context, models);
    const watch = await watchCsp(context);
    await watch.attach(page);
    const origin = new URL(test.info().project.use.baseURL ?? 'http://127.0.0.1').origin;
    const outside: string[] = [];
    context.on('request', (request) => {
      const url = request.url();
      if (!url.startsWith(origin) && !url.startsWith('blob:') && !url.startsWith('data:')) outside.push(url);
    });
    await installTranscriptTest(page, models);
    await installSavePicker(page);
    await openWizard(page);
    await downloadModel(page);
    await transcribe(page);
    await page.getByTestId('wizard-download').click();
    await expect(page.getByTestId('download-saved')).toBeVisible({ timeout: 240_000 });
    expect(watch.violations).toEqual([]);
    expect(outside).toEqual([]);
  });
});
