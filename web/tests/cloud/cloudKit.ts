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
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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

/** Length of the long sample: the video of 11 Oct 2026 was 4 min 13 s. */
export const LONG_SECONDS = 253;

/**
 * A video as long as the one whose burn-in download failed once on a real
 * machine (11 Oct 2026): 4 min 13 s, 1280×720, 30 fps, H.264 + AAC, with a
 * moving picture and a tone that comes and goes. Made with ffmpeg on first
 * use into a gitignored folder; a test pattern and a generated tone, nothing
 * real. The same command gives the same file.
 */
export function longSample(): string {
  const dir = join(process.cwd(), 'tests', 'media', 'cloud');
  const file = join(dir, `long-${LONG_SECONDS}s-720p.mp4`);
  if (existsSync(file)) return file;
  mkdirSync(dir, { recursive: true });
  const partial = `${file}.part.mp4`;
  rmSync(partial, { force: true });
  execFileSync(
    'ffmpeg',
    [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', `testsrc2=size=1280x720:rate=30:duration=${LONG_SECONDS}`,
      // A tone in bursts with pauses (speech-like for the meter, not speech).
      '-f', 'lavfi', '-i', `aevalsrc=0.25*sin(2*PI*180*t)*gt(sin(2*PI*0.35*t)\\,-0.4):s=48000:d=${LONG_SECONDS}`,
      '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '30', '-g', '60', '-bf', '2',
      '-c:a', 'aac', '-b:a', '96k', '-ac', '2', '-shortest', '-movflags', '+faststart',
      '-fflags', '+bitexact', '-flags:v', '+bitexact', '-flags:a', '+bitexact',
      partial,
    ],
    { stdio: 'pipe' },
  );
  renameSync(partial, file);
  return file;
}

/** A small repeatable random source (mulberry32): the same seed gives the same words on every machine. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VOCABULARY = (
  'so tell me about yourself and why you would like to work here well I have been working in sales for five years ' +
  'and I really enjoy talking with customers every day what would you say is your greatest strength I think I am ' +
  'patient and I listen carefully before I answer that is good to hear can you give me an example of a problem you solved'
).split(' ');

/**
 * Words shaped like a real provider answer for a conversation of `durationS`
 * seconds — invented text, real SHAPE. The shape was read from the provider's
 * answers for openly licensed test audio (measurement of 11 Oct 2026, twelve
 * files; the answers themselves are not in the repository):
 *
 * - about 2,5 words a second, a word mostly 0,05–0,7 s long, the next one
 *   16–50 ms after it; now and then a pause of 1–3 s, and one long silence;
 * - several speakers in turns; where a turn starts the next speaker's first
 *   word can BEGIN BEFORE the last word of the previous one ended (seen: up
 *   to 1,7 s) — the list stays in start order;
 * - words of ZERO length (start = end; seen in 6 of 12 files);
 * - long stretches without a full stop (seen: 86 words), and a "word" of 37
 *   characters;
 * - the last word ends before the audio does. One word more is added here
 *   that runs PAST the end of the video (not seen in the measurement; the
 *   provider's own clock is not the video's, so the route must bear it).
 */
export function realisticWords(durationS: number, seed = 20261011): FakeWord[] {
  const random = seeded(seed);
  const between = (low: number, high: number) => low + (high - low) * random();
  const speakers = ['A', 'B', 'A', 'B', 'C'];
  const out: FakeWord[] = [];
  const endMs = durationS * 1000;
  let at = 900;
  let turn = 0;
  let sinceStop = 0;
  /** Words until the next full stop; one stretch has none for a long while. */
  let stopAfter = 8;
  let longSilenceDone = false;
  let longTokenDone = false;
  let unbrokenDone = false;
  while (at < endMs - 6000) {
    const speaker = speakers[turn % speakers.length] as string;
    const inTurn = Math.round(between(4, 55));
    for (let i = 0; i < inTurn && at < endMs - 6000; i += 1) {
      const zero = random() < 0.012;
      const length = zero ? 0 : Math.round(random() < 0.03 ? between(700, 2600) : between(48, 520));
      let text = VOCABULARY[Math.floor(random() * VOCABULARY.length)] as string;
      if (!longTokenDone && at > endMs * 0.4) {
        text = 'pneumonoultramicroscopicsilicovolcano'; // 37 characters, like the longest "word" seen
        longTokenDone = true;
      }
      sinceStop += 1;
      if (sinceStop >= stopAfter) {
        text = `${text}${random() < 0.2 ? '?' : '.'}`;
        sinceStop = 0;
        if (!unbrokenDone && at > endMs * 0.55) {
          stopAfter = 86;
          unbrokenDone = true;
        } else stopAfter = Math.round(between(5, 22));
      } else if (sinceStop === 1) text = text.charAt(0).toUpperCase() + text.slice(1);
      out.push({ text, start: Math.round(at), end: Math.round(at + length), confidence: Math.round(between(0.42, 0.99) * 100) / 100, speaker });
      at += length + (random() < 0.04 ? between(1000, 3200) : between(0, 60));
    }
    turn += 1;
    if (!longSilenceDone && at > endMs * 0.25) {
      at += 21_000;
      longSilenceDone = true;
    } else if (random() < 0.35) {
      // The next speaker starts while the last word is still being said.
      const last = out[out.length - 1];
      if (last) at = Math.max(last.start + 1, at - between(200, 1700));
    } else at += between(120, 900);
  }
  // Past the end of the video: must be cut or dropped, never break the download.
  out.push({ text: 'Thanks.', start: Math.round(endMs - 300), end: Math.round(endMs + 450), confidence: 0.9, speaker: 'A' });
  out.push({ text: 'Bye.', start: Math.round(endMs + 200), end: Math.round(endMs + 600), confidence: 0.5, speaker: 'B' });
  return out;
}

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
