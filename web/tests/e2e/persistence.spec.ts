import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

import { APP_SLUG } from '../../src/appIdentity';
import { addKesit as addMoment, openEditor, openMore, openSettings, installSavePicker } from './kesitFlow';

const SAMPLE_VIDEO = join(process.cwd(), 'tests', 'media', 'sample-24s.mp4');
const OTHER_VIDEO = join(process.cwd(), 'tests', 'media', 'other-8s.mp4');
const SAMPLE_AUDIO = join(process.cwd(), 'tests', 'media', 'tone-30s.m4a');

interface StoredRecord {
  edl: { clips: unknown[]; music?: { sourceInUs: number; sourceOutUs: number } };
  bindings: Array<{ kind: string }>;
}

/** The project as the browser's store holds it right now (null: nothing stored). */
async function storedRecord(page: Page): Promise<StoredRecord | null> {
  return page.evaluate(
    () =>
      new Promise<StoredRecord | null>((resolve, reject) => {
        const open = indexedDB.open('clip-editor');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains('projects')) {
            db.close();
            resolve(null);
            return;
          }
          const all = db.transaction('projects', 'readonly').objectStore('projects').getAll();
          all.onerror = () => reject(all.error);
          all.onsuccess = () => {
            db.close();
            resolve((all.result[0] as StoredRecord | undefined) ?? null);
          };
        };
      }),
  );
}

/**
 * Builds a two-kesit project and waits until it is really on disk. The badge
 * alone is not enough: it already reads "saklandı" for the video with no kesit.
 */
async function buildAndSave(page: Page) {
  await page.getByTestId('video-input').setInputFiles(SAMPLE_VIDEO);
  await expect(page.getByTestId('preview-video')).toBeVisible();
  await addMoment(page, '00:00.000', '00:04.000');
  await addMoment(page, '00:08.000', '00:14.000');
  await expect.poll(async () => (await storedRecord(page))?.edl.clips.length ?? 0, { timeout: 15_000 }).toBe(2);
  await expect(page.getByTestId('save-state')).toContainText('Düzenleme saklandı', { timeout: 15_000 });
}

test.describe('local persistence', () => {
  // Each test gets its own storage so a leftover project cannot leak across.
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

  test('says "saved" only after the write, and explains it is browser storage', async ({ page }) => {
    await openEditor(page);
    await expect(page.getByTestId('save-state')).toContainText('Düzenleme henüz saklanmadı');

    await buildAndSave(page);

    const badge = page.getByTestId('save-state');
    await expect(badge).toContainText('Düzenleme saklandı');
    // The tooltip must not let anyone believe this is a cloud backup.
    const hint = await badge.getAttribute('title');
    expect(hint).toContain('bulut yedeği değildir');
    expect(hint).toContain('Video dosyaların hiçbir zaman kaydedilmez');
  });

  test('the recipe survives a reload and asks for the file back', async ({ page }) => {
    const errors = await openEditor(page);
    await buildAndSave(page);

    await page.reload();

    // The recipe came back: the kesit list is always there.
    await expect(page.getByTestId('moment-count')).toHaveText('(2)', { timeout: 20_000 });
    await expect(page.getByTestId('kesit-range')).toHaveText(['00:00 → 00:04', '00:08 → 00:14']);

    // ...and the editor asks for exactly the file it is missing.
    await expect(page.getByTestId('relink-video')).toBeVisible();
    await expect(page.getByTestId('relink-filename')).toHaveText('sample-24s.mp4');
    await expect(page.getByTestId('preview-video')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  // ADR-026: a video is opened with no kesit. That project is stored, so it must come back.
  test('a video with no kesit survives a reload and asks for the file back', async ({ page }) => {
    const errors = await openEditor(page);
    await page.getByTestId('video-input').setInputFiles(OTHER_VIDEO);
    await expect(page.getByTestId('preview-video')).toBeVisible();
    await expect(page.getByTestId('save-state')).toContainText('Düzenleme saklandı', { timeout: 15_000 });
    await expect.poll(async () => (await storedRecord(page))?.bindings.length ?? 0, { timeout: 15_000 }).toBe(1);
    expect((await storedRecord(page))?.edl.clips).toEqual([]);

    await page.reload();

    // What the header said before the reload is still true after it.
    await expect(page.getByTestId('relink-video')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('relink-filename')).toHaveText('other-8s.mp4');
    await expect(page.getByTestId('save-state')).toContainText('Düzenleme saklandı');
    await expect(page.getByTestId('moment-count')).toHaveText('(0)');
    await expect(page.getByTestId('download-all')).toBeDisabled();

    // The same file is recognised, and the whole video can be worked on again.
    await page.getByTestId('relink-video-input').setInputFiles(OTHER_VIDEO);
    await expect(page.getByTestId('preview-video')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('relink-video')).toHaveCount(0);
    await expect(page.getByTestId('total-time')).toHaveText('00:08');
    await expect(page.getByTestId('download-all')).toBeEnabled();
    await addMoment(page, '00:01.000', '00:03.000');
    await expect(page.getByTestId('moment-count')).toHaveText('(1)');
    expect(errors).toEqual([]);
  });

  test('a video and its music with no kesit both ask for their files after a reload', async ({ page }) => {
    const errors = await openEditor(page);
    await page.getByTestId('video-input').setInputFiles(OTHER_VIDEO);
    await expect(page.getByTestId('preview-video')).toBeVisible();
    await page.getByTestId('audio-input').setInputFiles(SAMPLE_AUDIO);
    await openSettings(page, 'audio');
    await expect(page.getByTestId('music-file-name')).toHaveText('tone-30s.m4a', { timeout: 30_000 });
    await page.keyboard.press('Escape');
    // Both files are in the stored project, and it still has no kesit.
    await expect.poll(async () => (await storedRecord(page))?.bindings.length ?? 0, { timeout: 15_000 }).toBe(2);
    const stored = await storedRecord(page);
    expect(stored?.edl.clips).toEqual([]);
    // The music lies under the whole 8 s video (ADR-034), not a 0.1 s stub.
    expect(stored?.edl.music).toMatchObject({ sourceInUs: 0, sourceOutUs: 8_000_000 });
    await expect(page.getByTestId('save-state')).toContainText('Düzenleme saklandı', { timeout: 15_000 });

    await page.reload();

    await expect(page.getByTestId('relink-video')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('relink-filename')).toHaveText('other-8s.mp4');
    await page.getByTestId('relink-video-input').setInputFiles(OTHER_VIDEO);
    await expect(page.getByTestId('preview-video')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('moment-count')).toHaveText('(0)');

    await openSettings(page, 'audio');
    await expect(page.getByTestId('relink-audio')).toBeVisible();
    await expect(page.getByTestId('relink-audio').getByTestId('relink-filename')).toHaveText('tone-30s.m4a');
    await page.getByTestId('relink-audio-input').setInputFiles(SAMPLE_AUDIO);
    await expect(page.getByTestId('music-file-name')).toHaveText('tone-30s.m4a', { timeout: 30_000 });
    await expect(page.getByTestId('relink-audio')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('re-linking the same file restores playback and export (M14)', async ({ page }) => {
    await installSavePicker(page);
    await openEditor(page);
    await buildAndSave(page);
    await page.reload();
    await expect(page.getByTestId('relink-video')).toBeVisible({ timeout: 20_000 });

    await page.getByTestId('relink-video-input').setInputFiles(SAMPLE_VIDEO);

    // The file is recognised, the moments are untouched, the preview is back.
    await expect(page.getByTestId('preview-video')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('relink-video')).toHaveCount(0);
    await expect(page.getByTestId('moment-count')).toHaveText('(2)');
    await expect(page.getByTestId('output-duration-us')).toHaveText('10000000');

    // And the restored project can actually be downloaded, joined.
    await openSettings(page, 'frame');
    await page.getByTestId('export-quality').selectOption('720');
    await page.keyboard.press('Escape');
    await page.getByTestId('download-all').click();
    await page.getByTestId('export-succeeded').waitFor({ timeout: 180_000 });
    await expect(page.getByTestId('measured-duration')).toContainText(/^00:1[01]\./);
  });

  test('a different file is refused rather than silently re-pointed', async ({ page }) => {
    await openEditor(page);
    await buildAndSave(page);
    await page.reload();
    await expect(page.getByTestId('relink-video')).toBeVisible({ timeout: 20_000 });

    await page.getByTestId('relink-video-input').setInputFiles(OTHER_VIDEO);

    await expect(page.getByTestId('relink-mismatch')).toBeVisible({ timeout: 30_000 });
    // Nothing has been changed yet: the moments and the prompt are still there.
    await expect(page.getByTestId('moment-count')).toHaveText('(2)');
    await expect(page.getByTestId('preview-video')).toHaveCount(0);
  });

  test('accepting a different file starts a new source and says so', async ({ page }) => {
    await openEditor(page);
    await buildAndSave(page);
    await page.reload();
    await expect(page.getByTestId('relink-video')).toBeVisible({ timeout: 20_000 });

    await page.getByTestId('relink-video-input').setInputFiles(OTHER_VIDEO);
    await expect(page.getByTestId('relink-mismatch')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('relink-use-as-new').click();

    // The ranges belonged to the old footage, so they are gone — as warned.
    // Like any newly opened video (ADR-026), nothing is placed on its own.
    await expect(page.getByTestId('preview-video')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('moment-count')).toHaveText('(0)');
    // Whole seconds on the clock (ADR-030); the exact length is the strip's value.
    await expect(page.getByTestId('total-time')).toHaveText('00:08');
    await expect(page.getByTestId('timeline-playhead')).toHaveAttribute('aria-valuemax', '8');
  });

  test('music is re-linked separately and keeps its settings', async ({ page }) => {
    await openEditor(page);
    await page.getByTestId('video-input').setInputFiles(SAMPLE_VIDEO);
    await expect(page.getByTestId('preview-video')).toBeVisible();
    await addMoment(page, '00:00.000', '00:06.000');
    await page.getByTestId('audio-input').setInputFiles(SAMPLE_AUDIO);
    await openSettings(page, 'audio');
    await expect(page.getByTestId('music-in')).toBeVisible();
    await page.getByTestId('music-out').fill('00:05.000');
    await page.getByTestId('music-out').blur();
    await expect(page.getByTestId('save-state')).toContainText('Düzenleme saklandı', { timeout: 15_000 });

    await page.reload();
    await page.getByTestId('relink-video-input').setInputFiles(SAMPLE_VIDEO);
    await expect(page.getByTestId('preview-video')).toBeVisible({ timeout: 30_000 });

    await openSettings(page, 'audio');
    await expect(page.getByTestId('relink-audio')).toBeVisible();
    await page.getByTestId('relink-audio-input').setInputFiles(SAMPLE_AUDIO);

    await expect(page.getByTestId('music-file-name')).toHaveText('tone-30s.m4a', { timeout: 30_000 });
    // The edited segment survived the round trip.
    await expect(page.getByTestId('music-out')).toHaveValue('00:05.000');
  });

  test('export is blocked with the right reason while the source is missing', async ({ page }) => {
    await openEditor(page);
    await buildAndSave(page);
    await page.reload();
    await expect(page.getByTestId('relink-video')).toBeVisible({ timeout: 20_000 });

    // The top button waits for the video; a kesit's ⬇ says why it cannot run.
    await expect(page.getByTestId('download-all')).toBeDisabled();
    await page.getByTestId('kesit-download').first().click();
    await expect(page.getByTestId('export-blocked')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('export-blocked')).toContainText('video dosyası bu sekmede açık değil');
  });

  test('deleting the saved project clears it and keeps the app usable', async ({ page }) => {
    await openEditor(page);
    await buildAndSave(page);
    await page.reload();
    await expect(page.getByTestId('relink-video')).toBeVisible({ timeout: 20_000 });

    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByTestId('relink-discard').click();

    await expect(page.getByTestId('moment-count')).toHaveText('(0)', { timeout: 30_000 });
    await expect(page.getByTestId('relink-video')).toHaveCount(0);

    // Deleted means deleted: the autosave did not write it back on the way out.
    await expect(page.getByTestId('save-state')).toContainText('Düzenleme henüz saklanmadı');
    expect(await storedRecord(page)).toBeNull();

    // A fresh project can be started right away.
    await page.getByTestId('video-input').setInputFiles(SAMPLE_VIDEO);
    await expect(page.getByTestId('preview-video')).toBeVisible();
  });
});

/** Puts a record into the browser's project store as an earlier (or later) build would have left it. */
async function seedRecord(page: Page, record: unknown): Promise<void> {
  await page.evaluate(
    (value) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('clip-editor', 2);
        open.onupgradeneeded = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'projectId' });
          if (!db.objectStoreNames.contains('exportLog')) db.createObjectStore('exportLog', { keyPath: 'id', autoIncrement: true });
        };
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const transaction = db.transaction('projects', 'readwrite');
          transaction.objectStore('projects').put(value);
          transaction.oncomplete = () => {
            db.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
      }),
    record,
  );
}

const wholeRecord = (page: Page) => storedRecord(page) as unknown as Promise<Record<string, unknown> | null>;

test.describe('a project stored by another build of the app (EDL v5, ADR-043)', () => {
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

  test('the build before this one (v4): it opens, and the first save changes the schema number and nothing else', async ({ page }) => {
    // A transcript track with unclear spans, exactly as the v4 build wrote such a recipe (the shared fixture).
    const v4 = JSON.parse(readFileSync(join(process.cwd(), 'fixtures', 'edl', 'legacy-v4', 'caption-transcript-unclear.json'), 'utf8')) as Record<string, unknown>;
    expect(v4.schemaVersion).toBe(4);
    const edl = { ...v4, projectId: 'p_local_001' };
    const seeded = {
      recordVersion: 1,
      projectId: 'p_local_001',
      title: 'Eski sürümden',
      edl,
      bindings: [
        { assetId: 'a_video_001', kind: 'video', fileName: 'eski-kayit.mp4', sizeBytes: 1234, lastModified: 1_700_000_000_000, durationUs: 20_000_000, displayWidth: 1080, displayHeight: 1920, mimeType: 'video/mp4', fingerprint: 'fp_00000000', lastSeenAt: '2026-10-01T10:00:00.000Z' },
      ],
      createdAt: '2026-10-01T10:00:00.000Z',
      updatedAt: '2026-10-01T10:05:00.000Z',
    };
    await seedRecord(page, seeded);

    const errors = await openEditor(page);
    // It is the project: its name, its kesit, and it asks for its video.
    await expect(page.getByTestId('relink-video')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('relink-filename')).toHaveText('eski-kayit.mp4');
    await expect(page.getByTestId('project-title')).toHaveValue('Eski sürümden');
    await expect(page.getByTestId('moment-count')).toHaveText('(1)');

    // The autosave that follows the first load: v5, and otherwise the recipe the old build stored.
    await expect.poll(async () => ((await wholeRecord(page))?.edl as { schemaVersion?: number } | undefined)?.schemaVersion, { timeout: 15_000 }).toBe(5);
    const after = (await wholeRecord(page)) as typeof seeded & { updatedAt: string };
    expect({ ...after.edl, schemaVersion: 4 }).toEqual(edl);
    expect(JSON.stringify({ ...after.edl, schemaVersion: 4 })).toBe(JSON.stringify(edl));
    expect(after.bindings).toEqual(seeded.bindings);
    expect(after.title).toBe(seeded.title);
    expect(after.createdAt).toBe(seeded.createdAt);
    expect(JSON.stringify(after)).not.toContain('speaker');
    expect(errors).toEqual([]);
  });

  test('a backup file written by the v4 build is restored; one written by a newer build is refused in words', async ({ page }) => {
    const v4 = JSON.parse(readFileSync(join(process.cwd(), 'fixtures', 'edl', 'legacy-v4', 'caption-transcript-unclear.json'), 'utf8')) as Record<string, unknown>;
    const backup = {
      recordVersion: 1,
      projectId: 'p_fixture_001',
      title: 'Eski yedek',
      edl: v4,
      bindings: [
        { assetId: 'a_video_001', kind: 'video', fileName: 'eski-yedek.mp4', sizeBytes: 1234, lastModified: 1_700_000_000_000, durationUs: 20_000_000, displayWidth: 1080, displayHeight: 1920, mimeType: 'video/mp4', fingerprint: 'fp_00000000', lastSeenAt: '2026-10-01T10:00:00.000Z' },
      ],
      createdAt: '2026-10-01T10:00:00.000Z',
      updatedAt: '2026-10-01T10:05:00.000Z',
    };
    const errors = await openEditor(page);

    // From a later build first: nothing of it is taken, and the page says so (it stays the empty editor it was).
    await page.getByTestId('backup-input').setInputFiles({
      name: 'yarin.lilocut.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ ...backup, edl: { ...v4, schemaVersion: 6, speakerNames: { 1: 'Ayşe' } } })),
    });
    await openMore(page);
    await expect(page.getByTestId('backup-message')).toHaveText('Yedek dosyası okunamadı veya bu sürümle uyumlu değil.');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('relink-video')).toHaveCount(0);
    expect(await storedRecord(page)).toBeNull();

    // The v4 file, under the name the app gives its backups.
    await page.getByTestId('backup-input').setInputFiles({ name: 'eski.lilocut.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup, null, 2)) });
    await expect(page.getByTestId('relink-video')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('relink-filename')).toHaveText('eski-yedek.mp4');
    await expect(page.getByTestId('project-title')).toHaveValue('Eski yedek');
    await expect(page.getByTestId('moment-count')).toHaveText('(1)');
    // Stored as v5, the recipe otherwise as the file had it.
    await expect.poll(async () => ((await wholeRecord(page))?.edl as { schemaVersion?: number } | undefined)?.schemaVersion, { timeout: 15_000 }).toBe(5);
    const stored = (await wholeRecord(page)) as { edl: Record<string, unknown> };
    expect({ ...stored.edl, schemaVersion: 4 }).toEqual(v4);
    expect(errors).toEqual([]);
  });

  test('a NEWER build: the project is not opened, not written over, and the header says why', async ({ page }) => {
    // What this build would find if the browser served it after a later one had saved (a saved shell, an old tab).
    const newer = {
      recordVersion: 1,
      projectId: 'p_local_001',
      title: 'Yarının projesi',
      edl: { schemaVersion: 6, projectId: 'p_local_001', somethingThisBuildCannotKnow: { a: 1 } },
      bindings: [],
      createdAt: '2026-11-01T10:00:00.000Z',
      updatedAt: '2026-11-01T10:05:00.000Z',
    };
    await seedRecord(page, newer);

    const errors = await openEditor(page);
    await expect(page.getByTestId('save-state')).toContainText('Düzenleme saklanamadı', { timeout: 15_000 });
    await expect(page.getByTestId('save-state')).toContainText('daha yeni bir sürümle saklanmış');
    await expect(page.getByTestId('save-state')).toContainText('Sayfayı yenile');
    await expect(page.getByTestId('save-state')).not.toContainText('bozulmuş');
    // Nothing of it is shown as if it had been read.
    await expect(page.getByTestId('relink-video')).toHaveCount(0);
    await expect(page.getByTestId('project-title')).toHaveValue('');

    // Working on in this old page does not write over it: not by the autosave, not on the way out.
    await page.getByTestId('video-input').setInputFiles(SAMPLE_VIDEO);
    await expect(page.getByTestId('preview-video')).toBeVisible();
    await addMoment(page, '00:00.000', '00:04.000');
    await expect(page.getByTestId('moment-count')).toHaveText('(1)');
    await page.waitForTimeout(1500); // three times the autosave delay
    expect(await wholeRecord(page)).toEqual(newer);
    await expect(page.getByTestId('save-state')).toContainText('daha yeni bir sürümle saklanmış');
    // The way to keep this page's work is offered: the backup file.
    await expect(page.getByTestId('save-recover')).toBeVisible();

    await page.reload();
    await expect(page.getByTestId('save-state')).toContainText('daha yeni bir sürümle saklanmış', { timeout: 15_000 });
    expect(await wholeRecord(page)).toEqual(newer);
    expect(errors).toEqual([]);
  });
});

test.describe('storage failures are shown, not hidden', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('a browser that refuses IndexedDB still works and says saving failed', async ({ page }) => {
    // Fault injection: behave like a private window that denies storage.
    await page.addInitScript(() => {
      Object.defineProperty(window, 'indexedDB', {
        configurable: true,
        get() {
          throw new DOMException('denied', 'SecurityError');
        },
      });
    });

    const errors = await openEditor(page);
    await page.getByTestId('video-input').setInputFiles(SAMPLE_VIDEO);
    await expect(page.getByTestId('preview-video')).toBeVisible();
    await addMoment(page, '00:00.000', '00:04.000');

    // The editor keeps working...
    await expect(page.getByTestId('moment-count')).toHaveText('(1)');
    // ...and it does not claim the work is saved.
    await expect(page.getByTestId('save-state')).toContainText('Düzenleme saklanamadı', { timeout: 15_000 });
    await expect(page.getByTestId('save-state')).not.toContainText('Düzenleme saklandı ·');
    // A recovery route is offered.
    await expect(page.getByTestId('save-recover')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('the backup file carries the recipe and no media', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openEditor(page);
    await page.getByTestId('video-input').setInputFiles(SAMPLE_VIDEO);
    await expect(page.getByTestId('preview-video')).toBeVisible();
    await addMoment(page, '00:00.000', '00:04.000');

    await openMore(page);
    const download = page.waitForEvent('download');
    await page.getByTestId('backup-download').click();
    const saved = await download;
    // No project name was typed: the file is named after the app (ADR-038).
    expect(saved.suggestedFilename()).toBe(`${APP_SLUG}-projesi.${APP_SLUG}.json`);

    const stream = await saved.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString('utf8');
    const record = JSON.parse(text);

    expect(record.recordVersion).toBe(1);
    expect(record.edl.clips).toHaveLength(1);
    expect(record.bindings[0].fileName).toBe('sample-24s.mp4');
    // The recipe travels; the video does not.
    expect(text).not.toContain('blob:');
    expect(text).not.toContain('data:video');
    expect(text.length).toBeLessThan(20_000);
  });

  // The backup is read by the same check as the stored project.
  test('a backup of a video with no kesit can be restored', async ({ page, browser }) => {
    await openEditor(page);
    await page.getByTestId('video-input').setInputFiles(OTHER_VIDEO);
    await expect(page.getByTestId('preview-video')).toBeVisible();

    await openMore(page);
    const download = page.waitForEvent('download');
    await page.getByTestId('backup-download').click();
    const saved = await download;
    const chunks: Buffer[] = [];
    for await (const chunk of await saved.createReadStream()) chunks.push(chunk as Buffer);
    const buffer = Buffer.concat(chunks);
    expect(JSON.parse(buffer.toString('utf8')).edl.clips).toEqual([]);

    // A browser with nothing stored: the backup file is all there is.
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const fresh = await context.newPage();
    await openEditor(fresh);
    await expect(fresh.getByTestId('save-state')).toContainText('Düzenleme henüz saklanmadı');
    await expect(fresh.getByTestId('relink-video')).toHaveCount(0);

    // Under the name an older build gave its backups: the reader looks at the content, not the name.
    await fresh
      .getByTestId('backup-input')
      .setInputFiles({ name: 'yedek.clip.json', mimeType: 'application/json', buffer });

    await expect(fresh.getByTestId('relink-video')).toBeVisible({ timeout: 20_000 });
    await expect(fresh.getByTestId('relink-filename')).toHaveText('other-8s.mp4');
    await fresh.getByTestId('relink-video-input').setInputFiles(OTHER_VIDEO);
    await expect(fresh.getByTestId('preview-video')).toBeVisible({ timeout: 30_000 });
    await context.close();
  });
});
