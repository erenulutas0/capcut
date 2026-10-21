import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { inspectGif, type GifInspection } from '../../src/domain/gifInspect';
import { expect, test, type Page } from './fixtures';
import { installSavePicker, noSavePicker, opfsFiles, pickerCalls, readSaved } from './kesitFlow';
import { wizardFixture } from './wizard-media';
import { SECRETS, diagnosticsFrom, fault, nextFault, watchLogs } from './workerFaultKit';

/**
 * "GIF yap" (ADR-046), from the opening screen to the saved file: the card,
 * the video, the one screen (the part, the text, the size), "GIF'i indir".
 * The saved file is read back with rules of our own (`inspectGif`: header,
 * frames, size, loop block) AND decoded by ffmpeg, which knows nothing about
 * our encoder.
 */

const SAMPLE = join(process.cwd(), 'tests', 'media', 'sample-24s.mp4'); // 1280×720, 24 s
const OTHER = join(process.cwd(), 'tests', 'media', 'other-8s.mp4'); // 640×360, 8 s
const MUSIC = join(process.cwd(), 'tests', 'media', 'tone-30s.m4a');
const FUZZ = join(process.cwd(), 'tests', 'media', 'fuzz');

test.describe.configure({ timeout: 240_000 });
test.use({ storageState: { cookies: [], origins: [] } });

const estimate = (page: Page) => page.getByTestId('gif-estimate');
let copies = 0;

async function openGif(page: Page, file: string) {
  await page.goto('/');
  await page.getByTestId('task-gif').click();
  await expect(page.getByTestId('wizard')).toHaveAttribute('data-step', 'pick');
  await page.getByTestId('video-input').setInputFiles(file);
  await expect(page.getByTestId('wizard')).toHaveAttribute('data-step', 'choose', { timeout: 60_000 });
  await expect(estimate(page)).toHaveAttribute('data-state', 'ready', { timeout: 60_000 });
}

async function saveGif(page: Page, testInfo: Parameters<Parameters<typeof test>[1]>[1], name: string): Promise<{ path: string; gif: GifInspection; bytes: number }> {
  await page.getByTestId('wizard-download').click();
  await expect(page.getByTestId('download-saved')).toHaveText(`Kaydedildi: saved-${name}`, { timeout: 120_000 });
  const saved = await readSaved(page, testInfo, `saved-${name}`);
  const bytes = readFileSync(saved);
  // A copy of its own: the next GIF of the same video is saved under the same name.
  const path = testInfo.outputPath(`${++copies}-${name}`);
  writeFileSync(path, bytes);
  const inspected = inspectGif(new Uint8Array(bytes));
  expect(inspected.ok, JSON.stringify(inspected)).toBe(true);
  if (!inspected.ok) throw new Error(inspected.reason);
  return { path, gif: inspected.gif, bytes: bytes.length };
}

/** ffmpeg's own reading of the GIF: frame count, size. */
function ffprobeGif(file: string): { frames: number; width: number; height: number } {
  const out = spawnSync(
    'ffprobe',
    ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames,width,height', '-of', 'json', file],
    { encoding: 'utf8' },
  );
  const stream = (JSON.parse(out.stdout) as { streams: { nb_read_frames: string; width: number; height: number }[] }).streams[0];
  return { frames: Number(stream?.nb_read_frames), width: stream?.width ?? 0, height: stream?.height ?? 0 };
}

/** The first frame as RGB, decoded by ffmpeg. */
function firstFrame(file: string): Buffer {
  return spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { maxBuffer: 1 << 26 }).stdout;
}

/** Mean absolute difference of two RGB frames over the rows [y0, y1). */
function bandDiff(a: Buffer, b: Buffer, width: number, y0: number, y1: number): number {
  let sum = 0;
  for (let i = y0 * width * 3; i < y1 * width * 3; i += 1) sum += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
  return sum / ((y1 - y0) * width * 3);
}

test.beforeEach(async ({ page }) => {
  await installSavePicker(page);
});

test('card → video → text → GIF: a real looping GIF of the part, its text in the picture, about the size it said', async ({ page }, testInfo) => {
  const logs = watchLogs(page);
  await openGif(page, SAMPLE);
  await expect(page.getByTestId('wizard-title')).toHaveText('GIF yapalım');
  await expect(page.getByTestId('wizard-step')).toContainText('GIF yap · Adım 2 / 3');
  // One screen (mockup B): the preview with its two boxes, the part, the size, one button; no editor link.
  await expect(page.getByTestId('gif-video')).toBeVisible();
  await expect(page.getByLabel('Üst yazı')).toBeVisible();
  await expect(page.getByLabel('Alt yazı')).toBeVisible();
  await expect(page.getByTestId('gif-range-window')).toHaveAttribute('data-end-us', '4000000');
  await expect(page.getByTestId('wizard-open-editor')).toHaveCount(0);
  // "Orta" first where the video has it (founder's decision, 20 Oct 2026; ADR-046 addendum: on a phone "Küçük"
  // looked blurred). This test then makes the Küçük GIF on purpose: its text bands below are measured at 320 px.
  await expect(page.getByTestId('gif-size-medium')).toBeChecked();
  await expect(estimate(page)).toHaveAttribute('data-width', '480');
  await page.getByTestId('gif-size-small').check();
  await expect(page.getByTestId('gif-size-small')).toBeChecked();
  await expect(estimate(page)).toHaveAttribute('data-state', 'ready', { timeout: 60_000 });
  await expect(estimate(page)).toHaveText(/^4,0 sn · yaklaşık \d+(,\d)? (KB|MB)$/);
  await expect(estimate(page)).toHaveAttribute('data-frames', '50');
  await expect(estimate(page)).toHaveAttribute('data-width', '320');

  // No text first: the reference picture.
  const plain = await saveGif(page, testInfo, 'sample-24s_gif.gif');
  expect(await pickerCalls(page)).toEqual(['sample-24s_gif.gif']);
  await expect(page.getByTestId('wizard-title')).toHaveText('Kaydedildi');
  await expect(page.getByTestId('gif-result-line')).toContainText('4,0 sn · durmadan döner');

  // Back to the same screen, the same part: with text this time.
  await page.getByTestId('wizard-again-same').click();
  await expect(page.getByTestId('wizard')).toHaveAttribute('data-step', 'choose');
  await page.getByLabel('Üst yazı').fill('PAZARTESİ SABAHI ığüşöç');
  await expect(estimate(page)).toHaveAttribute('data-state', 'ready', { timeout: 60_000 });
  const estimated = Number(await estimate(page).getAttribute('data-bytes'));
  const withText = await saveGif(page, testInfo, 'sample-24s_gif.gif');

  for (const made of [plain, withText]) {
    expect(made.gif).toMatchObject({ width: 320, height: 180, frames: 50, loops: 0, durationCs: 400 });
    expect(new Set(made.gif.delaysCs)).toEqual(new Set([8]));
    // ffmpeg reads the same file the same way.
    expect(ffprobeGif(made.path)).toEqual({ frames: 50, width: 320, height: 180 });
  }
  // The honest estimate: measured, not guessed — within a quarter of the real size.
  const ratio = withText.bytes / estimated;
  console.log(`GIF-ESTIMATE ${JSON.stringify({ estimated, actual: withText.bytes, ratio })}`);
  expect(ratio).toBeGreaterThan(0.75);
  expect(ratio).toBeLessThan(1.33);

  // The text is IN the picture: the top band differs from the GIF without it; the middle does not.
  const a = firstFrame(plain.path);
  const b = firstFrame(withText.path);
  expect(a.length).toBe(320 * 180 * 3);
  const top = bandDiff(a, b, 320, 0, 45);
  const middle = bandDiff(a, b, 320, 70, 110);
  console.log(`GIF-TEXT-BANDS ${JSON.stringify({ top, middle })}`);
  expect(top).toBeGreaterThan(8);
  expect(middle).toBeLessThan(2);
  // White letters and a black edge: both pure colours are in the top band.
  let white = 0;
  let black = 0;
  for (let i = 0; i < 45 * 320 * 3; i += 3) {
    if (b[i] === 255 && b[i + 1] === 255 && b[i + 2] === 255) white += 1;
    if (b[i] === 0 && b[i + 1] === 0 && b[i + 2] === 0) black += 1;
  }
  expect(white).toBeGreaterThan(200);
  expect(black).toBeGreaterThan(200);
  expect(logs.pageErrors).toEqual([]);
});

test('ten seconds at most, said in words; "Orta" is 480 pixels; the part is the one chosen', async ({ page }, testInfo) => {
  await openGif(page, SAMPLE);
  // The end of the part as far as it goes, from the keyboard: it stops at ten seconds.
  await page.getByTestId('gif-range-end').focus();
  await page.keyboard.press('End');
  await expect(page.getByTestId('gif-max-length')).toHaveText('GIF en çok 10 saniye olabilir.');
  await expect(page.getByTestId('gif-range-window')).toHaveAttribute('data-end-us', '10000000');
  await expect(page.getByTestId('gif-range-end')).toHaveAttribute('aria-valuenow', '10');
  // Moved as a whole: from 6 s to 16 s.
  await page.getByTestId('gif-range-window').focus();
  for (let i = 0; i < 3; i += 1) await page.keyboard.press('Shift+ArrowRight');
  await expect(page.getByTestId('gif-range-window')).toHaveAttribute('data-start-us', '6000000');
  await expect(page.getByTestId('gif-range-window')).toHaveAttribute('data-end-us', '16000000');
  await page.getByTestId('gif-size-medium').check();
  await expect(estimate(page)).toHaveAttribute('data-state', 'ready', { timeout: 60_000 });
  await expect(estimate(page)).toHaveText(/^10,0 sn · yaklaşık/);
  await expect(estimate(page)).toHaveAttribute('data-width', '480');
  const started = Date.now();
  const made = await saveGif(page, testInfo, 'sample-24s_gif.gif');
  console.log(`GIF-TIME ${JSON.stringify({ seconds: 10, size: 'medium', ms: Date.now() - started, bytes: made.bytes })}`);
  expect(made.gif).toMatchObject({ width: 480, height: 270, frames: 125, loops: 0, durationCs: 1000 });
  expect(ffprobeGif(made.path)).toEqual({ frames: 125, width: 480, height: 270 });
  // The test pattern's counter shows the second: the first frame is from 6 s, not from the start.
  const shown = firstFrame(made.path);
  const atStart = spawnSync('ffmpeg', ['-v', 'error', '-ss', '6.0', '-i', SAMPLE, '-frames:v', '1', '-vf', 'scale=480:270:flags=area', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { maxBuffer: 1 << 26 }).stdout;
  const atZero = spawnSync('ffmpeg', ['-v', 'error', '-ss', '0', '-i', SAMPLE, '-frames:v', '1', '-vf', 'scale=480:270:flags=area', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { maxBuffer: 1 << 26 }).stdout;
  expect(bandDiff(shown, atStart, 480, 0, 270)).toBeLessThan(bandDiff(shown, atZero, 480, 0, 270));
});

test('a small video has one size, its own; the GIF is never larger than the video', async ({ page }, testInfo) => {
  await openGif(page, OTHER);
  // 640 × 360: Küçük 320, Orta 480, Büyük 640 — Büyük is the video's own size, not more (ADR-041).
  await expect(page.getByTestId('gif-size')).toBeVisible();
  await expect(page.getByTestId('gif-size').getByRole('radio')).toHaveCount(3);
  await expect(page.getByTestId('gif-size-hint')).toHaveText('Büyüdükçe GIF telefonda daha net görünür; dosyası da büyür.');
  await page.getByTestId('gif-size-medium').check();
  await expect(estimate(page)).toHaveAttribute('data-state', 'ready', { timeout: 60_000 });
  await expect(estimate(page)).toHaveAttribute('data-width', '480');
  const made = await saveGif(page, testInfo, 'other-8s_gif.gif');
  expect(made.gif).toMatchObject({ width: 480, height: 270, frames: 100 });

  // 320 × 240: Küçük is already the video's own size — no choice, and the screen says why.
  await page.getByTestId('wizard-again').click();
  await page.getByTestId('video-input').setInputFiles(wizardFixture('noAudio'));
  await expect(page.getByTestId('wizard')).toHaveAttribute('data-step', 'choose', { timeout: 60_000 });
  await expect(page.getByTestId('gif-one-size')).toBeVisible();
  await expect(page.getByTestId('gif-size')).toHaveCount(0);
  await expect(estimate(page)).toHaveAttribute('data-state', 'ready', { timeout: 60_000 });
  await expect(estimate(page)).toHaveAttribute('data-width', '320');
  await expect(estimate(page)).toHaveAttribute('data-height', '240');
});

test('over 10 MB: said in plain words under the size, never blocked; gone again on "Küçük"', async ({ page }) => {
  await openGif(page, wizardFixture('grainy')); // 640 × 360, 10 s of heavy grain: taken whole
  await page.getByTestId('gif-size-large').check();
  await expect(estimate(page)).toHaveAttribute('data-state', 'ready', { timeout: 60_000 });
  await expect(estimate(page)).toHaveAttribute('data-width', '640');
  const bytes = Number(await estimate(page).getAttribute('data-bytes'));
  console.log(`GIF-LARGE-WARNING ${JSON.stringify({ bytes })}`);
  expect(bytes).toBeGreaterThan(10_000_000);
  await expect(page.getByTestId('gif-too-large')).toHaveText(
    'Bu GIF 10 MB’tan büyük olacak; bazı uygulamalar kabul etmeyebilir. Küçük seçebilir ya da süreyi kısaltabilirsin.',
  );
  await expect(page.getByTestId('wizard-download')).toBeEnabled();
  await page.getByTestId('gif-size-small').check();
  await expect(estimate(page)).toHaveAttribute('data-state', 'ready', { timeout: 60_000 });
  expect(Number(await estimate(page).getAttribute('data-bytes'))).toBeLessThanOrEqual(10_000_000);
  await expect(page.getByTestId('gif-too-large')).toHaveCount(0);
});

test('"Büyük" (ADR-046 addendum): a phone video at 360 × 640 — twice as wide on a phone as "Küçük" — about the size it said', async ({ page }, testInfo) => {
  await openGif(page, wizardFixture('vertical')); // 360 × 640, 2 s: taken whole
  // "Orta" first (20 Oct 2026): 270 × 480; "Küçük" would be 180 × 320.
  await expect(page.getByTestId('gif-size-medium')).toBeChecked();
  await expect(estimate(page)).toHaveAttribute('data-width', '270');
  await expect(page.getByTestId('gif-too-large')).toHaveCount(0);
  await page.getByTestId('gif-size-large').check();
  await expect(estimate(page)).toHaveAttribute('data-state', 'ready', { timeout: 60_000 });
  await expect(estimate(page)).toHaveAttribute('data-width', '360');
  await expect(estimate(page)).toHaveAttribute('data-height', '640');
  const estimated = Number(await estimate(page).getAttribute('data-bytes'));
  const made = await saveGif(page, testInfo, 'dikey-telefon_gif.gif');
  expect(made.gif).toMatchObject({ width: 360, height: 640, frames: 25, loops: 0, durationCs: 200 });
  expect(ffprobeGif(made.path)).toEqual({ frames: 25, width: 360, height: 640 });
  const ratio = made.bytes / estimated;
  console.log(`GIF-ESTIMATE-LARGE ${JSON.stringify({ estimated, actual: made.bytes, ratio })}`);
  // The same bound as the Küçük test above (a quarter); the ±10 % of real recordings is ADR-046's table.
  expect(ratio).toBeGreaterThan(0.75);
  expect(ratio).toBeLessThan(1.33);
});

test('"Çok büyük" (ADR-046 addendum 2): a 720 × 1280 phone video gives 540 × 960 — three times as wide as "Küçük" — about the size it said', async ({ page }, testInfo) => {
  await openGif(page, wizardFixture('verticalHd')); // 720 × 1280, 2 s: taken whole
  await expect(page.getByTestId('gif-size').getByRole('radio')).toHaveCount(4);
  // "Orta" stays the first choice (founder's decision, 20 Oct 2026).
  await expect(page.getByTestId('gif-size-medium')).toBeChecked();
  await page.getByTestId('gif-size-xlarge').check();
  await expect(estimate(page)).toHaveAttribute('data-state', 'ready', { timeout: 60_000 });
  await expect(estimate(page)).toHaveAttribute('data-width', '540');
  await expect(estimate(page)).toHaveAttribute('data-height', '960');
  const estimated = Number(await estimate(page).getAttribute('data-bytes'));
  const made = await saveGif(page, testInfo, 'dikey-hd_gif.gif');
  expect(made.gif).toMatchObject({ width: 540, height: 960, frames: 25, loops: 0, durationCs: 200 });
  expect(ffprobeGif(made.path)).toEqual({ frames: 25, width: 540, height: 960 });
  const ratio = made.bytes / estimated;
  console.log(`GIF-ESTIMATE-XLARGE ${JSON.stringify({ estimated, actual: made.bytes, ratio })}`);
  expect(ratio).toBeGreaterThan(0.75);
  expect(ratio).toBeLessThan(1.33);
  // Never larger than the video (ADR-041): a 640 × 360 video has no "Çok büyük" — its "Büyük" is already its own size.
  await page.getByTestId('wizard-again').click();
  await page.getByTestId('video-input').setInputFiles(OTHER);
  await expect(page.getByTestId('wizard')).toHaveAttribute('data-step', 'choose', { timeout: 60_000 });
  await expect(page.getByTestId('gif-size').getByRole('radio')).toHaveCount(3);
  await expect(page.getByTestId('gif-size-xlarge')).toHaveCount(0);
});

test('refusals: sound only, one frame, a broken index — the screens’ own sentences, nothing made', async ({ page }) => {
  await page.goto('/yap/gif/');
  await expect(page.getByTestId('wizard')).toHaveAttribute('data-step', 'pick');
  const refusal = page.getByTestId('media-error').locator('span').first();
  const cases = [
    { file: { name: 'sadece-ses.mp4', mimeType: 'video/mp4', buffer: readFileSync(MUSIC) }, text: 'bu dosyada görüntü yok, yalnızca ses var.' },
    { file: join(FUZZ, 'tek-kare.mp4'), text: 'bu video çok kısa' },
    { file: join(FUZZ, 'stts-bozuk.mp4'), text: 'bu dosya bozuk görünüyor' },
  ];
  for (const { file, text } of cases) {
    await page.getByTestId('video-input').setInputFiles(file);
    await expect(refusal).toContainText(text, { timeout: 30_000 });
    await expect(page.getByTestId('wizard')).toHaveAttribute('data-step', 'pick');
    await page.getByTestId('media-error-dismiss').click();
  }
  expect(await pickerCalls(page)).toEqual([]);
});

test('İptal et stops it at once and leaves no file; the next one works', async ({ page }, testInfo) => {
  await openGif(page, SAMPLE);
  await page.getByTestId('gif-range-end').focus();
  await page.keyboard.press('End');
  await page.getByTestId('gif-size-medium').check();
  await page.getByTestId('wizard-download').click();
  // Real progress: frames done of all.
  await expect(page.getByTestId('gif-step')).toHaveText(/Kareler hazırlanıyor: \d+ \/ 125/, { timeout: 60_000 });
  await page.getByTestId('export-cancel').click();
  await expect(page.getByTestId('export-canceled')).toContainText('İndirme durduruldu; yarım dosya bırakılmadı.');
  await expect(page.getByTestId('wizard-title')).toHaveText('Durduruldu');
  await expect.poll(async () => (await opfsFiles(page))['saved-sample-24s_gif.gif'] ?? 'gone').toBe('gone');
  await page.getByTestId('wizard-back-to-choice').click();
  await page.getByTestId('gif-size-small').check();
  await page.getByTestId('gif-range-end').focus();
  await page.keyboard.press('Home');
  await expect(estimate(page)).toHaveAttribute('data-state', 'ready', { timeout: 60_000 });
  const made = await saveGif(page, testInfo, 'sample-24s_gif.gif');
  // Home: the end as near the start as it goes — half a second, six frames.
  expect(made.gif.frames).toBe(6);
});

test('a worker that fails or stands still ends in plain words, with the detail and nothing private', async ({ page }) => {
  await openGif(page, SAMPLE);
  await nextFault(page, fault('gif', 'throw'));
  await page.getByTestId('wizard-download').click();
  await expect(page.getByTestId('export-failed')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('wizard-title')).toHaveText('Bu sefer olmadı');
  await expect(page.getByTestId('export-failed-reason')).toHaveText('Beklenmeyen bir hata oluştu. Bir kez daha dene; yine olursa “Sorun bildir”e bas.');
  await page.getByTestId('export-failed-details').locator('summary').click();
  await expect(page.getByTestId('export-failed-detail')).toContainText('EncodingError');
  const diagnostics = await diagnosticsFrom(page, 'export-failed-report');
  for (const secret of SECRETS) expect(diagnostics.text).not.toContain(secret);
  expect(diagnostics.sessionErrors.some((row) => row.code === 'gif_internal_error')).toBe(true);
  expect((await opfsFiles(page))['saved-sample-24s_gif.gif'] ?? 'gone').toBe('gone');

  // Stands still: no error, nothing more — the watch ends it (short limit in test builds).
  await page.getByTestId('wizard-back-to-choice').click();
  await nextFault(page, fault('gif', 'stall'), 3000);
  await page.getByTestId('wizard-download').click();
  await expect(page.getByTestId('export-failed')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('export-failed-details').locator('summary').click();
  await expect(page.getByTestId('export-failed-detail')).toContainText('stalled');
});

test.describe('without a save dialog (Firefox, Safari)', () => {
  test.beforeEach(async ({ page }) => {
    await noSavePicker(page);
  });

  test('the GIF waits behind a save link, as every other download does', async ({ page }, testInfo) => {
    await openGif(page, OTHER);
    await page.getByTestId('wizard-download').click();
    await expect(page.getByTestId('export-download')).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId('wizard-title')).toHaveText('GIF’in hazır');
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-download').click()]);
    expect(download.suggestedFilename()).toBe('other-8s_gif.gif');
    const path = testInfo.outputPath('fallback.gif');
    await download.saveAs(path);
    const inspected = inspectGif(new Uint8Array(readFileSync(path)));
    // The default size since 20 Oct 2026 is "Orta" (ADR-046 addendum): 480 × 270 from 640 × 360.
    expect(inspected.ok && inspected.gif).toMatchObject({ width: 480, height: 270, frames: 100, loops: 0 });
  });
});

test('"Paylaş" hands the system share sheet the GIF itself', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __shared: { name: string; type: string; size: number }[] };
    w.__shared = [];
    Object.defineProperty(Navigator.prototype, 'canShare', {
      configurable: true,
      value: (data?: { files?: File[] }) => Boolean(data?.files?.length && data.files.every((file) => file.type === 'image/gif')),
    });
    Object.defineProperty(Navigator.prototype, 'share', {
      configurable: true,
      value: async (data?: { files?: File[] }) => {
        for (const file of data?.files ?? []) w.__shared.push({ name: file.name, type: file.type, size: file.size });
      },
    });
  });
  await openGif(page, OTHER);
  await page.getByTestId('wizard-download').click();
  await expect(page.getByTestId('download-saved')).toBeVisible({ timeout: 120_000 });
  await page.getByTestId('download-share').click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __shared: unknown[] }).__shared))
    .toEqual([expect.objectContaining({ name: 'saved-other-8s_gif.gif', type: 'image/gif' })]);
});

test('the search finds the card: "gif yap" starts it', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('finder-input').fill('gif yap');
  const row = page.getByTestId('result-gif');
  await expect(row).toBeVisible();
  await expect(row.getByTestId('result-unavailable')).toHaveCount(0);
  await page.getByTestId('finder-input').press('Enter');
  await expect(page).toHaveURL(/\/yap\/gif\/?$/);
  await expect(page.getByTestId('wizard')).toHaveAttribute('data-task', 'gif');
  // A sticker is a picture of its own kind: still honestly not something the app makes.
  await page.goto('/');
  await page.getByTestId('finder-input').fill('whatsapp çıkartması yap');
  await expect(page.getByTestId('result-sticker').getByTestId('result-unavailable')).toHaveText('Bunu henüz yapamıyoruz.');
});
