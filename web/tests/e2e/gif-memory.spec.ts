import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { inspectGif } from '../../src/domain/gifInspect';
import { expect, test, type Page } from './fixtures';
import { installSavePicker, opfsFiles, readSaved } from './kesitFlow';
import { wizardFixture } from './wizard-media';
import { SECRETS, diagnosticsFrom, fault, nextFault, watchLogs, type Fault } from './workerFaultKit';

/**
 * "GIF yap" and memory (ADR-046 memory addendum, 21 Oct 2026). A GIF whose
 * frames would not fit in the budget (`gifFramesBudget`: 32 MiB, or 128 MiB
 * where the device says it has 8 GB) is made in two passes: the part is
 * decoded once for the palette and once more while each frame is written, and
 * no frame is held. Here:
 * - the two ways write the very same bytes, in the real browser, with text,
 *   and for ten seconds of "Büyük" (115 MB of frames) — whose road with the
 *   app's own budget is the one the device's memory decides;
 * - a worker that runs out of memory, crashes or stands still MID-WAY (frames
 *   in hand, in either pass) ends in plain words — never a bar that waits for
 *   ever — leaves no file, and the next GIF is made.
 */

const SAMPLE = join(process.cwd(), 'tests', 'media', 'sample-24s.mp4'); // 1280×720, 24 s
const SAVED = 'saved-sample-24s_gif.gif';

test.describe.configure({ timeout: 240_000 });
test.use({ storageState: { cookies: [], origins: [] } });

const estimate = (page: Page) => page.getByTestId('gif-estimate');

test.beforeEach(async ({ page }) => {
  await installSavePicker(page);
});

async function openGif(page: Page, file: string) {
  await page.goto('/yap/gif/');
  await expect(page.getByTestId('wizard')).toHaveAttribute('data-step', 'pick');
  await page.getByTestId('video-input').setInputFiles(file);
  await expect(page.getByTestId('wizard')).toHaveAttribute('data-step', 'choose', { timeout: 60_000 });
  await expect(estimate(page)).toHaveAttribute('data-state', 'ready', { timeout: 60_000 });
}

/** The frames budget of the next GIFs (test builds only): 0 = always two passes, Infinity = always one. */
async function heldFramesBudget(page: Page, bytes: number | null) {
  await page.evaluate((value) => {
    const w = window as unknown as { __clipGifHeldFramesBytes?: number };
    if (value === null) delete w.__clipGifHeldFramesBytes;
    else w.__clipGifHeldFramesBytes = value;
  }, bytes);
}

/**
 * Presses "GIF'i indir", notes every road the progress card named once frames were counted (a short
 * step can be gone before a poll sees it, a MutationObserver cannot miss it), and reads the file back.
 */
async function make(page: Page, testInfo: Parameters<Parameters<typeof test>[1]>[1], name: string) {
  await page.evaluate(() => {
    const w = window as unknown as { __gifPassesSeen: string[]; __gifPassesWatch?: MutationObserver };
    w.__gifPassesSeen = [];
    w.__gifPassesWatch?.disconnect();
    const note = () => {
      const card = document.querySelector('[data-testid="download-running"]');
      const passes = card?.getAttribute('data-passes');
      if (card && passes && Number(card.getAttribute('data-total')) > 0 && !w.__gifPassesSeen.includes(passes)) w.__gifPassesSeen.push(passes);
    };
    w.__gifPassesWatch = new MutationObserver(note);
    w.__gifPassesWatch.observe(document.body, { subtree: true, childList: true, attributes: true });
  });
  await page.getByTestId('wizard-download').click();
  await expect(page.getByTestId('download-saved')).toHaveText(`Kaydedildi: ${name}`, { timeout: 180_000 });
  const passes = await page.evaluate(() => (window as unknown as { __gifPassesSeen: string[] }).__gifPassesSeen.join(','));
  const bytes = readFileSync(await readSaved(page, testInfo, name));
  const inspected = inspectGif(new Uint8Array(bytes));
  expect(inspected.ok, JSON.stringify(inspected)).toBe(true);
  if (!inspected.ok) throw new Error(inspected.reason);
  return { bytes, gif: inspected.gif, passes };
}

test('two passes write byte for byte the GIF one pass writes (with text; and for ten seconds of "Büyük", either road)', async ({ page }, testInfo) => {
  const logs = watchLogs(page);
  await openGif(page, SAMPLE);
  await page.getByTestId('gif-size-small').check();
  await page.getByLabel('Üst yazı').fill('BELLEK ığüşöç');
  await expect(estimate(page)).toHaveAttribute('data-state', 'ready', { timeout: 60_000 });
  await expect(estimate(page)).toHaveAttribute('data-frames', '50');

  await heldFramesBudget(page, Number.POSITIVE_INFINITY);
  const one = await make(page, testInfo, SAVED);
  expect(one.passes).toBe('1');

  await page.getByTestId('wizard-again-same').click();
  await expect(page.getByTestId('wizard')).toHaveAttribute('data-step', 'choose');
  await heldFramesBudget(page, 0);
  const two = await make(page, testInfo, SAVED);
  expect(two.passes).toBe('2');

  expect(two.gif).toMatchObject({ width: 320, height: 180, frames: 50, loops: 0, durationCs: 400 });
  console.log(`GIF-TWO-PASS ${JSON.stringify({ bytes: one.bytes.length, same: one.bytes.equals(two.bytes) })}`);
  expect(two.bytes.length).toBe(one.bytes.length);
  expect(two.bytes.equals(one.bytes)).toBe(true);

  // Ten seconds of "Büyük" with the app's own budget: 640 × 360 × 4 × 125 = 115 MB of frames — two passes,
  // unless the device says it has 8 GB (`navigator.deviceMemory`; the worker reads its own, the same value).
  await heldFramesBudget(page, null);
  const deviceMemory = await page.evaluate(() => (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null);
  console.log(`GIF-DEVICE-MEMORY ${JSON.stringify({ deviceMemory })}`);
  await page.getByTestId('wizard-again').click();
  await page.getByTestId('video-input').setInputFiles(wizardFixture('grainy')); // 640 × 360, 10 s: taken whole
  await expect(page.getByTestId('wizard')).toHaveAttribute('data-step', 'choose', { timeout: 60_000 });
  await page.getByTestId('gif-size-large').check();
  await expect(estimate(page)).toHaveAttribute('data-state', 'ready', { timeout: 60_000 });
  await expect(estimate(page)).toHaveAttribute('data-width', '640');
  const large = await make(page, testInfo, 'saved-kumlu-10s_gif.gif');
  expect(large.passes).toBe(typeof deviceMemory === 'number' && deviceMemory >= 8 ? '1' : '2');
  expect(large.gif).toMatchObject({ width: 640, height: 360, frames: 125, loops: 0, durationCs: 1000 });
  // And the other road for the same 115 MB of frames (a phone's 32 MiB budget, or every frame held): the same bytes.
  await page.getByTestId('wizard-again-same').click();
  await expect(page.getByTestId('wizard')).toHaveAttribute('data-step', 'choose');
  await heldFramesBudget(page, large.passes === '1' ? 32 * 1024 * 1024 : Number.POSITIVE_INFINITY);
  const other = await make(page, testInfo, 'saved-kumlu-10s_gif.gif');
  expect(other.passes).toBe(large.passes === '1' ? '2' : '1');
  console.log(`GIF-TWO-PASS-LARGE ${JSON.stringify({ bytes: large.bytes.length, same: other.bytes.equals(large.bytes) })}`);
  expect(other.bytes.equals(large.bytes)).toBe(true);
  expect(logs.pageErrors).toEqual([]);
});

/** Starts a GIF with this fault planted, and waits for the failure card. */
async function failWith(page: Page, value: Fault, stallMs?: number) {
  await nextFault(page, value, stallMs);
  await page.getByTestId('wizard-download').click();
  const failed = page.getByTestId('export-failed');
  await expect(failed).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('wizard-title')).toHaveText('Bu sefer olmadı');
  // The file the save dialog made is not left behind, half-written or empty.
  await expect.poll(async () => (await opfsFiles(page))[SAVED] ?? 'gone').toBe('gone');
  return failed;
}

test('out of memory, a crash or standing still MID-WAY, in either pass: plain words, the detail, no file — and the next GIF is made', async ({ page }, testInfo) => {
  await openGif(page, SAMPLE);
  await page.getByTestId('gif-size-small').check();
  await expect(estimate(page)).toHaveAttribute('data-state', 'ready', { timeout: 60_000 });
  const details = page.getByTestId('export-failed-detail');
  const again = async () => {
    await page.getByTestId('wizard-back-to-choice').click();
    await expect(page.getByTestId('wizard')).toHaveAttribute('data-step', 'choose');
  };

  await test.step('out of memory at frame 20 of 50, frames held (one pass)', async () => {
    await heldFramesBudget(page, Number.POSITIVE_INFINITY);
    const failed = await failWith(page, { worker: 'gif', kind: 'oom', atFrame: 20 });
    await expect(failed).toHaveAttribute('data-code', 'out_of_memory');
    await expect(page.getByTestId('export-failed-reason')).toHaveText(
      'Tarayıcının belleği yetmedi. Daha küçük bir boyut seç ya da kısmı kısalt; açık başka sekmeleri kapatmak da yardım eder.',
    );
    await page.getByTestId('export-failed-details').locator('summary').click();
    await expect(details).toContainText(/^RangeError · frame_capture · out_of_memory/);
  });

  await test.step('the worker crashes at frame 60: ten frames into the second pass', async () => {
    await again();
    await heldFramesBudget(page, 0);
    const failed = await failWith(page, { ...fault('gif', 'crash'), atFrame: 60 });
    await expect(failed).toHaveAttribute('data-code', 'internal_error');
    await expect(page.getByTestId('export-failed-reason')).toHaveText('Beklenmeyen bir hata oluştu. Bir kez daha dene; yine olursa “Sorun bildir”e bas.');
    await page.getByTestId('export-failed-details').locator('summary').click();
    await expect(details).toContainText(/^WorkerError · worker_crash · worker_error_event/);
    const diagnostics = await diagnosticsFrom(page, 'export-failed-report');
    for (const secret of SECRETS) expect(diagnostics.text).not.toContain(secret);
  });

  await test.step('it stands still at frame 70 (second pass): the watch ends it', async () => {
    await again();
    await heldFramesBudget(page, 0);
    const failed = await failWith(page, { worker: 'gif', kind: 'stall', atFrame: 70 }, 3000);
    await expect(failed).toHaveAttribute('data-code', 'internal_error');
    await page.getByTestId('export-failed-details').locator('summary').click();
    // Asked where it stood, it answered: writing the GIF.
    await expect(details).toContainText(/^Stalled · gif_encode · stalled/);
  });

  await test.step('nothing planted: the next GIF is made, in two passes', async () => {
    await again();
    await nextFault(page, null);
    await heldFramesBudget(page, 0);
    const made = await make(page, testInfo, SAVED);
    expect(made.passes).toBe('2');
    expect(made.gif).toMatchObject({ width: 320, height: 180, frames: 50 });
  });
});
