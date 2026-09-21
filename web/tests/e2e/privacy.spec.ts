import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * Privacy and support (roadmap P2-04, launch checklist B): the privacy page,
 * the local export log, "Sorun bildir" and the claim that a whole editing
 * session stays on this machine. docs/privacy/DATA_INVENTORY.md cites these
 * tests as the evidence for its network section.
 */

const SAMPLE_VIDEO = join(process.cwd(), 'tests', 'media', 'sample-24s.mp4');
const FILE_NAME = 'sample-24s.mp4';
const TITLE = 'Gizli aile projesi';
const CAPTION = 'Bu satır tanı dosyasına girmemeli';
const DRAFT = 'Taslak — veri sorumlusu bilgisi ve hukuki inceleme eksik (belge 30 K02)';

async function openEditor(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/editor');
  await expect(page.getByTestId('open-export')).toBeVisible();
  return errors;
}

async function importSample(page: Page) {
  await page.getByTestId('video-input').setInputFiles(SAMPLE_VIDEO);
  await expect(page.getByTestId('preview-video')).toBeVisible();
}

async function addMoment(page: Page, start: string, end: string) {
  await page.getByTestId('range-start').fill(start);
  await page.getByTestId('range-end').fill(end);
  await page.getByTestId('add-moment').click();
}

async function addCaption(page: Page, text: string) {
  await page.getByTestId('inspector-tab-captions').click();
  await page.getByRole('tab', { name: 'Sonuç', exact: true }).click();
  await expect(page.getByTestId('output-note')).toBeVisible();
  await page.getByTestId('captions-add').click();
  const field = page.getByTestId('cue-draft').getByTestId('cue-text');
  await expect(field).toBeFocused();
  await page.keyboard.type(text);
  await field.blur();
  await expect(page.getByTestId('cue-draft')).toHaveCount(0);
}

async function runExport(page: Page) {
  await page.getByTestId('open-export').click();
  await page.getByTestId('export-quality').selectOption('720');
  await page.getByTestId('export-ready').waitFor({ timeout: 60_000 });
  await page.getByTestId('export-create').click();
  await page.getByTestId('export-succeeded').waitFor({ timeout: 180_000 });
}

async function openReportFromHelp(page: Page) {
  await page.getByTestId('open-help').click();
  await page.getByTestId('open-report').click();
  const dialog = page.getByRole('dialog', { name: 'Sorun bildir' });
  await expect(dialog).toBeVisible();
  // The preview is built asynchronously (storage estimate, export log).
  await expect(page.getByTestId('diag-preview')).toHaveAttribute('aria-busy', 'false');
  return dialog;
}

async function previewJson(page: Page): Promise<Record<string, unknown>> {
  return JSON.parse((await page.getByTestId('diag-preview').textContent()) ?? '') as Record<string, unknown>;
}

/** Rows of the export log store, read straight from IndexedDB. */
function storedLog(page: Page): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(
    () =>
      new Promise<Array<Record<string, unknown>>>((resolve) => {
        const open = indexedDB.open('clip-editor');
        open.onerror = () => resolve([]);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains('exportLog')) {
            db.close();
            resolve([]);
            return;
          }
          const all = db.transaction('exportLog', 'readonly').objectStore('exportLog').getAll();
          all.onsuccess = () => {
            db.close();
            resolve(all.result as Array<Record<string, unknown>>);
          };
          all.onerror = () => {
            db.close();
            resolve([]);
          };
        };
      }),
  );
}

/** Polled with page.evaluate: waitForFunction does not await a Promise. */
async function waitForLog(page: Page, count: number) {
  const deadline = Date.now() + 15_000;
  let rows: Array<Record<string, unknown>> = [];
  while (Date.now() < deadline) {
    rows = await storedLog(page);
    if (rows.length === count) return rows;
    await page.waitForTimeout(150);
  }
  throw new Error(`export log has ${rows.length} rows, expected ${count}`);
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe('privacy page', () => {
  test('says what the app does, marked as a draft, with undecided facts left visibly open', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('footer-privacy').click();
    await expect(page).toHaveURL(/\/gizlilik$/);

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bu sürüm verini nasıl işliyor');
    await expect(page.getByTestId('privacy-draft')).toContainText(DRAFT);

    // Every controller fact is an explicit gap, not invented data.
    const controller = page.getByTestId('privacy-controller');
    await expect(controller.getByTestId('undecided')).toHaveCount(8);
    await expect(controller.getByTestId('undecided').first()).toHaveText('belirlenmedi');
    await expect(controller.getByTestId('undecided').first()).toBeVisible();

    // The stored items name the real stores and the real deletion rules.
    await expect(page.getByTestId('stored-project')).toContainText('“projects”');
    await expect(page.getByTestId('stored-log')).toContainText('Son 20 dışa aktarma denemesi');
    await expect(page.getByTestId('stored-temp')).toContainText('6 saatten eski');
    await expect(page.getByText('Çerez, localStorage ve sessionStorage kullanılmaz.')).toBeVisible();
    await expect(page.getByTestId('export-log-count')).toHaveText('Bu tarayıcıda kayıtlı dışa aktarma denemesi yok.');
    await expect(page.getByTestId('privacy-updated')).toContainText('sürüm 0.1.0');

    // English from the same keys.
    await page.getByTestId('privacy-language').click();
    await expect(page).toHaveURL(/\/gizlilik\/en$/);
    await expect(page.getByTestId('privacy-draft')).toContainText(
      'Draft — data controller details and legal review missing (doc 30 K02)',
    );
    await expect(page.getByTestId('privacy-controller').getByTestId('undecided').first()).toHaveText('not decided');
    await expect(page.locator('.legal')).toHaveAttribute('lang', 'en');
  });

  test('fits a 390 px phone without horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const path of ['/gizlilik', '/gizlilik/en', '/']) {
      await page.goto(path);
      await expect(page.locator('body')).toBeVisible();
      await noHorizontalScroll(page);
    }
  });
});

test.describe('report a problem', () => {
  test('help links the privacy page and opens a dialog whose file has no names or text', async ({ page }) => {
    const errors = await openEditor(page);
    await importSample(page);
    await page.getByTestId('project-title').fill(TITLE);
    await addMoment(page, '00:00.000', '00:04.000');
    await addCaption(page, CAPTION);

    await page.getByTestId('open-help').click();
    const privacyLink = page.getByTestId('help-privacy-link');
    await expect(privacyLink).toHaveAttribute('href', '/gizlilik');
    // A new tab: navigating away would drop the files opened in the editor.
    await expect(privacyLink).toHaveAttribute('target', '_blank');
    await page.getByTestId('open-report').click();

    const dialog = page.getByRole('dialog', { name: 'Sorun bildir' });
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId('diag-preview')).toHaveAttribute('aria-busy', 'false');
    await expect(page.getByTestId('report-excludes')).toContainText('Dosya adı, proje adı, altyazı metni');
    await expect(page.getByTestId('support-contact')).toHaveText(
      'İletişim adresi henüz belirlenmedi — dosyayı seni betaya davet eden kişiye gönder.',
    );

    const preview = (await page.getByTestId('diag-preview').textContent()) ?? '';
    const json = JSON.parse(preview) as {
      kind: string;
      app: { version: string; commit: string };
      features: Record<string, boolean>;
      project: { clipCount: number; captionLineCount: number };
      screen: { viewportWidth: number };
    };
    expect(json.kind).toBe('clip-diagnostics');
    expect(json.app.version).toBe('0.1.0');
    expect(json.app.commit).not.toBe('');
    expect(json.features.videoEncoder).toBe(true);
    expect(typeof json.features.opfs).toBe('boolean');
    expect(typeof json.features.webGpu).toBe('boolean');
    expect(json.project).toEqual(expect.objectContaining({ clipCount: 1, captionLineCount: 1 }));
    expect(json.screen.viewportWidth).toBe(1440);
    for (const secret of [FILE_NAME, 'sample-24s', TITLE, CAPTION, 'p_local_001']) {
      expect(preview).not.toContain(secret);
    }

    // The download is exactly the preview: nothing added on the way out.
    const download = page.waitForEvent('download');
    await page.getByTestId('diag-download').click();
    const saved = await download;
    expect(saved.suggestedFilename()).toMatch(/^clip-tani-\d{8}-\d{4}\.json$/);
    const content = readFileSync((await saved.path()) ?? '', 'utf8');
    expect(content).toBe(preview);

    // Stacked on help: Escape closes only the report, focus goes back to the
    // button that opened it, and the help dialog is still there.
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('open-report')).toBeFocused();
    await expect(page.getByRole('dialog', { name: 'Kısayollar ve bu sürümün sınırları' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('keyboard focus stays inside the report dialog', async ({ page }) => {
    await openEditor(page);
    await openReportFromHelp(page);
    const inside = () =>
      page.evaluate(() => Boolean(document.activeElement?.closest('[aria-labelledby="report-title"]')));
    for (let index = 0; index < 12; index += 1) {
      await page.keyboard.press('Tab');
      expect(await inside()).toBe(true);
    }
    // The preview is focusable, so it can be scrolled with the keyboard.
    await page.getByTestId('diag-preview').focus();
    await expect(page.getByTestId('diag-preview')).toBeFocused();
  });

  test('opens from a blocked export and stays on top of it', async ({ page }) => {
    await openEditor(page);
    await importSample(page);
    await addMoment(page, '00:00.000', '00:04.000');
    await expect(page.getByTestId('save-state')).toContainText('Kaydedildi', { timeout: 15_000 });
    // After a reload the recipe is back but the file is not: export is blocked.
    await page.reload();
    await expect(page.getByTestId('moment-count')).toHaveText('1 an', { timeout: 20_000 });
    await page.getByTestId('open-export').click();
    await expect(page.getByTestId('export-blocked')).toBeVisible();

    await page.getByTestId('export-report').click();
    const report = page.getByRole('dialog', { name: 'Sorun bildir' });
    await expect(report).toBeVisible();
    await expect(page.getByTestId('diag-preview')).toHaveAttribute('aria-busy', 'false');
    const json = await previewJson(page);
    expect(json.sessionErrors).toEqual(
      expect.arrayContaining([expect.objectContaining({ area: 'plan', code: expect.any(String) })]),
    );
    // Its overlay is above the export dialog, so the report is what is on top.
    const onTop = await page.evaluate(() => {
      const panel = document.querySelector('[aria-labelledby="report-title"]')?.getBoundingClientRect();
      if (!panel) return false;
      const hit = document.elementFromPoint(panel.left + panel.width / 2, panel.top + 20);
      return Boolean(hit?.closest('[aria-labelledby="report-title"]'));
    });
    expect(onTop).toBe(true);

    await page.keyboard.press('Escape');
    await expect(report).toHaveCount(0);
    await expect(page.getByTestId('export-blocked')).toBeVisible();
    await expect(page.getByTestId('export-report')).toBeFocused();
  });

  test('fits a 390 px phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openEditor(page);
    await page.getByTestId('tab-file').click();
    await page.getByRole('button', { name: 'Kısayollar ve sınırlar' }).click();
    await page.getByTestId('open-report').click();
    await expect(page.getByTestId('diag-preview')).toHaveAttribute('aria-busy', 'false');
    await noHorizontalScroll(page);
    const panel = await page.evaluate(() => {
      const element = document.querySelector<HTMLElement>('[aria-labelledby="report-title"]');
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, overflow: element.scrollWidth - element.clientWidth };
    });
    expect(panel).not.toBeNull();
    expect(panel?.left).toBeGreaterThanOrEqual(0);
    expect(panel?.right).toBeLessThanOrEqual(390);
    expect(panel?.overflow).toBe(0);
  });
});

test.describe('local export log', () => {
  test('a real export adds one entry with numbers only; "Günlüğü temizle" empties it', async ({ page }) => {
    await openEditor(page);
    await importSample(page);
    await addMoment(page, '00:00.000', '00:02.000');
    await addCaption(page, CAPTION);
    await runExport(page);

    const rows = await waitForLog(page, 1);
    const row = rows[0] ?? {};
    expect(row.outcome).toBe('succeeded');
    expect(row.failureCode).toBeNull();
    expect(row.width).toBe(1280);
    expect(row.height).toBe(720);
    expect(['opfs', 'memory']).toContain(row.route);
    expect(row.outputDurationMs).toBeGreaterThan(1900);
    expect(row.outputDurationMs).toBeLessThan(2100);
    expect(row.elapsedMs).toBeGreaterThan(0);
    expect(String(row.planPrefix)).toMatch(/^fp_[0-9a-f]{6}$/);
    expect(new Date(String(row.at)).getTime()).toBeGreaterThan(Date.now() - 5 * 60_000);
    const serialized = JSON.stringify(row);
    for (const secret of [FILE_NAME, 'sample-24s', CAPTION]) expect(serialized).not.toContain(secret);

    // Close the export dialog, then look at the log through "Sorun bildir".
    await page.keyboard.press('Escape');
    await openReportFromHelp(page);
    await expect(page.getByTestId('export-log-count')).toHaveText('1 deneme kayıtlı (en fazla 20).');
    await expect(page.getByTestId('export-log-entry')).toHaveAttribute('data-outcome', 'succeeded');
    const json = await previewJson(page);
    expect(json.exportLog).toEqual([expect.objectContaining({ outcome: 'succeeded', width: 1280, height: 720 })]);

    await page.getByTestId('export-log-clear').click();
    await expect(page.getByTestId('export-log-message')).toHaveText('Günlük temizlendi.');
    await expect(page.getByTestId('export-log-count')).toHaveText('Bu tarayıcıda kayıtlı dışa aktarma denemesi yok.');
    // The preview is rebuilt, so the file would no longer carry the log.
    await expect.poll(async () => (await previewJson(page)).exportLog).toEqual([]);
    expect(await storedLog(page)).toEqual([]);
  });

  test('keeps only the last 20 attempts in the real database', async ({ page }) => {
    await openEditor(page);
    await importSample(page);
    await addMoment(page, '00:00.000', '00:02.000');

    // 24 older rows, as if written by earlier sessions.
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const open = indexedDB.open('clip-editor');
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            const transaction = db.transaction('exportLog', 'readwrite');
            const store = transaction.objectStore('exportLog');
            for (let index = 0; index < 24; index += 1) {
              store.add({
                at: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
                outcome: 'failed',
                failureCode: 'internal_error',
                outputDurationMs: 1000,
                width: 720,
                height: 1280,
                route: null,
                elapsedMs: index,
                planPrefix: 'fp_000000',
              });
            }
            transaction.oncomplete = () => {
              db.close();
              resolve();
            };
            transaction.onerror = () => reject(transaction.error);
          };
        }),
    );

    await runExport(page);
    const rows = await waitForLog(page, 20);
    // The newest (real) attempt is kept, the five oldest seeded ones are gone.
    expect(rows[rows.length - 1]?.outcome).toBe('succeeded');
    expect(rows[0]?.elapsedMs).toBe(5);
  });

  test('upgrading a v1 database keeps the saved project and adds the log store', async ({ page }) => {
    await openEditor(page);
    await importSample(page);
    await addMoment(page, '00:00.000', '00:04.000');
    await addMoment(page, '00:08.000', '00:14.000');
    await expect(page.getByTestId('save-state')).toContainText('Kaydedildi', { timeout: 15_000 });

    const record = await page.evaluate(
      () =>
        new Promise<unknown>((resolve, reject) => {
          const open = indexedDB.open('clip-editor');
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            const get = db.transaction('projects', 'readonly').objectStore('projects').getAll();
            get.onsuccess = () => {
              db.close();
              resolve(get.result[0]);
            };
            get.onerror = () => reject(get.error);
          };
        }),
    );
    expect(record).toBeTruthy();

    // Rebuild the database exactly as the previous build left it: version 1,
    // one 'projects' store. Done from a static file of the same origin, so no
    // app code holds a connection while it happens.
    await page.goto('/fonts/caption/OFL.txt');
    const version = await page.evaluate(
      (saved) =>
        new Promise<number>((resolve, reject) => {
          const drop = indexedDB.deleteDatabase('clip-editor');
          drop.onerror = () => reject(drop.error);
          drop.onsuccess = () => {
            const open = indexedDB.open('clip-editor', 1);
            open.onupgradeneeded = () => {
              open.result.createObjectStore('projects', { keyPath: 'projectId' });
            };
            open.onerror = () => reject(open.error);
            open.onsuccess = () => {
              const db = open.result;
              const transaction = db.transaction('projects', 'readwrite');
              transaction.objectStore('projects').put(saved);
              transaction.oncomplete = () => {
                const found = db.version;
                db.close();
                resolve(found);
              };
            };
          };
        }),
      record,
    );
    expect(version).toBe(1);

    await page.goto('/editor');
    await expect(page.getByTestId('moment-count')).toHaveText('2 an', { timeout: 20_000 });
    await expect(page.getByTestId('relink-filename')).toHaveText(FILE_NAME);

    const after = await page.evaluate(
      () =>
        new Promise<{ version: number; stores: string[]; projects: number }>((resolve, reject) => {
          const open = indexedDB.open('clip-editor');
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            const count = db.transaction('projects', 'readonly').objectStore('projects').count();
            count.onsuccess = () => {
              const result = { version: db.version, stores: Array.from(db.objectStoreNames).sort(), projects: count.result };
              db.close();
              resolve(result);
            };
          };
        }),
    );
    expect(after).toEqual({ version: 2, stores: ['exportLog', 'projects'], projects: 1 });
  });
});

test.describe('nothing leaves the machine', () => {
  test('a full session contacts only the app origin, and only for app files', async ({ page, context, baseURL }) => {
    test.setTimeout(300_000);
    const ownOrigin = new URL(baseURL ?? 'http://127.0.0.1:3100').origin;
    const external: string[] = [];
    const own: Array<{ method: string; path: string; hasBody: boolean; type: string }> = [];
    const websockets: string[] = [];

    // Context-wide, so requests from workers are seen as well as the page's.
    const watch = (target: BrowserContext) =>
      target.on('request', (request) => {
        const url = request.url();
        if (url.startsWith('blob:') || url.startsWith('data:')) return;
        if (!url.startsWith(`${ownOrigin}/`)) {
          external.push(url);
          return;
        }
        const parsed = new URL(url);
        own.push({
          method: request.method(),
          path: parsed.pathname,
          hasBody: request.postDataBuffer() !== null,
          type: request.resourceType(),
        });
      });
    watch(context);
    page.on('websocket', (socket) => websockets.push(socket.url()));

    await page.goto('/');
    await page.getByTestId('footer-privacy').click();
    await expect(page.getByTestId('privacy-draft')).toBeVisible();
    await openEditor(page);
    await importSample(page);
    await addMoment(page, '00:00.000', '00:02.000');
    await addMoment(page, '00:05.000', '00:06.000');
    await addCaption(page, CAPTION);

    // Silence analysis (decodes audio in a worker).
    await page.getByTestId('open-silence').click();
    await expect(page.getByRole('dialog', { name: 'Sessizlikleri bul' })).toBeVisible();
    await expect(page.getByTestId('silence-running')).toHaveCount(0, { timeout: 30_000 });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // Subtitle download.
    let download = page.waitForEvent('download');
    await page.getByTestId('caption-export-srt').click();
    expect((await download).suggestedFilename()).toMatch(/\.srt$/);

    // Export with burned-in captions, and the MP4 download.
    await runExport(page);
    download = page.waitForEvent('download');
    await page.getByTestId('export-download').click();
    expect((await download).suggestedFilename()).toMatch(/\.mp4$/);
    await page.keyboard.press('Escape');

    // Project backup download (the backup panel lives in the phone file sheet).
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByTestId('tab-file').click();
    download = page.waitForEvent('download');
    await page.getByTestId('backup-download').click();
    expect((await download).suggestedFilename()).toMatch(/\.clip\.json$/);
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1440, height: 900 });

    // Diagnostics download.
    await openReportFromHelp(page);
    download = page.waitForEvent('download');
    await page.getByTestId('diag-download').click();
    expect((await download).suggestedFilename()).toMatch(/\.json$/);
    await page.waitForTimeout(500);

    expect(external, `beklenmeyen dış istek: ${external.join(', ')}`).toEqual([]);
    expect(websockets).toEqual([]);

    // The app's own origin serves app files only: pages, build assets, the
    // caption typeface. Nothing is posted, nothing carries a body.
    const allowed = [
      /^\/$/,
      /^\/editor$/,
      /^\/gizlilik(\/en)?$/,
      /^\/_next\/static\//,
      /^\/fonts\/caption\/inter-latin(-ext)?-700-normal\.woff2$/,
      /^\/favicon\.ico$/,
    ];
    // PRIVACY_LIST_REQUESTS=1 prints what was fetched, to keep the inventory's list current.
    if (process.env.PRIVACY_LIST_REQUESTS) {
      const summary = [...new Set(own.map((item) => `${item.method} ${item.type} ${item.path}`))].sort();
      console.log(summary.join('\n'));
    }
    const unexpected = own.filter((item) => !allowed.some((pattern) => pattern.test(item.path)));
    expect(unexpected, `beklenmeyen uygulama isteği: ${JSON.stringify(unexpected)}`).toEqual([]);
    expect(own.filter((item) => item.method !== 'GET' || item.hasBody)).toEqual([]);
    // The worker really fetched the typeface from the app origin (export with captions).
    expect(own.some((item) => item.path.endsWith('.woff2'))).toBe(true);

    // And no identifiers were left behind: no cookies, no web storage.
    expect(await context.cookies()).toEqual([]);
    const webStorage = await page.evaluate(() => ({
      cookie: document.cookie,
      local: window.localStorage.length,
      session: window.sessionStorage.length,
    }));
    expect(webStorage).toEqual({ cookie: '', local: 0, session: 0 });
  });
});
