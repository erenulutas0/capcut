import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const SAMPLE_VIDEO = join(process.cwd(), 'tests', 'media', 'sample-24s.mp4');
const LEGACY_V1 = join(process.cwd(), 'fixtures', 'edl', 'legacy-v1', 'single-clip.json');

async function openWithSample(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/editor');
  await expect(page.getByTestId('open-export')).toBeVisible();
  await page.getByTestId('video-input').setInputFiles(SAMPLE_VIDEO);
  await expect(page.getByTestId('preview-video')).toBeVisible();
  await expect(page.getByTestId('total-time')).toHaveText('00:24.000');
  return errors;
}

async function addMoment(page: Page, start: string, end: string) {
  await page.getByTestId('range-start').fill(start);
  await page.getByTestId('range-end').fill(end);
  await page.getByTestId('add-moment').click();
}

/** Two moments, 4 s + 6 s: a 10 s output. */
async function buildTenSecondOutput(page: Page) {
  await addMoment(page, '00:00.000', '00:04.000');
  await addMoment(page, '00:08.000', '00:14.000');
  await expect(page.getByTestId('output-duration-us')).toHaveText('10000000');
}

async function showResult(page: Page) {
  await page.getByRole('tab', { name: 'Sonuç', exact: true }).click();
  await expect(page.getByTestId('output-note')).toBeVisible();
}

async function seek(page: Page, ms: number) {
  await page.getByLabel('Zamanda gezin').fill(String(ms));
  await expect(page.getByTestId('current-time')).toHaveText(
    `00:${String(Math.floor(ms / 1000)).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`,
  );
}

/** Adds a line at the current output playhead and types its text. */
async function addLine(page: Page, text: string) {
  await page.getByTestId('captions-add').click();
  const field = page.getByTestId('cue-draft').getByTestId('cue-text');
  await expect(field).toBeFocused();
  await page.keyboard.type(text);
  // Leaving the new line's editor is what adds it to the recipe.
  await field.blur();
  await expect(page.getByTestId('cue-draft')).toHaveCount(0);
}

/**
 * Counts caption pixels on the overlay canvas, split into the top and bottom
 * 40% of the frame. The video itself is a separate element, so anything
 * non-transparent on this canvas is caption.
 */
async function overlayInk(page: Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="caption-overlay"]');
    if (!canvas) return null;
    const context = canvas.getContext('2d');
    if (!context) return null;
    const { width, height } = canvas;
    const data = context.getImageData(0, 0, width, height).data;
    let top = 0;
    let bottom = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const alpha = data[(y * width + x) * 4 + 3] ?? 0;
        if (alpha === 0) continue;
        if (y < height * 0.4) top += 1;
        else if (y >= height * 0.6) bottom += 1;
      }
    }
    const frame = document.querySelector('[data-testid="preview-frame"]')?.getBoundingClientRect();
    return {
      top,
      bottom,
      width,
      height,
      expectedWidth: frame ? Math.round(frame.width * window.devicePixelRatio) : -1,
      expectedHeight: frame ? Math.round(frame.height * window.devicePixelRatio) : -1,
    };
  });
}

/** Reads the autosaved record straight from IndexedDB (null if not there yet). */
async function storedRecord(page: Page, projectId: string) {
  return page.evaluate(
    (id) =>
      new Promise<unknown>((resolve) => {
        const open = indexedDB.open('clip-editor');
        open.onerror = () => resolve(null);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains('projects')) {
            db.close();
            resolve(null);
            return;
          }
          const request = db.transaction('projects', 'readonly').objectStore('projects').get(id);
          request.onsuccess = () => {
            db.close();
            resolve(request.result ?? null);
          };
          request.onerror = () => {
            db.close();
            resolve(null);
          };
        };
      }),
    projectId,
  );
}

type StoredRecord = {
  edl: {
    schemaVersion: number;
    captionTracks: Array<{ style: { position: string }; cues: Array<{ startUs: number; endUs: number; text: string }> }>;
  };
};

test.describe('captions', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeEach(async ({ page }) => {
    await page.goto('/editor');
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const request = indexedDB.deleteDatabase('clip-editor');
          request.onsuccess = () => resolve();
          request.onerror = () => resolve();
          request.onblocked = () => resolve();
        }),
    );
  });

  test('a line is added at the output playhead, keeps Turkish text and is drawn only in its range', async ({
    page,
  }) => {
    const errors = await openWithSample(page);
    await buildTenSecondOutput(page);
    await page.getByTestId('inspector-tab-captions').click();
    await expect(page.getByTestId('captions-empty')).toContainText('piksellerine');
    // Source mode: the panel explains why no caption shows in this preview.
    await expect(page.getByTestId('captions-source-hint')).toBeVisible();

    await showResult(page);
    await expect(page.getByTestId('captions-source-hint')).toHaveCount(0);
    await seek(page, 3000);
    await page.getByTestId('captions-add').click();

    const draft = page.getByTestId('cue-draft');
    await expect(draft.getByTestId('cue-range')).toHaveText('00:03.000 — 00:05.000');
    await expect(draft.getByTestId('cue-text')).toBeFocused();
    await page.keyboard.type('İyi  günler,   ağır şişli ılık ');
    await expect(draft.getByTestId('cue-counter')).toHaveText('27/120');
    await draft.getByTestId('cue-text').blur();

    const item = page.getByTestId('cue-item');
    await expect(item).toHaveCount(1);
    await expect(item.getByTestId('cue-range')).toHaveText('00:03.000 — 00:05.000');
    // What is shown after leaving the field is what is stored.
    await expect(item.getByTestId('cue-text')).toHaveValue('İyi günler, ağır şişli ılık');
    await expect(item.getByTestId('cue-start')).toHaveValue('00:03.000');
    await expect(item.getByTestId('cue-end')).toHaveValue('00:05.000');
    await expect(page.getByTestId('strip-caption-mark')).toHaveCount(1);

    // Inside the line: pixels in the lower part of the frame, none on top,
    // and the canvas backing store is the frame box times devicePixelRatio.
    const overlay = page.getByTestId('caption-overlay');
    await expect(overlay).toHaveAttribute('data-cue-id', 'q_001');
    const inside = await overlayInk(page);
    expect(inside).not.toBeNull();
    expect(inside?.bottom).toBeGreaterThan(200);
    expect(inside?.top).toBe(0);
    expect(inside?.width).toBe(inside?.expectedWidth);
    expect(inside?.height).toBe(inside?.expectedHeight);

    // Outside the line: nothing.
    await seek(page, 6000);
    await expect(overlay).toHaveAttribute('data-cue-id', '');
    const outside = await overlayInk(page);
    expect((outside?.top ?? -1) + (outside?.bottom ?? -1)).toBe(0);

    // "Buraya git" brings the playhead back to the line and it is drawn again.
    await item.getByTestId('cue-goto').click();
    await expect(page.getByTestId('current-time')).toHaveText('00:03.000');
    await expect(overlay).toHaveAttribute('data-cue-id', 'q_001');

    // The source preview never shows captions.
    await page.getByRole('tab', { name: 'Kaynak', exact: true }).click();
    await expect(overlay).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('a refused edit is explained under the line and nothing typed is lost', async ({ page }) => {
    await openWithSample(page);
    await buildTenSecondOutput(page);
    await page.getByTestId('inspector-tab-captions').click();
    await showResult(page);

    await seek(page, 1000);
    await addLine(page, 'Birinci satır');
    await seek(page, 4000);
    await addLine(page, 'İkinci satır');
    const items = page.getByTestId('cue-item');
    await expect(items).toHaveCount(2);
    const second = items.nth(1);
    await expect(second.getByTestId('cue-range')).toHaveText('00:04.000 — 00:06.000');

    // Overlap: moving the second line onto the first is refused.
    await second.getByTestId('cue-start').fill('00:02.000');
    await second.getByTestId('cue-start').blur();
    await expect(second.getByTestId('cue-error')).toContainText('üst üste binemez');
    await expect(second.getByTestId('cue-start')).toHaveValue('00:02.000');
    await expect(second.getByTestId('cue-start')).toHaveAttribute('aria-invalid', 'true');
    await expect(second.getByTestId('cue-range')).toHaveText('00:04.000 — 00:06.000');

    // A valid time clears the message.
    await second.getByTestId('cue-start').fill('00:03.500');
    await second.getByTestId('cue-start').blur();
    await expect(second.getByTestId('cue-error')).toHaveCount(0);
    await expect(second.getByTestId('cue-range')).toHaveText('00:03.500 — 00:06.000');

    // Three lines are refused and the three lines stay in the field.
    const first = items.first();
    const threeLines = 'bir\niki\nüç';
    await first.getByTestId('cue-text').fill(threeLines);
    await first.getByTestId('cue-text').blur();
    await expect(first.getByTestId('cue-error')).toContainText('En çok 2 satır');
    await expect(first.getByTestId('cue-text')).toHaveValue(threeLines);
    await expect(first.getByTestId('cue-text')).toHaveAttribute('aria-invalid', 'true');

    // Too short: a line under 0.2 s.
    await first.getByTestId('cue-end').fill('00:01.100');
    await first.getByTestId('cue-end').blur();
    await expect(first.getByTestId('cue-error')).toContainText('0,2 saniye');

    // Starting at or after the output end.
    await first.getByTestId('cue-start').fill('00:12.000');
    await first.getByTestId('cue-start').blur();
    await expect(first.getByTestId('cue-error')).toContainText('video bitmeden');

    // Adding inside an existing line starts right after it instead of overlapping.
    await seek(page, 1500);
    await page.getByTestId('captions-add').click();
    await expect(page.getByTestId('cue-draft').getByTestId('cue-range')).toHaveText(
      '00:03.000 — 00:03.500',
    );
    await page.getByTestId('cue-cancel').click();
    await expect(page.getByTestId('cue-draft')).toHaveCount(0);
    await expect(items).toHaveCount(2);
  });

  test('style changes are one undo step each and move the drawn caption', async ({ page }) => {
    await openWithSample(page);
    await buildTenSecondOutput(page);
    await page.getByTestId('inspector-tab-captions').click();
    await showResult(page);
    await seek(page, 2000);
    await addLine(page, 'Stil denemesi');
    const overlay = page.getByTestId('caption-overlay');
    await expect(overlay).toHaveAttribute('data-cue-id', 'q_001');

    await page.getByTestId('caption-preset-outline').check();
    await page.getByTestId('caption-position-top').check();
    await expect(page.getByTestId('caption-position-top')).toBeChecked();

    // Drawn at the top now.
    await expect.poll(async () => (await overlayInk(page))?.top ?? 0).toBeGreaterThan(200);
    expect((await overlayInk(page))?.bottom).toBe(0);

    await page.getByTestId('undo').click();
    await expect(page.getByTestId('caption-position-bottom')).toBeChecked();
    await expect(page.getByTestId('caption-preset-outline')).toBeChecked();
    await expect.poll(async () => (await overlayInk(page))?.bottom ?? 0).toBeGreaterThan(200);

    await page.getByTestId('undo').click();
    await expect(page.getByTestId('caption-preset-box')).toBeChecked();
    // The line itself is still there: the style steps were separate.
    await expect(page.getByTestId('cue-item')).toHaveCount(1);

    await page.getByTestId('redo').click();
    await expect(page.getByTestId('caption-preset-outline')).toBeChecked();
    await page.getByTestId('redo').click();
    await expect(page.getByTestId('caption-position-top')).toBeChecked();

    // Language is a recipe field too, with its own undo step.
    await page.getByTestId('caption-language-en').check();
    await page.getByTestId('undo').click();
    await expect(page.getByTestId('caption-language-tr')).toBeChecked();
  });

  test('lines survive a reload (IndexedDB autosave)', async ({ page }) => {
    await openWithSample(page);
    await buildTenSecondOutput(page);
    await page.getByTestId('inspector-tab-captions').click();
    await showResult(page);
    await seek(page, 1000);
    await addLine(page, 'Kalıcı satır İğşı');
    await page.getByTestId('caption-size-large').check();

    await expect(page.getByTestId('save-state')).toContainText('Kaydedildi', { timeout: 15_000 });
    await expect
      .poll(
        async () => {
          const record = (await storedRecord(page, 'p_local_001')) as StoredRecord | null;
          return record?.edl.captionTracks[0]?.cues[0]?.text ?? null;
        },
        { timeout: 15_000 },
      )
      .toBe('Kalıcı satır İğşı');

    await page.reload();
    await expect(page.getByTestId('relink-video')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('inspector-tab-captions').click();
    const item = page.getByTestId('cue-item');
    await expect(item).toHaveCount(1);
    await expect(item.getByTestId('cue-text')).toHaveValue('Kalıcı satır İğşı');
    await expect(item.getByTestId('cue-range')).toHaveText('00:01.000 — 00:03.000');
    await expect(page.getByTestId('caption-size-large')).toBeChecked();
  });

  test('an older v1 backup opens with no captions and is saved as v2', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/editor');
    await expect(page.getByTestId('open-export')).toBeVisible();

    const edl = JSON.parse(readFileSync(LEGACY_V1, 'utf8')) as { schemaVersion: number };
    expect(edl.schemaVersion).toBe(1);
    const now = new Date().toISOString();
    const record = {
      recordVersion: 1,
      projectId: 'p_fixture_001',
      title: 'Eski yedek',
      edl,
      bindings: [
        {
          assetId: 'a_video_001',
          kind: 'video',
          fileName: 'eski-kayit.mp4',
          sizeBytes: 1_000_000,
          lastModified: 0,
          durationUs: 20_000_000,
          displayWidth: 1080,
          displayHeight: 1920,
          mimeType: 'video/mp4',
          fingerprint: 'fp_00000000',
          lastSeenAt: now,
        },
      ],
      createdAt: now,
      updatedAt: now,
    };
    await page.getByTestId('backup-input').setInputFiles({
      name: 'eski.clip.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(record)),
    });

    await expect(page.getByTestId('moment-count')).toHaveText('1 an', { timeout: 20_000 });
    await expect(page.getByTestId('relink-filename')).toHaveText('eski-kayit.mp4');
    await page.getByTestId('inspector-tab-captions').click();
    await expect(page.getByTestId('captions-empty')).toBeVisible();
    await expect(page.getByTestId('cue-item')).toHaveCount(0);
    await expect(page.getByTestId('strip-captions')).toHaveCount(0);

    // The next autosave writes the migrated recipe.
    await expect
      .poll(
        async () => {
          const stored = (await storedRecord(page, 'p_fixture_001')) as StoredRecord | null;
          return stored ? `${stored.edl.schemaVersion}:${stored.edl.captionTracks.length}` : null;
        },
        { timeout: 15_000 },
      )
      .toBe('2:0');
    expect(errors).toEqual([]);
  });

  test('a caption font that fails to load is said out loud and nothing is drawn', async ({ page }) => {
    await page.route('**/fonts/caption/**', (route) => route.abort());
    await openWithSample(page);
    await buildTenSecondOutput(page);
    await page.getByTestId('inspector-tab-captions').click();
    await expect(page.getByTestId('caption-font-failed')).toContainText('dışa aktarma da altyazısız');

    await showResult(page);
    await seek(page, 1000);
    await addLine(page, 'Font yok');
    await expect(page.getByTestId('preview-caption-font-failed')).toBeVisible();
    await expect(page.getByTestId('caption-overlay')).toHaveAttribute('data-cue-id', '');
    const ink = await overlayInk(page);
    expect((ink?.top ?? -1) + (ink?.bottom ?? -1)).toBe(0);
  });
});

test.describe('captions on a phone', () => {
  test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 390, height: 844 } });

  test('the caption sheet works at 390 px, without horizontal scroll, and the backup carries v2 captions', async ({
    page,
  }) => {
    const errors = await openWithSample(page);
    await buildTenSecondOutput(page);

    await page.getByTestId('tab-captions').click();
    const sheet = page.getByRole('dialog', { name: 'Altyazı' });
    await expect(sheet).toBeVisible();
    // Adding from source mode switches the preview to the result.
    await expect(sheet.getByTestId('captions-source-hint')).toBeVisible();
    await sheet.getByTestId('captions-add').click();
    await expect(sheet.getByTestId('captions-source-hint')).toHaveCount(0);
    const draftText = sheet.getByTestId('cue-draft').getByTestId('cue-text');
    await expect(draftText).toBeFocused();
    await page.keyboard.type('Telefonda İlk satır');
    await draftText.blur();
    await expect(sheet.getByTestId('cue-item').getByTestId('cue-range')).toHaveText(
      '00:00.000 — 00:02.000',
    );
    await sheet.getByTestId('caption-preset-outline').check();

    // Nothing in the page or the sheet scrolls sideways.
    const overflow = await page.evaluate(() => {
      const sheetBody = document.querySelector('.sheet-body');
      return {
        page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        sheet: sheetBody ? sheetBody.scrollWidth - sheetBody.clientWidth : -1,
      };
    });
    expect(overflow).toEqual({ page: 0, sheet: 0 });

    // Controls stay touch sized.
    const addBox = await sheet.getByTestId('captions-add').boundingBox();
    expect(addBox?.height).toBeGreaterThanOrEqual(44);

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('caption-overlay')).toHaveAttribute('data-cue-id', 'q_001');

    await page.getByTestId('tab-file').click();
    const download = page.waitForEvent('download');
    await page.getByTestId('backup-download').click();
    const saved = await download;
    const stream = await saved.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const record = JSON.parse(Buffer.concat(chunks).toString('utf8'));

    expect(record.edl.schemaVersion).toBe(2);
    expect(record.edl.captionTracks).toHaveLength(1);
    expect(record.edl.captionTracks[0].style).toEqual({
      preset: 'outline',
      position: 'bottom',
      size: 'medium',
    });
    expect(record.edl.captionTracks[0].cues).toEqual([
      { cueId: 'q_001', startUs: 0, endUs: 2_000_000, text: 'Telefonda İlk satır' },
    ]);
    expect(errors).toEqual([]);
  });
});
