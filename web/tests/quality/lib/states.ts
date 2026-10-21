/**
 * The screens the visual and the accessibility measurements look at, and
 * how to get to each of them. Synthetic media only.
 */

import { expect, type Page } from '@playwright/test';

import { enhanceFixture } from '../../e2e/enhance-media';
import { addKesit } from '../../e2e/kesitFlow';
import { silenceFixture } from '../../e2e/silence-media';
import { soundFixFixture } from '../../e2e/soundfix-media';
import { wizardFixture } from '../../e2e/wizard-media';
import { layoutModeFor } from '../../../src/components/editor/layoutMode';
import type { Locale } from '../../../src/i18n/translate';
import { MUSIC, OTHER, SAMPLE, pageLive, pathFor, waitForResult, wizardLive } from './app';

export interface ScreenState {
  id: string;
  label: string;
  /** ADR-048: in the project's language (an English browser is on the English pages). */
  open: (page: Page, lang?: Locale) => Promise<void>;
  /** A wizard screen: its keyboard order is judged as one column. */
  wizard?: boolean;
}

/** What is typed into the box, in each language: the same four answers. */
const TYPED: Record<'found' | 'ask' | 'cannot', Record<Locale, string>> = {
  found: { tr: 'sessiz yerleri sil', en: 'remove the silent parts' },
  ask: { tr: 'tiktok için kes', en: 'cut it for tiktok' },
  cannot: { tr: 'videoyu döndür', en: 'rotate the video' },
};

/**
 * The editor as it is once it is live, laid out for this window. The prerendered page is the wide
 * layout (`useLayoutMode`), and a phone switches to its own after hydration, in a transition: what
 * is measured before that is the wide top bar squeezed into 390 px. Seen 20 Oct 2026 in one quality
 * run of three on the same code: "Proje adı" (the wide bar's title box) 22 × 38 px, and not reached
 * by Tab — it was gone by the time Tab ran; "Ayarlar" with its word, as the wide bar has it.
 * `download-all` is in the prerendered page, so waiting for it is not enough. The hidden video input
 * exists only once the page is hydrated; then the root says which layout it shows.
 */
async function editorLaidOut(page: Page): Promise<void> {
  await pageLive(page);
  await expect(page.getByTestId('video-input')).toBeAttached({ timeout: 30_000 });
  const width = page.viewportSize()?.width ?? (await page.evaluate(() => window.innerWidth));
  await expect(page.locator('.editor-root')).toHaveAttribute('data-mode', layoutModeFor(width), { timeout: 30_000 });
}

/**
 * The opening screen, live, before a word is typed into its box. The prerendered box takes typing
 * too (TaskFinder reads what was typed before hydration), but the answer is only drawn by the live
 * page: what is measured must be that page, not a race between the two.
 */
async function openHome(page: Page, lang: Locale): Promise<void> {
  await page.goto(pathFor('/', lang));
  await pageLive(page);
}

async function pick(page: Page, task: string, file: string, lang: Locale = 'tr'): Promise<void> {
  await page.goto(pathFor(`/yap/${task}/`, lang));
  await wizardLive(page);
  await page.getByTestId('video-input').setInputFiles(file);
}

export const STATES: ScreenState[] = [
  {
    id: 'ana-ekran',
    label: 'Ana ekran',
    open: async (page, lang = 'tr') => {
      await page.goto(pathFor('/', lang));
      await expect(page.getByTestId('task-grid')).toBeVisible();
      await pageLive(page);
    },
  },
  {
    id: 'ana-ekran-arama',
    label: 'Ana ekran, arama sonucu (“sessiz yerleri sil”)',
    open: async (page, lang = 'tr') => {
      await openHome(page, lang);
      await page.getByTestId('finder-input').fill(TYPED.found[lang]);
      await expect(page.getByTestId('finder-results')).toBeVisible();
    },
  },
  {
    // 11 Oct 2026: the words do not settle it — the rows are choices, none highlighted (taskSearch.ts, rule 12).
    id: 'ana-ekran-soru',
    label: 'Ana ekran, emin değilken seçenekler (“tiktok için kes”)',
    open: async (page, lang = 'tr') => {
      await openHome(page, lang);
      await page.getByTestId('finder-input').fill(TYPED.ask[lang]);
      await expect(page.getByTestId('finder-ask-hint')).toBeVisible();
    },
  },
  {
    id: 'ana-ekran-yapamiyoruz',
    label: 'Ana ekran, “Bunu henüz yapamıyoruz.” (“videoyu döndür”)',
    open: async (page, lang = 'tr') => {
      await openHome(page, lang);
      await page.getByTestId('finder-input').fill(TYPED.cannot[lang]);
      await expect(page.getByTestId('result-unavailable').first()).toBeVisible();
    },
  },
  {
    id: 'ana-ekran-bulunamadi',
    label: 'Ana ekran, “Bunu bulamadım.”',
    open: async (page, lang = 'tr') => {
      await openHome(page, lang);
      await page.getByTestId('finder-input').fill('qwxz plmk');
      await expect(page.getByTestId('finder-none')).toBeVisible();
    },
  },
  {
    id: 'sihirbaz-ilk',
    label: 'Sihirbaz, ilk ekran (Dikey yap)',
    wizard: true,
    open: async (page, lang = 'tr') => {
      await page.goto(pathFor('/yap/dikey/', lang));
      await wizardLive(page);
    },
  },
  {
    id: 'sihirbaz-dikey-secim',
    label: 'Dikey yap, seçim',
    wizard: true,
    open: async (page, lang = 'tr') => {
      await pick(page, 'dikey', OTHER, lang);
      await expect(page.getByTestId('dikey-choice')).toBeVisible({ timeout: 60_000 });
    },
  },
  {
    id: 'sihirbaz-bosluk-secim',
    label: 'Boşlukları at, seçim',
    wizard: true,
    open: async (page, lang = 'tr') => {
      await pick(page, 'bosluk', silenceFixture('bursts').file, lang);
      await expect(page.getByTestId('bosluk-summary')).toBeVisible({ timeout: 60_000 });
    },
  },
  {
    id: 'sihirbaz-kucult-secim',
    label: 'Küçült, seçim',
    wizard: true,
    open: async (page, lang = 'tr') => {
      await pick(page, 'kucult', SAMPLE, lang);
      await expect(page.getByTestId('kucult-choice')).toBeVisible({ timeout: 60_000 });
      for (const id of ['share', 'email', 'whatsapp']) {
        await expect(page.getByTestId(`size-hint-${id}`)).not.toHaveAttribute('data-state', 'pending', { timeout: 60_000 });
      }
    },
  },
  {
    id: 'sihirbaz-muzik-secim',
    label: 'Müzik ekle, seçim (müzik seçilmiş)',
    wizard: true,
    open: async (page, lang = 'tr') => {
      await pick(page, 'muzik', OTHER, lang);
      await expect(page.getByTestId('muzik-pick')).toBeVisible({ timeout: 60_000 });
      await page.getByTestId('audio-input').setInputFiles(MUSIC);
      await expect(page.getByTestId('muzik-picked')).toBeVisible({ timeout: 60_000 });
    },
  },
  {
    id: 'sihirbaz-iyilestir-secim',
    label: 'İyileştir, seçim',
    wizard: true,
    open: async (page, lang = 'tr') => {
      await pick(page, 'iyilestir', enhanceFixture('dark'), lang);
      await expect(page.getByTestId('enhance-preview')).toHaveAttribute('data-status', 'ready', { timeout: 180_000 });
      await expect(page.getByTestId('iyilestir-summary')).toBeVisible();
    },
  },
  {
    // ADR-046, mockup B: the one screen, with a text typed into each box.
    id: 'sihirbaz-gif-secim',
    label: 'GIF yap, tek ekran (iki yazı yazılmış)',
    wizard: true,
    open: async (page, lang = 'tr') => {
      await pick(page, 'gif', SAMPLE, lang);
      const estimate = page.getByTestId('gif-estimate');
      await expect(estimate).toHaveAttribute('data-state', 'ready', { timeout: 60_000 });
      await page.getByTestId('gif-text-top').fill('PAZARTESİ SABAHI');
      await page.getByTestId('gif-text-bottom').fill('kahveden önce ben');
      await page.getByTestId('gif-text-bottom').blur();
      await page.getByTestId('gif-play').click();
      await expect(estimate).toHaveAttribute('data-state', 'ready', { timeout: 60_000 });
      // A moving picture is masked in every screenshot, and the mask would cover the two text boxes on it:
      // the picture is hidden instead (the frame shows black), so the boxes and their letters are compared.
      await page.getByTestId('gif-video').evaluate((video: HTMLVideoElement) => {
        video.style.display = 'none';
      });
    },
  },
  {
    // ADR-049: the summary of an uneven recording (the longest the screen gets: the change, "uneven", the listen buttons).
    id: 'sihirbaz-duzelt-secim',
    label: 'Sesi düzelt, özet (dengesiz konuşma)',
    wizard: true,
    open: async (page, lang = 'tr') => {
      await pick(page, 'duzelt', soundFixFixture('uneven'), lang);
      await expect(page.getByTestId('duzelt-summary')).toBeVisible({ timeout: 120_000 });
      await expect(page.getByTestId('duzelt-summary')).not.toHaveAttribute('data-copy', '');
    },
  },
  {
    id: 'sihirbaz-yazi-model',
    label: 'Yazıya dök, model adımı',
    wizard: true,
    open: async (page, lang = 'tr') => {
      await pick(page, 'yazi', SAMPLE, lang);
      await page.waitForSelector('[data-testid="model-download"], [data-testid="transcribe-start"]', { timeout: 60_000 });
    },
  },
  {
    id: 'sihirbaz-sonuc',
    label: 'Sihirbaz, sonuç ekranı (Her yerde açılsın)',
    wizard: true,
    open: async (page, lang = 'tr') => {
      await pick(page, 'cevir', wizardFixture('webm'), lang);
      await expect(page.getByTestId('cevir-info')).toBeVisible({ timeout: 60_000 });
      await page.getByTestId('wizard-download').click();
      await waitForResult(page);
    },
  },
  {
    id: 'editor-bos',
    label: 'Editör, video yok',
    open: async (page, lang = 'tr') => {
      await page.goto(pathFor('/editor/', lang));
      await editorLaidOut(page);
      await expect(page.getByTestId('download-all')).toBeVisible();
    },
  },
  {
    id: 'editor-video',
    label: 'Editör, video ve bir kesit',
    open: async (page, lang = 'tr') => {
      await page.goto(pathFor('/editor/', lang));
      await editorLaidOut(page);
      await page.getByTestId('video-input').setInputFiles(OTHER);
      await expect(page.getByTestId('preview-video')).toBeVisible({ timeout: 60_000 });
      await addKesit(page, '1', '3');
      await expect(page.getByTestId('kesit-card')).toHaveCount(1);
    },
  },
];
