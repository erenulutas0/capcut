/**
 * Test equipment for the cloud transcript route (ADR-039).
 *
 * Everything here runs against a LOCAL FAKE of our proxy Worker
 * (cloud/fake-worker/server.mjs): a Node server on 127.0.0.1 that answers the
 * browser the way the real Worker does — the same contract cases pass against
 * both (cloud/contract/cases.mjs). The speech provider behind it is faked too
 * and writes the words a test scripts. Nothing here says anything about how
 * well speech is written, and nothing leaves the machine.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type BrowserContext, type Page, type TestInfo } from '@playwright/test';

import { startFakeWorker, type FakeWord, type FakeWorker } from '../../../cloud/fake-worker/server.mjs';
import { cloudTr, type CloudMessageKey } from '../../src/i18n/cloudMessages';

export type { FakeWorker };

/** The fake's fixed address: the build under test is given exactly this origin. */
export const FAKE_PORT = 38197;
export const FAKE_ORIGIN = `http://127.0.0.1:${FAKE_PORT}`;
export const BUILD_HINT =
  "these tests need the cloud build: $env:CLIP_TEST_HOOKS='1'; $env:NEXT_PUBLIC_CLOUD_TRANSCRIPT_URL='" + FAKE_ORIGIN + "'; npm run build";

export const SAMPLE = join(process.cwd(), 'tests', 'media', 'sample-24s.mp4'); // 1280×720, H.264 + AAC, 24 s
export const INVITE_KEY = 'clip.cloudInvite';

/** The route's own words, from its own table: a reworded sentence changes what the tests read, not whether they run. */
export const ct = (key: CloudMessageKey): string => cloudTr[key];
export const plain = (key: CloudMessageKey): string => ct(key).split('**').join('');
export const fill = (template: string, values: Record<string, string | number>): string =>
  template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));

export interface FakeOptions {
  maxJobMinutes?: number;
  rateLimitPerHour?: number;
  monthlyCapUsd?: number;
}

/** Starts the fake for the site under test (its origin is the only one the fake answers). */
export async function startFake(baseURL: string | undefined, options: FakeOptions = {}): Promise<FakeWorker> {
  const origin = new URL(baseURL ?? 'http://127.0.0.1:3100').origin;
  return startFakeWorker({ port: FAKE_PORT, allowedOrigins: [origin], monthlyCapUsd: 1, priceUsdPerHour: 0.23, rateLimitPerHour: 30, ...options });
}

/** A provider word: seconds in, milliseconds out (the provider's unit). */
const word = (text: string, startS: number, endS: number, speaker: string): FakeWord => ({ text, start: Math.round(startS * 1000), end: Math.round(endS * 1000), confidence: 0.95, speaker });

function sentence(text: string, fromS: number, speaker: string, eachS = 0.35): FakeWord[] {
  return text.split(' ').map((item, index) => word(item, fromS + index * eachS, fromS + (index + 1) * eachS - 0.03, speaker));
}

/**
 * What the faked provider "writes" for the 24-second sample: two people,
 * four turns. The app's own rules then make the lines.
 */
export const SCRIPT_WORDS: FakeWord[] = [
  ...sentence('Merhaba, bugün videoyu yazıya döküyoruz.', 1.0, 'A'),
  ...sentence('Çok iyi, ben de dinliyorum.', 4.2, 'B'),
  ...sentence('Önce sesi ayırıyoruz, sonra yazı geliyor.', 7.0, 'A'),
  ...sentence('Teşekkürler.', 12.5, 'B'),
];

/** The lines those words become (the app's segmentation: one line per turn here). */
export const SCRIPT_LINES = ['Merhaba, bugün videoyu yazıya döküyoruz.', 'Çok iyi, ben de dinliyorum.', 'Önce sesi ayırıyoruz, sonra yazı geliyor.', 'Teşekkürler.'];

export interface NetworkWatch {
  /** Every request the browser made, in order: "METHOD origin/path". */
  all: string[];
  /** The ones that went to an origin other than the site's own. */
  external: () => string[];
  /** The ones that went anywhere but the site and the fake. */
  strangers: () => string[];
}

/** Records every request of the context (pages and workers), from before the first navigation. */
export function watchNetwork(context: BrowserContext, baseURL: string | undefined): NetworkWatch {
  const site = new URL(baseURL ?? 'http://127.0.0.1:3100').origin;
  const all: string[] = [];
  context.on('request', (request) => {
    const url = new URL(request.url());
    if (url.protocol === 'blob:' || url.protocol === 'data:') return;
    all.push(`${request.method()} ${url.origin}${url.pathname}${url.search}`);
  });
  const outside = (allowed: string[]) => all.filter((entry) => !allowed.some((origin) => entry.split(' ')[1]?.startsWith(`${origin}/`)));
  return { all, external: () => outside([site]), strangers: () => outside([site, FAKE_ORIGIN]) };
}

/** Opens "Yazıya dök" with a video and waits for the choice screen. Fails with the build hint on another build. */
export async function openChoice(page: Page, file: string = SAMPLE): Promise<void> {
  await page.goto('/yap/yazi/');
  await expect(page.getByTestId('wizard')).toHaveAttribute('data-step', 'pick');
  await page.getByTestId('video-input').setInputFiles(file);
  await expect(page.getByTestId('wizard')).toHaveAttribute('data-step', 'choose', { timeout: 60_000 });
  await expect(page.getByTestId('route-choice'), BUILD_HINT).toBeVisible({ timeout: 30_000 });
}

/** Puts a saved invite code into the browser before the page loads (as if "Kodu kaydet" had been pressed earlier). */
export async function seedInvite(page: Page, code: string): Promise<void> {
  await page.addInitScript(([key, value]) => window.localStorage.setItem(key as string, value as string), [INVITE_KEY, code]);
}

/** The choice screen with a saved code whose minutes have been answered. */
export async function openReady(page: Page, code: string, file: string = SAMPLE): Promise<void> {
  await seedInvite(page, code);
  await openChoice(page, file);
  await expect(page.getByTestId('route-online-go')).toBeVisible({ timeout: 30_000 });
}

/** Types the code on the card and saves it. */
export async function enterInvite(page: Page, code: string): Promise<void> {
  await page.getByTestId('invite-code').fill(code);
  await page.getByTestId('invite-save').click();
}

export const storedInvite = (page: Page): Promise<string | null> => page.evaluate((key) => window.localStorage.getItem(key), INVITE_KEY);

/** Test builds only: the switches the route reads from the page (`__clipCloudTest`). */
export async function cloudHook(page: Page, hook: { codec?: 'opus' | 'aac' | 'none'; giveUpMs?: number }): Promise<void> {
  await page.addInitScript((value) => {
    (window as unknown as { __clipCloudTest: unknown }).__clipCloudTest = value;
  }, hook);
}

export interface ProbedAudio {
  streams: { codec_type: string; codec_name: string; sample_rate?: string; channels?: number; bit_rate?: string; tags?: Record<string, string> }[];
  format: { format_name: string; duration?: string; bit_rate?: string; size?: string; nb_streams?: number; tags?: Record<string, string> };
}

/** ffprobe of the bytes the fake received: what really left the browser. */
export function probeUpload(testInfo: TestInfo, bytes: Buffer, name: string): ProbedAudio {
  const dir = testInfo.outputPath('uploads');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  writeFileSync(file, bytes);
  const out = execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file], { encoding: 'utf8' });
  return JSON.parse(out) as ProbedAudio;
}

/** What every ending without a transcript must look like: said plainly, the on-device way one press away, nothing pretending to be done. */
export async function expectHonestFailure(page: Page, key: CloudMessageKey, fake: FakeWorker): Promise<void> {
  await expect(page.getByTestId('cloud-notice')).toContainText(ct(key), { timeout: 60_000 });
  // No stuck spinner, no success state.
  await expect(page.getByTestId('cloud-running')).toHaveCount(0);
  await expect(page.getByTestId('transcript-panel')).toHaveCount(0);
  await expect(page.getByTestId('yazi-cloud-summary')).toHaveCount(0);
  // The way forward is always there, and it is not a lesser button.
  await expect(page.getByTestId('route-device-go')).toBeVisible();
  await expect(page.getByTestId('route-device-go')).toBeEnabled();
  // Nothing is left at the provider.
  await expect.poll(() => fake.jobs().filter((job) => job.atProvider || job.state === 'reserved' || job.state === 'running')).toEqual([]);
}

export async function lineTexts(page: Page): Promise<string[]> {
  return page.locator('[data-testid="transcript-row"] .transcript-text').allTextContents();
}
