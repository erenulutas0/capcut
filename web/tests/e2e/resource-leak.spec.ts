import { join } from 'node:path';
import { expect, test, type Page } from './fixtures';

import { installSavePicker } from './kesitFlow';
import { noisyLongFixture } from './targetsize-media';
import { wizardFixture } from './wizard-media';

/**
 * Decoded sound and pictures are closed by hand, not left to the garbage
 * collector (10 Oct 2026). mediabunny says so on the console when one was
 * not: "An AudioSample was garbage collected without first being closed…".
 * The quality walk saw that line on the re-encode paths; here the collector
 * is made to run (`--expose-gc`, in the page and in every worker) after each
 * kind of download, so a sample left open cannot hide behind collection that
 * happens to come late.
 */

const SAMPLE = join(process.cwd(), 'tests', 'media', 'sample-24s.mp4');
const MUSIC = join(process.cwd(), 'tests', 'media', 'tone-30s.m4a');

test.use({
  storageState: { cookies: [], origins: [] },
  launchOptions: { args: ['--autoplay-policy=no-user-gesture-required', '--js-flags=--expose-gc'] },
});
test.describe.configure({ timeout: 300_000 });

const NOT_CLOSED = /garbage collected without first being closed/i;

function watchConsole(page: Page): string[] {
  const lines: string[] = [];
  page.on('console', (message) => {
    if (NOT_CLOSED.test(message.text())) lines.push(message.text());
  });
  return lines;
}

/** Runs the collector in the page and in every worker a few times, with room for the finalizers to report. */
async function collect(page: Page): Promise<number> {
  let ran = 0;
  for (let round = 0; round < 4; round += 1) {
    const run = () => {
      const gc = (globalThis as { gc?: () => void }).gc;
      if (!gc) return false;
      gc();
      return true;
    };
    if (await page.evaluate(run)) ran += 1;
    for (const worker of page.workers()) {
      if (await worker.evaluate(run).catch(() => false)) ran += 1;
    }
    await page.waitForTimeout(400);
  }
  return ran;
}

async function downloadAndCollect(page: Page): Promise<void> {
  await expect(page.getByTestId('wizard-download')).toBeEnabled({ timeout: 120_000 });
  await page.getByTestId('wizard-download').click();
  await expect(page.getByTestId('download-saved')).toBeVisible({ timeout: 240_000 });
  // The collector really ran, in the page and in at least the export worker.
  expect(await collect(page)).toBeGreaterThan(4);
}

test.beforeEach(async ({ page }) => {
  await installSavePicker(page);
});

test('Küçült (a full re-encode with sound): nothing decoded is left open', async ({ page }) => {
  const notClosed = watchConsole(page);
  await page.goto('/yap/kucult');
  await page.getByTestId('video-input').setInputFiles(noisyLongFixture());
  await expect(page.getByTestId('kucult-choice')).toBeVisible({ timeout: 60_000 });
  await downloadAndCollect(page);
  expect(notClosed).toEqual([]);
});

test('Her yerde açılsın (WebM re-encoded), Sesini al (sound only) and Müzik ekle (two sounds mixed): the same', async ({ page }) => {
  const notClosed = watchConsole(page);

  await page.goto('/yap/cevir');
  await page.getByTestId('video-input').setInputFiles(wizardFixture('webm'));
  await expect(page.getByTestId('cevir-info')).toBeVisible({ timeout: 60_000 });
  await downloadAndCollect(page);

  await page.goto('/yap/ses');
  await page.getByTestId('video-input').setInputFiles(SAMPLE);
  await expect(page.getByTestId('ses-info')).toBeVisible({ timeout: 60_000 });
  await downloadAndCollect(page);

  await page.goto('/yap/muzik');
  await page.getByTestId('video-input').setInputFiles(SAMPLE);
  await expect(page.getByTestId('muzik-pick')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('audio-input').setInputFiles(MUSIC);
  await expect(page.getByTestId('muzik-picked')).toBeVisible({ timeout: 60_000 });
  await downloadAndCollect(page);

  expect(notClosed).toEqual([]);
});

test('a download stopped half way leaves nothing open either', async ({ page }) => {
  const notClosed = watchConsole(page);
  await page.goto('/yap/dikey');
  await page.getByTestId('video-input').setInputFiles(SAMPLE);
  await expect(page.getByTestId('dikey-choice')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('wizard-download').click();
  await expect(page.getByTestId('export-progress')).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(600);
  await page.getByTestId('export-cancel').click();
  await expect(page.getByTestId('export-canceled')).toBeVisible({ timeout: 30_000 });
  expect(await collect(page)).toBeGreaterThan(4);
  expect(notClosed).toEqual([]);
});
