/**
 * Driving the app for the measurements: where the test media is, how a
 * finished file is taken out of the browser, how a result is waited for.
 *
 * Texts come from the app's own message table, so a renamed button or
 * product does not break the scripts — it only changes what they read.
 */

import { copyFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';

import { translator, type MessageKey } from '../../../src/i18n/messages';
import { installSavePicker, noSavePicker, pickerCalls, readSaved } from '../../e2e/kesitFlow';
import { OUTPUTS, ensureDir } from './record';

export const t: (key: MessageKey) => string = translator('tr');

export const SAMPLE = join(process.cwd(), 'tests', 'media', 'sample-24s.mp4'); // 1280×720, H.264 + AAC, 24 s, a test card
export const OTHER = join(process.cwd(), 'tests', 'media', 'other-8s.mp4'); // 640×360, H.264 + AAC, 8 s
export const MUSIC = join(process.cwd(), 'tests', 'media', 'tone-30s.m4a');
export const SPEECH = join(process.cwd(), 'tests', 'media', 'speech-fleurs-en-01.mp4');

export const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** An accessible name that starts with this text (a card's name is its label followed by its second line). */
export const startsWith = (text: string): RegExp => new RegExp(`^\\s*${escapeRegExp(text)}`);

export const isPhone = (testInfo: TestInfo): boolean => testInfo.project.use.hasTouch === true;

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
