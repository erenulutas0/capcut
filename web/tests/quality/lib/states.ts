/**
 * The screens the visual and the accessibility measurements look at, and
 * how to get to each of them. Synthetic media only.
 */

import { expect, type Page } from '@playwright/test';

import { enhanceFixture } from '../../e2e/enhance-media';
import { addKesit } from '../../e2e/kesitFlow';
import { silenceFixture } from '../../e2e/silence-media';
import { wizardFixture } from '../../e2e/wizard-media';
import { MUSIC, OTHER, SAMPLE, waitForResult } from './app';

export interface ScreenState {
  id: string;
  label: string;
  open: (page: Page) => Promise<void>;
  /** A wizard screen: its keyboard order is judged as one column. */
  wizard?: boolean;
}

async function pick(page: Page, task: string, file: string): Promise<void> {
  await page.goto(`/yap/${task}/`);
  await expect(page.getByTestId('wizard')).toHaveAttribute('data-step', 'pick');
  await page.getByTestId('video-input').setInputFiles(file);
}

export const STATES: ScreenState[] = [
  {
    id: 'ana-ekran',
    label: 'Ana ekran',
    open: async (page) => {
      await page.goto('/');
      await expect(page.getByTestId('task-grid')).toBeVisible();
    },
  },
  {
    id: 'ana-ekran-arama',
    label: 'Ana ekran, arama sonucu (“sessiz yerleri sil”)',
    open: async (page) => {
      await page.goto('/');
      await page.getByTestId('finder-input').fill('sessiz yerleri sil');
      await expect(page.getByTestId('finder-results')).toBeVisible();
    },
  },
  {
    // 11 Oct 2026: the words do not settle it — the rows are choices, none highlighted (taskSearch.ts, rule 12).
    id: 'ana-ekran-soru',
    label: 'Ana ekran, emin değilken seçenekler (“tiktok için kes”)',
    open: async (page) => {
      await page.goto('/');
      await page.getByTestId('finder-input').fill('tiktok için kes');
      await expect(page.getByTestId('finder-ask-hint')).toBeVisible();
    },
  },
  {
    id: 'ana-ekran-yapamiyoruz',
    label: 'Ana ekran, “Bunu henüz yapamıyoruz.” (“gif yap”)',
    open: async (page) => {
      await page.goto('/');
      await page.getByTestId('finder-input').fill('gif yap');
      await expect(page.getByTestId('result-unavailable').first()).toBeVisible();
    },
  },
  {
    id: 'ana-ekran-bulunamadi',
    label: 'Ana ekran, “Bunu bulamadım.”',
    open: async (page) => {
      await page.goto('/');
      await page.getByTestId('finder-input').fill('qwxz plmk');
      await expect(page.getByTestId('finder-none')).toBeVisible();
    },
  },
  {
    id: 'sihirbaz-ilk',
    label: 'Sihirbaz, ilk ekran (Dikey yap)',
    wizard: true,
    open: async (page) => {
      await page.goto('/yap/dikey/');
      await expect(page.getByTestId('pick-video')).toBeEnabled();
    },
  },
  {
    id: 'sihirbaz-dikey-secim',
    label: 'Dikey yap, seçim',
    wizard: true,
    open: async (page) => {
      await pick(page, 'dikey', OTHER);
      await expect(page.getByTestId('dikey-choice')).toBeVisible({ timeout: 60_000 });
    },
  },
  {
    id: 'sihirbaz-bosluk-secim',
    label: 'Boşlukları at, seçim',
    wizard: true,
    open: async (page) => {
      await pick(page, 'bosluk', silenceFixture('bursts').file);
      await expect(page.getByTestId('bosluk-summary')).toBeVisible({ timeout: 60_000 });
    },
  },
  {
    id: 'sihirbaz-kucult-secim',
    label: 'Küçült, seçim',
    wizard: true,
    open: async (page) => {
      await pick(page, 'kucult', SAMPLE);
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
    open: async (page) => {
      await pick(page, 'muzik', OTHER);
      await expect(page.getByTestId('muzik-pick')).toBeVisible({ timeout: 60_000 });
      await page.getByTestId('audio-input').setInputFiles(MUSIC);
      await expect(page.getByTestId('muzik-picked')).toBeVisible({ timeout: 60_000 });
    },
  },
  {
    id: 'sihirbaz-iyilestir-secim',
    label: 'İyileştir, seçim',
    wizard: true,
    open: async (page) => {
      await pick(page, 'iyilestir', enhanceFixture('dark'));
      await expect(page.getByTestId('enhance-preview')).toHaveAttribute('data-status', 'ready', { timeout: 180_000 });
      await expect(page.getByTestId('iyilestir-summary')).toBeVisible();
    },
  },
  {
    id: 'sihirbaz-yazi-model',
    label: 'Yazıya dök, model adımı',
    wizard: true,
    open: async (page) => {
      await pick(page, 'yazi', SAMPLE);
      await page.waitForSelector('[data-testid="model-download"], [data-testid="transcribe-start"]', { timeout: 60_000 });
    },
  },
  {
    id: 'sihirbaz-sonuc',
    label: 'Sihirbaz, sonuç ekranı (Her yerde açılsın)',
    wizard: true,
    open: async (page) => {
      await pick(page, 'cevir', wizardFixture('webm'));
      await expect(page.getByTestId('cevir-info')).toBeVisible({ timeout: 60_000 });
      await page.getByTestId('wizard-download').click();
      await waitForResult(page);
    },
  },
  {
    id: 'editor-bos',
    label: 'Editör, video yok',
    open: async (page) => {
      await page.goto('/editor/');
      await expect(page.getByTestId('download-all')).toBeVisible();
    },
  },
  {
    id: 'editor-video',
    label: 'Editör, video ve bir kesit',
    open: async (page) => {
      await page.goto('/editor/');
      await page.getByTestId('video-input').setInputFiles(OTHER);
      await expect(page.getByTestId('preview-video')).toBeVisible({ timeout: 60_000 });
      await addKesit(page, '1', '3');
      await expect(page.getByTestId('kesit-card')).toHaveCount(1);
    },
  },
];
