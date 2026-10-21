import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';

import { expect, expectPageRecovery, test, type Page, type TestInfo } from './fixtures';
import { availableTasks } from '../../src/domain/tasks';
import { en } from '../../src/i18n/messages.en';
import { tr } from '../../src/i18n/messages';
import { installSavePicker, pickerCalls, probeMp4, readSaved } from './kesitFlow';
import { shareFiles, storedShares, waitForWorker } from './shareKit';
import { silenceFixture } from './silence-media';
import { expectStylesApplied } from './stylesReady';
import { STUB_SCRIPT, expectTestBuild, installTranscriptTest, serveModels, testModels } from './transcriptKit';
import { enhanceFixture } from './enhance-media';

/**
 * The whole app in English (ADR-048), for a browser whose language is English.
 *
 * Every page is prerendered twice; the language script in <head>
 * (scripts/lib/language-redirect.js) puts an English reader on the English
 * twin before anything is drawn. Here: that no Turkish word is ever painted on
 * the way, that the language button is remembered, that every card works from
 * the English start screen to the saved file with English words and English
 * file names, and the editor, the privacy page, the page watchdog's notice, the
 * share target and axe — all in English.
 */

const SAMPLE = join(process.cwd(), 'tests', 'media', 'sample-24s.mp4'); // 1280×720, H.264 + AAC, 24 s
const OTHER = join(process.cwd(), 'tests', 'media', 'other-8s.mp4'); // 640×360, H.264 + AAC, 8 s
const MUSIC = join(process.cwd(), 'tests', 'media', 'tone-30s.m4a');
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

/** Words only the Turkish pages show (none of them is in the watchdog's hidden notice). */
const TURKISH_MARKERS = [tr['home.title'], tr['home.editorLink'], tr['wizard.pick.title'], tr['home.tasks.title'], tr['task.kes.sub'], tr['privacy.heading'], tr['preview.pickVideo']];

test.describe.configure({ timeout: 300_000 });
test.use({ locale: 'en-US', storageState: { cookies: [], origins: [] } });

const wizard = (page: Page) => page.getByTestId('wizard');
const title = (page: Page) => page.getByTestId('wizard-title');

/**
 * Before any page script, in every document of the tab: at each of the first frames, whether the page
 * was drawn and whether a Turkish word was on it. Kept in sessionStorage, so the Turkish page that was
 * replaced leaves its frames for the test to read on the English one.
 */
async function watchFirstFrames(page: Page) {
  await page.addInitScript((markers: string[]) => {
    const record = (frame: { path: string; hidden: boolean; turkish: string | null; at?: string; paints?: string[] }) => {
      try {
        const list = JSON.parse(sessionStorage.getItem('test:frames') ?? '[]') as unknown[];
        list.push(frame);
        sessionStorage.setItem('test:frames', JSON.stringify(list));
      } catch {
        // A test page without storage: nothing recorded, and the assertion below fails loudly.
      }
    };
    // The document exists (its first script has not run yet: this is before it).
    record({ path: location.pathname, hidden: false, turkish: null, at: 'start' });
    // What the browser had painted of it when it went away, and whether it was hidden then.
    addEventListener('pagehide', () =>
      record({
        path: location.pathname,
        hidden: document.documentElement.hasAttribute('hidden'),
        turkish: null,
        at: 'leave',
        paints: performance.getEntriesByType('paint').map((entry) => entry.name),
      }),
    );
    let frames = 0;
    const look = () => {
      const root = document.documentElement;
      const hidden = root.hasAttribute('hidden');
      const text = !hidden && document.body ? document.body.innerText : '';
      record({ path: location.pathname, hidden, turkish: markers.find((marker) => text.includes(marker)) ?? null });
      frames += 1;
      if (frames < 30) requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  }, TURKISH_MARKERS);
}

async function frames(page: Page) {
  return page.evaluate(
    () => JSON.parse(sessionStorage.getItem('test:frames') ?? '[]') as Array<{ path: string; hidden: boolean; turkish: string | null; at?: string; paints?: string[] }>,
  );
}

async function axe(page: Page, state: string, testInfo: TestInfo): Promise<string[]> {
  await expectStylesApplied(page, state, testInfo);
  const result = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  return result.violations.map((violation) => `${state} ${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`);
}

async function startTask(page: Page, id: string, file: string) {
  await page.goto('/en');
  await page.getByTestId(`task-${id}`).click();
  await expect(page).toHaveURL(new RegExp(`/en/yap/${id}$`));
  await expect(wizard(page)).toHaveAttribute('data-step', 'pick');
  await expect(title(page)).toHaveText(en['wizard.pick.title']);
  await page.getByTestId('video-input').setInputFiles(file);
}

async function download(page: Page) {
  await page.getByTestId('wizard-download').click();
  await expect(page.getByTestId('download-saved')).toBeVisible({ timeout: 240_000 });
  await expect(title(page)).toHaveText(en['wizard.result.saved']);
}

// ------------------------------------------------------------------ first paint

test.describe('first paint', () => {
  test('an English browser at the Turkish address sees the English start screen, and no Turkish word is ever drawn', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await watchFirstFrames(page);
    await page.goto('/');
    await expect(page).toHaveURL(/\/en$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByTestId('home-title')).toHaveText('What do you want to do?');
    await expect(page).toHaveTitle(`LiloCut — ${en['meta.home.title']}`);
    await expect(page.locator('html')).toHaveAttribute('data-clip-alive', '');
    const seen = await frames(page);
    // The Turkish page was there, and went away hidden: no animation frame of it ran visible, and what
    // the browser painted of it (if anything) was the hidden page — no word at all.
    expect(seen.some((frame) => frame.path === '/' && frame.at === 'start')).toBe(true);
    expect(seen.filter((frame) => frame.path === '/' && frame.at === undefined && !frame.hidden)).toEqual([]);
    const left = seen.find((frame) => frame.path === '/' && frame.at === 'leave');
    if (left && (left.paints ?? []).length > 0) expect(left.hidden).toBe(true);
    expect(seen.filter((frame) => frame.turkish !== null)).toEqual([]);
    // The English page itself: drawn from its first frame, in English.
    expect(seen.some((frame) => frame.path === '/en' && !frame.hidden)).toBe(true);
    // Nothing was remembered: the browser's language decided.
    expect(await page.evaluate(() => localStorage.getItem('clip.language'))).toBeNull();
    expect(errors).toEqual([]);
  });

  test('every English page is English in its prerendered HTML, before any script', async ({ request }) => {
    const paths = ['/en', '/en/editor', '/gizlilik/en', ...availableTasks().map((task) => `/en/yap/${task.id}`)];
    for (const path of paths) {
      const html = await (await request.get(path)).text();
      expect(html, path).toMatch(/<html lang="en"/);
      // The watchdog's notice is in both languages on purpose, hidden; everything else is English.
      const visible = html.replace(/<div class="update-notice page-dead-panel" data-clip-lang="tr"[\s\S]*?<\/div><\/div>/, '').replace(/<script[\s\S]*?<\/script>/g, '');
      for (const marker of TURKISH_MARKERS) expect(visible, `${path}: ${marker}`).not.toContain(marker);
      // The language script is the first script of the page, before the watchdog.
      expect(html.indexOf('data-clip-language')).toBeGreaterThan(0);
      expect(html.indexOf('data-clip-language')).toBeLessThan(html.indexOf('data-clip-watchdog'));
    }
    const home = await (await request.get('/en')).text();
    expect(home).toContain('What do you want to do?');
    expect(home).toContain(en['home.editorLink']);
    const turkish = await (await request.get('/')).text();
    expect(turkish).toMatch(/<html lang="tr"/);
    expect(turkish).toContain(tr['home.title']);
  });

  test('a Turkish browser at an English address is put on the Turkish page', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'tr-TR' });
    const page = await context.newPage();
    await page.goto('/en/yap/kes');
    await expect(page).toHaveURL(/\/yap\/kes$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'tr');
    await expect(title(page)).toHaveText(tr['wizard.pick.title']);
    await context.close();
  });

  test('an address that is no page says so in both languages', async ({ page }) => {
    const response = await page.goto('/nowhere');
    expect(response?.status()).toBe(404);
    await expect(page.getByTestId('not-found')).toContainText(en['notFound.title']);
    await expect(page.getByTestId('not-found')).toContainText(tr['notFound.title']);
    await expect(page.locator('html')).toHaveAttribute('data-clip-alive', '');
  });
});

// ------------------------------------------------------------------ the language button

test.describe('the language button', () => {
  test('“Türkçe” opens the Turkish page and is remembered, over the browser’s English; “English” brings it back', async ({ page }) => {
    await page.goto('/en');
    const button = page.getByTestId('language-switch');
    await expect(button).toHaveText('Türkçe');
    await expect(button).toHaveAttribute('lang', 'tr');
    const box = await button.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    // By keyboard.
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId('home-title')).toHaveText(tr['home.title']);
    // The word that carried the choice is gone from the address; the choice stays.
    expect(new URL(page.url()).search).toBe('');
    expect(await page.evaluate(() => localStorage.getItem('clip.language'))).toBe('tr');
    await page.reload();
    await expect(page.getByTestId('home-title')).toHaveText(tr['home.title']);
    // An English link now opens in Turkish: the choice wins over the browser.
    await page.goto('/en/yap/kucult');
    await expect(page).toHaveURL(/\/yap\/kucult$/);
    await expect(title(page)).toHaveText(tr['wizard.pick.title']);

    await page.goto('/');
    await expect(page.getByTestId('language-switch')).toHaveText('English');
    await page.getByTestId('language-switch').click();
    await expect(page).toHaveURL(/\/en$/);
    await expect(page.getByTestId('home-title')).toHaveText('What do you want to do?');
    expect(await page.evaluate(() => localStorage.getItem('clip.language'))).toBe('en');
  });

  test('before the page is alive the button is a plain link, and still remembered (the address carries it)', async ({ page }) => {
    await page.route('**/_next/static/chunks/*.js', (route) => route.abort());
    expectPageRecovery();
    await page.goto('/en/yap/ses');
    const href = await page.getByTestId('language-switch').count();
    // Wizards have no language button; the start screen does.
    expect(href).toBe(0);
    await page.goto('/en');
    await expect(page.getByTestId('language-switch')).toHaveAttribute('href', '/?lang=tr');
    await page.unroute('**/_next/static/chunks/*.js');
    await page.getByTestId('language-switch').click();
    await expect(page).toHaveURL(/\/$/);
    expect(await page.evaluate(() => localStorage.getItem('clip.language'))).toBe('tr');
  });

  test('the privacy page lists the choice and forgets it', async ({ page }) => {
    await page.goto('/gizlilik/en');
    await expect(page.locator('h1')).toHaveText(en['privacy.heading']);
    await expect(page.getByTestId('stored-language')).toContainText(en['privacy.stored.language.where']);
    await expect(page.getByTestId('language-storage-status')).toHaveText(en['privacy.language.absent']);
    // Choose English on purpose (Türkçe, then English), and come back.
    await page.getByTestId('privacy-language').click();
    await expect(page).toHaveURL(/\/gizlilik$/);
    await page.getByTestId('privacy-language').click();
    await expect(page).toHaveURL(/\/gizlilik\/en$/);
    await expect(page.getByTestId('language-storage-status')).toHaveText(en['privacy.language.present'].replace('{name}', 'English'));
    await page.getByTestId('language-storage-forget').click();
    await expect(page.getByTestId('language-storage-status')).toHaveText(en['privacy.language.forgotten']);
    expect(await page.evaluate(() => localStorage.getItem('clip.language'))).toBeNull();
  });
});

// ------------------------------------------------------------------ the start screen and the search

test.describe('the English start screen', () => {
  test('cards, examples and the search speak English and open the English wizards', async ({ page }) => {
    await page.goto('/en');
    await expect(page.getByTestId('task-grid').getByRole('link')).toHaveCount(availableTasks().length);
    for (const task of availableTasks()) {
      await expect(page.getByTestId(`task-${task.id}`)).toContainText(en[task.labelKey]);
      await expect(page.getByTestId(`task-${task.id}`)).toHaveAttribute('href', `/en/yap/${task.id}`);
    }
    await expect(page.getByTestId('finder-example')).toHaveText(['remove the silent parts', 'vertical for TikTok', 'cut the start', 'add music']);
    await expect(page.getByTestId('home-editor-link')).toHaveAttribute('href', '/en/editor');
    await expect(page.getByTestId('footer-privacy')).toHaveAttribute('href', '/gizlilik/en');

    const box = page.getByRole('combobox');
    await box.fill('make my video smaller for whatsapp');
    await expect(page.getByTestId('finder-results').getByRole('option').first()).toContainText(en['task.kucult.label']);
    await box.fill('rotate it');
    await expect(page.getByTestId('finder-results')).toContainText('We can’t do that yet.');
    await box.fill('zzqx');
    await expect(page.getByRole('heading', { name: en['home.results.none.title'] })).toBeVisible();
    await box.fill('remove the silent parts');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/en\/yap\/bosluk$/);
    await expect(title(page)).toHaveText(en['wizard.pick.title']);
  });
});

// ------------------------------------------------------------------ every card, in English

test.describe('every card, in English, to the saved file', () => {
  test.beforeEach(async ({ page }) => {
    await installSavePicker(page);
  });

  test('Cut: the editor, in English', async ({ page }) => {
    await startTask(page, 'kes', OTHER);
    await expect(page.getByTestId('preview-video')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('heading', { name: en['a11y.editorHeading'] })).toBeAttached();
    await expect(page.getByTestId('mark-start')).toContainText(en['range.setStart']);
    await expect(page.getByTestId('download-all')).toContainText(en['download.whole']);
    await page.getByTestId('download-all').click();
    await expect(page.getByTestId('download-saved')).toContainText('Saved: saved-other-8s_whole.mp4', { timeout: 240_000 });
    expect(await pickerCalls(page)).toEqual(['other-8s_whole.mp4']);
  });

  test('Remove silences', async ({ page }) => {
    const { file } = silenceFixture('bursts');
    await startTask(page, 'bosluk', file);
    await expect(page.getByTestId('bosluk-summary')).toBeVisible({ timeout: 60_000 });
    await expect(title(page)).toHaveText(en['wizard.bosluk.title']);
    await expect(page.getByTestId('wizard-step')).toContainText('Remove silences · Step 2 of 3');
    await expect(page.getByTestId('bosluk-found')).toHaveText('1 silent parts found.');
    await expect(page.getByTestId('bosluk-shorter')).toHaveText('Your video gets shorter: 4.5 s → 3.6 s');
    await download(page);
    expect(await pickerCalls(page)).toEqual(['bursts_no-silences.mp4']);
    await expect(page.getByTestId('download-saved')).toHaveText('Saved: saved-bursts_no-silences.mp4');
  });

  test('Make it vertical', async ({ page }, testInfo) => {
    await startTask(page, 'dikey', OTHER);
    await expect(title(page)).toHaveText(en['wizard.dikey.title'], { timeout: 60_000 });
    await expect(page.getByTestId('option-cover')).toBeChecked();
    await download(page);
    expect(await pickerCalls(page)).toEqual(['other-8s_vertical.mp4']);
    const probe = probeMp4(await readSaved(page, testInfo, 'saved-other-8s_vertical.mp4'));
    expect(probe.height).toBeGreaterThan(probe.width);
  });

  test('Shrink', async ({ page }) => {
    await startTask(page, 'kucult', SAMPLE);
    await expect(title(page)).toHaveText(en['wizard.kucult.title'], { timeout: 60_000 });
    await expect(page.getByTestId('option-whatsapp')).toBeChecked();
    await expect(page.getByTestId('size-hint-whatsapp')).toHaveText(/^(It will be about [\d.]+ (KB|MB)\.|Your video is already under this \([\d.]+ (KB|MB)\); there is nothing to shrink\.)/, { timeout: 60_000 });
    const already = (await page.getByTestId('size-hint-whatsapp').getAttribute('data-state')) === 'already';
    if (!already) {
      await download(page);
      expect(await pickerCalls(page)).toEqual(['sample-24s_small.mp4']);
    }
  });

  test('Speech to text (the scripted recogniser of the test build)', async ({ page, context }) => {
    const models = testModels();
    await serveModels(context, models);
    await installTranscriptTest(page, models, STUB_SCRIPT);
    await startTask(page, 'yazi', SAMPLE);
    await expectTestBuild(page);
    await expect(title(page)).toHaveText(en['wizard.yazi.title']);
    await expect(page.getByTestId('transcribe-english')).toContainText(en['transcript.english']);
    await expect(page.getByTestId('model-download')).toHaveText('Download the model (≈360 KB, once)');
    await page.getByTestId('model-download').click();
    await expect(page.getByTestId('transcribe-start')).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId('transcribe-start')).toHaveText(en['transcript.start']);
    await page.getByTestId('transcribe-start').click();
    await expect(page.getByTestId('transcript-panel')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('transcript-machine-note')).toContainText(en['transcript.machine']);
    await expect(page.getByTestId('yazi-summary')).toContainText('4 lines written');
    const [text] = await Promise.all([page.waitForEvent('download'), page.getByTestId('transcript-save-txt').click()]);
    expect(text.suggestedFilename()).toBe('sample-24s_text.txt');
    await download(page);
    expect(await pickerCalls(page)).toEqual(['sample-24s_captioned.mp4']);
  });

  test('Add music', async ({ page }) => {
    await startTask(page, 'muzik', OTHER);
    await expect(page.getByTestId('muzik-pick')).toBeVisible({ timeout: 60_000 });
    await expect(title(page)).toHaveText(en['wizard.muzik.title']);
    await expect(page.getByTestId('wizard-blocked')).toHaveText(en['wizard.muzik.first']);
    await page.getByTestId('audio-input').setInputFiles(MUSIC);
    await expect(page.getByTestId('muzik-length-note')).toHaveText(en['wizard.muzik.longer']);
    await download(page);
    expect(await pickerCalls(page)).toEqual(['other-8s_with-music.mp4']);
  });

  test('Get the sound', async ({ page }) => {
    await startTask(page, 'ses', OTHER);
    await expect(title(page)).toHaveText(en['wizard.ses.title'], { timeout: 60_000 });
    await download(page);
    expect(await pickerCalls(page)).toEqual(['other-8s_sound.m4a']);
  });

  test('Mute', async ({ page }) => {
    await startTask(page, 'sustur', OTHER);
    await expect(title(page)).toHaveText(en['wizard.sustur.title'], { timeout: 60_000 });
    await download(page);
    expect(await pickerCalls(page)).toEqual(['other-8s_muted.mp4']);
  });

  test('Make it play everywhere', async ({ page }) => {
    await startTask(page, 'cevir', OTHER);
    await expect(title(page)).toHaveText(en['wizard.cevir.title'], { timeout: 60_000 });
    await expect(page.getByTestId('wizard-step')).toContainText('Make it play everywhere · Step 2 of 3');
    await download(page);
    expect(await pickerCalls(page)).toEqual(['other-8s_plays-everywhere.mp4']);
  });

  test('Enhance', async ({ page }) => {
    await startTask(page, 'iyilestir', enhanceFixture('dark'));
    await expect(title(page)).toHaveText(en['wizard.iyilestir.title'], { timeout: 60_000 });
    await expect(page.getByTestId('iyilestir-info')).toContainText(en['wizard.iyilestir.body']);
    await expect(page.getByTestId('option-auto')).toBeChecked();
    await expect(page.getByTestId('iyilestir-summary')).toContainText(en['enhance.will.title'], { timeout: 120_000 });
    await download(page);
    expect((await pickerCalls(page))[0]).toMatch(/_enhanced\.mp4$/);
  });

  test('Make a GIF', async ({ page }) => {
    await startTask(page, 'gif', SAMPLE);
    await expect(title(page)).toHaveText(en['wizard.gif.title'], { timeout: 60_000 });
    await expect(page.getByLabel(en['wizard.gif.topLabel'])).toBeVisible();
    const estimate = page.getByTestId('gif-estimate');
    await expect(estimate).toHaveText(/^4\.0 s · about [\d.]+ (KB|MB)$/, { timeout: 60_000 });
    // ADR-052: the sharpest size under 10 MB, said in English; GIF or the video, GIF first.
    await expect(page.getByTestId('gif-size-picked')).toHaveText(en['wizard.gif.autoPicked'], { timeout: 120_000 });
    await expect(page.getByTestId('gif-output').locator('label')).toHaveText([en['wizard.gif.outputGif'], en['wizard.gif.outputVideo']]);
    await expect(page.getByTestId('gif-output-gif')).toBeChecked();
    await page.getByTestId('wizard-download').click();
    await expect(page.getByTestId('download-saved')).toHaveText('Saved: saved-sample-24s_gif.gif', { timeout: 120_000 });
    await expect(page.getByTestId('gif-result-line')).toContainText('4.0 s · loops for ever');
    // The same part as a video: the ordinary download, an .mp4.
    await page.getByTestId('wizard-again-same').click();
    await page.getByTestId('gif-output-video').check();
    await expect(page.getByTestId('gif-output-hint')).toHaveText(en['wizard.gif.videoNote']);
    await expect(page.getByTestId('gif-video-size')).toHaveText('Video: 1280 × 720, no sound, with your text.');
    await expect(page.getByTestId('wizard-download')).toHaveText(en['wizard.gif.downloadVideo']);
    await page.getByTestId('wizard-download').click();
    await expect(page.getByTestId('download-saved')).toHaveText('Saved: saved-sample-24s_gif.mp4', { timeout: 120_000 });
  });
});

// ------------------------------------------------------------------ the editor

test.describe('the English editor', () => {
  test('its words, its settings sheet with the language button, and its links', async ({ page }) => {
    await page.goto('/en/editor');
    await expect(page).toHaveTitle('LiloCut — editor');
    await expect(page.getByTestId('pick-video')).toContainText(en['preview.pickVideo']);
    await page.getByTestId('video-input').setInputFiles(OTHER);
    await expect(page.getByTestId('preview-video')).toBeVisible({ timeout: 60_000 });
    // The project is saved in this browser before the language changes (the save is debounced).
    await expect(page.getByTestId('save-state')).toContainText(en['topbar.saveState.saved'], { timeout: 30_000 });
    await page.getByTestId('open-settings').click();
    const language = page.getByTestId('settings-language');
    await expect(language).toContainText(en['language.title']);
    await expect(language).toContainText(en['language.note']);
    const button = page.getByTestId('editor-language');
    await expect(button).toHaveText('Türkçe');
    const box = await button.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    await button.click();
    await expect(page).toHaveURL(/\/editor$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'tr');
    // The project was kept: the Turkish editor asks for the same file again, in Turkish.
    await expect(page.getByText(tr['relink.title'])).toBeVisible({ timeout: 60_000 });
  });
});

// ------------------------------------------------------------------ the page watchdog, in English

test.describe('the page watchdog', () => {
  test.use({ serviceWorkers: 'block' });

  test('a page that never comes alive says so in English', async ({ page }) => {
    expectPageRecovery();
    await page.route('**/_next/static/chunks/*.js', (route) => route.fulfill({ status: 404, contentType: 'text/html', body: '<h1>404</h1>' }));
    await page.goto('/en/yap/cevir');
    const notice = page.getByTestId('page-dead');
    await expect(notice).toHaveAttribute('data-state', 'dead', { timeout: 40_000 });
    await expect(notice.locator('[data-clip-lang="en"]')).toBeVisible();
    await expect(notice.locator('[data-clip-lang="tr"]')).toBeHidden();
    await expect(notice.locator('[data-clip-lang="en"]')).toContainText(en['page.dead.title']);
    await expect(page.getByTestId('page-dead-reload-en')).toHaveText(en['page.dead.reload']);
  });
});

// ------------------------------------------------------------------ the share target

test.describe('the share target', () => {
  test('a video shared to the app opens on the English start screen with the video', async ({ page, baseURL }) => {
    await page.goto('/en');
    await waitForWorker(page);
    const landed = await shareFiles(page, [SAMPLE], new URL('/paylas/', baseURL ?? '').href);
    // The worker sends the share to the start screen; the language script takes it to the English one.
    expect(landed.pathname).toBe('/en');
    const id = landed.searchParams.get('paylasim') ?? '';
    expect(id).not.toBe('');
    await expect(page.getByTestId('home-title')).toHaveText(en['home.title.video']);
    await expect(page.getByTestId('home-video')).toHaveAccessibleName(en['home.video.shared']);
    await expect(page.getByTestId('home-video-length')).toHaveText('24.0 s');
    await expect(page.getByTestId('task-gif')).toHaveAttribute('href', `/en/yap/gif?paylasim=${id}`);
    await page.getByTestId('task-gif').click();
    await expect(page).toHaveURL(/\/en\/yap\/gif$/);
    await expect(wizard(page)).toHaveAttribute('data-step', 'choose', { timeout: 60_000 });
    await expect(page.getByTestId('wizard-step')).toContainText('Step 2 of 3');
    await expect.poll(() => storedShares(page)).toBeNull();
  });
});

// ------------------------------------------------------------------ axe

test.describe('accessibility, in English', () => {
  test('axe finds nothing on the English pages, on a phone and a computer', async ({ browser }, testInfo) => {
    const findings: string[] = [];
    for (const [name, viewport] of [
      ['phone', { width: 390, height: 844 }],
      ['desktop', { width: 1440, height: 900 }],
    ] as const) {
      const context = await browser.newContext({ locale: 'en-US', viewport, hasTouch: name === 'phone' });
      const page = await context.newPage();
      await page.goto('/en');
      findings.push(...(await axe(page, `${name} home`, testInfo)));
      await page.getByRole('combobox').fill('make it smaller');
      findings.push(...(await axe(page, `${name} home-search`, testInfo)));
      await page.goto('/en/yap/kucult');
      findings.push(...(await axe(page, `${name} wizard`, testInfo)));
      await page.goto('/en/editor');
      findings.push(...(await axe(page, `${name} editor`, testInfo)));
      await page.goto('/gizlilik/en');
      findings.push(...(await axe(page, `${name} privacy`, testInfo)));
      await context.close();
    }
    expect(findings).toEqual([]);
  });
});
