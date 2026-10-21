/**
 * Driving the app for the measurements: where the test media is, how a
 * finished file is taken out of the browser, how a result is waited for.
 *
 * Texts come from the app's own message table, so a renamed button or
 * product does not break the scripts — it only changes what they read.
 */

import { copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, type TestInfo } from '@playwright/test';

import { localizedPath } from '../../../src/i18n/localePath';
import { translator, type MessageKey } from '../../../src/i18n/messages';
import '../../../src/i18n/messages.en';
import type { Locale } from '../../../src/i18n/translate';
import { PAGE_ALIVE_ATTRIBUTE, PAGE_PENDING_ATTRIBUTE } from '../../../src/pageWatchdog';
import { installSavePicker, noSavePicker, pickerCalls, readSaved } from '../../e2e/kesitFlow';
import { OUTPUTS, ensureDir } from './record';

export const t: (key: MessageKey) => string = translator('tr');

/** ADR-048: the projects named "-en" are an English browser (playwright.quality.config.ts). */
export const langOf = (testInfo: TestInfo): Locale => (testInfo.project.name.endsWith('-en') ? 'en' : 'tr');

/** The words of the project's language. */
export const wordsFor = (testInfo: TestInfo): ((key: MessageKey) => string) => translator(langOf(testInfo));

/** An app address in the project's language, with the trailing slash of the static export: `/yap/kes/` → `/en/yap/kes/`. */
export function pathFor(path: string, lang: Locale): string {
  const localized = localizedPath(path, lang);
  return localized.endsWith('/') ? localized : `${localized}/`;
}

export const SAMPLE = join(process.cwd(), 'tests', 'media', 'sample-24s.mp4'); // 1280×720, H.264 + AAC, 24 s, a test card
export const OTHER = join(process.cwd(), 'tests', 'media', 'other-8s.mp4'); // 640×360, H.264 + AAC, 8 s
export const MUSIC = join(process.cwd(), 'tests', 'media', 'tone-30s.m4a');
export const SPEECH = join(process.cwd(), 'tests', 'media', 'speech-fleurs-en-01.mp4');

export const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** An accessible name that starts with this text (a card's name is its label followed by its second line). */
export const startsWith = (text: string): RegExp => new RegExp(`^\\s*${escapeRegExp(text)}`);

export const isPhone = (testInfo: TestInfo): boolean => testInfo.project.use.hasTouch === true;

/**
 * The page is live: what a measurement may read. Every page is prerendered HTML first — its words, its
 * cards, a wizard's first screen are on the screen before any of the app's code ran — so "the heading
 * is visible" says nothing about whether the screen is the one a person meets a moment later. Live is
 * the page watchdog's own condition (src/pageWatchdog.ts): `<html data-clip-alive>` (an effect of the
 * root layout: React has taken the page over) and no part still waiting for its code
 * (`data-clip-pending`: a wizard's first screen until it is hydrated). Measured 21 Oct 2026 with the
 * page's CPU slowed 6× (two runs in each of the four views; docs/quality/bulgular.md): the opening screen
 * was read before it was live in 24 of 136 readings — "Ana ekran" and the first look of every
 * walkthrough. Its prerendered words and control sizes were those of the live page, so no number
 * changed; the editor, whose prerendered layout is NOT the phone's, did change (3868d4c). Waiting for
 * live makes "the same screen" something checked on every run instead of luck.
 */
export async function pageLive(page: Page): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute(PAGE_ALIVE_ATTRIBUTE, '', { timeout: 60_000 });
  await expect(page.locator(`[${PAGE_PENDING_ATTRIBUTE}]`)).toHaveCount(0, { timeout: 60_000 });
}

/**
 * A wizard's first screen as it is once live. The prerendered one is drawn for a wide window with a
 * mouse ("Dosyalarından seç ya da videoyu buraya sürükleyip bırak"); a phone switches to its own words
 * ("Galeriden ya da dosyalardan") after hydration, in a transition (components/useBrowserValue.ts).
 * "Video seç" is enabled by that same switch: the wizard's three browser values (hydrated, layout,
 * touch screen) are set in one passive-effect pass, so React renders them in one transition.
 */
export async function wizardLive(page: Page): Promise<void> {
  await expect(page.getByTestId('wizard')).toHaveAttribute('data-step', 'pick');
  await pageLive(page);
  await expect(page.getByTestId('pick-video')).toBeEnabled({ timeout: 60_000 });
}

/**
 * How the file leaves the browser.
 *
 * Desktop: Chrome and Edge have a save dialog; the stand-in of kesitFlow.ts
 * returns a file in the page's own storage through the same kind of handle.
 * Phone: no browser on a phone has that dialog, so it is removed and the
 * app takes the route a phone takes ("Kaydet" after the file is ready).
 */
export async function setupSaving(page: Page, phone: boolean): Promise<void> {
  if (phone) await noSavePicker(page);
  else await installSavePicker(page);
}

export type ResultPhase = 'saved' | 'ready' | 'failed' | 'blocked' | 'canceled' | 'timeout';

const PHASE_SELECTOR =
  '[data-testid="download-saved"], [data-testid="export-download"], [data-testid="export-failed"], ' +
  '[data-testid="export-blocked"], [data-testid="export-over-limit"], [data-testid="export-canceled"]';

/** Waits for the download to end one way or another and says which. */
export async function waitForResult(page: Page, timeoutMs = 300_000): Promise<ResultPhase> {
  try {
    await page.locator(PHASE_SELECTOR).first().waitFor({ state: 'visible', timeout: timeoutMs });
  } catch {
    return 'timeout';
  }
  if ((await page.getByTestId('download-saved').count()) > 0) return 'saved';
  if ((await page.getByTestId('export-download').count()) > 0) return 'ready';
  if ((await page.getByTestId('export-failed').count()) > 0) return 'failed';
  if ((await page.getByTestId('export-canceled').count()) > 0) return 'canceled';
  return 'blocked';
}

/** Desktop: copies the file the stand-in save dialog received out of the page's storage. */
export async function takeSavedFile(page: Page, testInfo: TestInfo, label: string): Promise<string> {
  const name = (await pickerCalls(page)).at(-1);
  if (!name) throw new Error('the save dialog was never asked for a file');
  const path = await readSaved(page, testInfo, `saved-${name}`);
  const target = join(ensureDir(OUTPUTS), `${label}-${testInfo.project.name}-${name}`);
  copyFileSync(path, target);
  return target;
}

/** Phone: presses "Kaydet" (through `press`, so the press is counted) and keeps what the browser downloads. */
export async function takeDownloadedFile(page: Page, testInfo: TestInfo, label: string, press: () => Promise<void>): Promise<string> {
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), press()]);
  const target = join(ensureDir(OUTPUTS), `${label}-${testInfo.project.name}-${download.suggestedFilename()}`);
  await download.saveAs(target);
  return target;
}
