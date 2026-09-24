import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

import { installSavePicker } from './kesitFlow';

/**
 * Caption burn-in through the real export worker (ADR-015).
 *
 * Captions reach the project through the backup import — a supported path
 * that validates the file like any user backup — so these tests do not depend
 * on the caption editing UI. Pixel-level checks (region, timing, leakage)
 * live in the media matrix (M17), where ffmpeg measures the produced file.
 */

const SAMPLE_VIDEO = join(process.cwd(), 'tests', 'media', 'sample-24s.mp4');

interface StoredRecord {
  projectId: string;
  updatedAt: string;
  edl: { revision: number; clips: unknown[]; captionTracks: unknown[] };
}

function storedRecords(page: Page): Promise<StoredRecord[]> {
  return page.evaluate(
    () =>
      new Promise<StoredRecord[]>((resolve) => {
        const open = indexedDB.open('clip-editor');
        open.onerror = () => resolve([]);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains('projects')) {
            db.close();
            resolve([]);
            return;
          }
          const all = db.transaction('projects', 'readonly').objectStore('projects').getAll();
          all.onerror = () => {
            db.close();
            resolve([]);
          };
          all.onsuccess = () => {
            db.close();
            resolve(all.result as StoredRecord[]);
          };
        };
      }),
  );
}

/** Polled with page.evaluate: waitForFunction does not await a Promise. */
async function waitForRecord(page: Page, matches: (record: StoredRecord) => boolean): Promise<StoredRecord> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const hit = (await storedRecords(page)).find(matches);
    if (hit) return hit;
    await page.waitForTimeout(200);
  }
  throw new Error('record not stored in time');
}

async function projectWithCaptions(
  page: Page,
  testInfo: TestInfo,
  cues: { startUs: number; endUs: number; text: string }[],
): Promise<void> {
  await installSavePicker(page);
  await page.goto('/editor');
  await expect(page.getByTestId('download-all')).toBeVisible();
  await page.getByTestId('video-input').setInputFiles(SAMPLE_VIDEO);
  await expect(page.getByTestId('preview-video')).toBeVisible();
  await page.getByTestId('range-start').fill('00:00.000');
  await page.getByTestId('range-end').fill('00:03.000');
  await page.getByTestId('add-moment').click();

  const record = await waitForRecord(page, (r) => r.edl.clips.length === 1);
  const trackId = 't_e2e_001';
  const backup = structuredClone(record);
  // Adding captions is an edit; the new revision also makes the editor save
  // the restored project, which is how the import is confirmed.
  backup.edl.revision = record.edl.revision + 1000;
  backup.edl.captionTracks = [
    {
      trackId,
      origin: 'manual',
      timeBase: 'output',
      language: 'tr',
      style: { preset: 'box', position: 'bottom', size: 'medium' },
      cues: cues.map((cue, index) => ({ cueId: `q_e2e_${index + 1}`, ...cue })),
    },
  ];
  const path = testInfo.outputPath('captions.clip.json');
  writeFileSync(path, JSON.stringify(backup));
  await page.getByTestId('backup-input').setInputFiles(path);
  await waitForRecord(
    page,
    (r) => (r.edl.captionTracks[0] as { trackId?: string } | undefined)?.trackId === trackId,
  );
  await expect(page.getByTestId('preview-video')).toBeVisible();
}

test.describe('caption burn-in export', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  // Each test builds a project and runs a real encode.
  test.describe.configure({ timeout: 180_000 });

  test('exports a project with captions and verifies the file', async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await projectWithCaptions(page, testInfo, [{ startUs: 500_000, endUs: 2_500_000, text: 'Günaydın İstanbul' }]);

    await page.getByTestId('download-all').click();
    await page.getByTestId('export-succeeded').waitFor({ timeout: 180_000 });
    await expect(page.getByTestId('measured-resolution')).toContainText('×');
    // ADR-027: burned-in captions change the pictures, so nothing is copied.
    await expect(page.getByTestId('export-method')).toHaveAttribute('data-fallback', 'captions');
    expect(errors).toEqual([]);
  });

  test('refuses a caption that needs a third line and names it', async ({ page }, testInfo) => {
    // Capitals on purpose: Inter's mixed-case Turkish at this length still
    // squeezes into two 1080p lines (~3040 of 3124 px measured).
    const long =
      'BU SATIR BİLEREK ÇOK UZUN VE BÜYÜK HARFLERLE YAZILDI Kİ VİDEONUN GENİŞLİĞİNE İKİ SATIRDA HİÇBİR ŞEKİLDE SIĞMASIN';
    await projectWithCaptions(page, testInfo, [
      { startUs: 200_000, endUs: 1_000_000, text: 'Kısa satır' },
      { startUs: 1_200_000, endUs: 2_800_000, text: long },
    ]);

    await page.getByTestId('download-all').click();
    const failed = page.getByTestId('export-failed');
    await failed.waitFor({ timeout: 60_000 });
    await expect(failed).toContainText('sığmıyor');
    await expect(page.getByTestId('export-failed-caption')).toContainText('2. altyazı satırı');
    await expect(page.getByTestId('export-succeeded')).toHaveCount(0);
  });

  test('refuses at the gate when the caption font cannot be loaded', async ({ page, context }, testInfo) => {
    // The worker fetches the font by absolute URL; failing that request must
    // stop the export instead of drawing captions in some fallback font.
    await context.route('**/fonts/caption/**', (route) => route.abort());
    await projectWithCaptions(page, testInfo, [{ startUs: 500_000, endUs: 2_500_000, text: 'Günaydın İstanbul' }]);

    await page.getByTestId('download-all').click();
    await page.getByTestId('export-blocked').waitFor({ timeout: 60_000 });
    await expect(page.getByTestId('export-blockers')).toContainText('yazı tipi');
    await expect(page.getByTestId('export-succeeded')).toHaveCount(0);
    await expect(page.getByTestId('download-running')).toHaveCount(0);
  });
});
