/**
 * Screenshot baselines with a tolerant comparison.
 *
 * `shot` compares the page with its baseline (tests/quality/baselines/,
 * one PNG per screen and viewport) and RECORDS the outcome instead of
 * failing: a difference is something for a person to look at in the report,
 * with the diff picture next to it.
 *
 * The comparison is done by the browser itself (two PNGs decoded on a blank
 * page, compared pixel by pixel): no image library is needed. A pixel counts
 * as different when a colour channel is more than 40 / 255 away; a screen
 * counts as different when more than 1 % of its pixels are.
 *
 * The baselines are made by Chromium on Windows with the system's fonts.
 * On another system they do not match; that is why this is a local
 * measurement and not a CI gate (docs/quality/README.md).
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page, TestInfo } from '@playwright/test';

import { expectStylesApplied } from '../../e2e/stylesReady';
import { SCRATCH, ensureDir, round } from './record';

export interface VisualEntry {
  name: string;
  project: string;
  /**
   * `same`: within tolerance. `created`: there was no baseline; this run wrote it.
   * `updated`: the runner was told to accept the screen as it is. `different`: look at the diff.
   */
  status: 'same' | 'created' | 'updated' | 'different' | 'failed';
  /** Share of pixels that differ, in percent. */
  differentPercent?: number;
  note?: string;
  diffImage?: string;
  actualImage?: string;
}

/** What changes from run to run without anything having changed: timings, sizes that depend on the encoder, moving pictures. */
const VOLATILE = [
  'video',
  'canvas',
  '[data-testid="measured-elapsed"]',
  '[data-testid="transcribe-elapsed"]',
  '[data-testid="yazi-summary"]',
  '[data-testid="target-size-result"]',
  '[data-testid="export-save-space"]',
  '[data-testid="iyilestir-slow"]',
  '[data-testid="export-enhance"]',
];

export const BASELINES = join(process.cwd(), 'tests', 'quality', 'baselines');
export const VISUAL_DIFFS = join(SCRATCH, 'visual-diffs');

const CHANNEL_TOLERANCE = 40;
const MAX_DIFFERENT_SHARE = 0.01;

interface Comparison {
  share: number;
  sizeNote: string | null;
  diffPng: string;
}

/** Compares two PNGs on a blank page of the same browser. */
async function compare(page: Page, actual: Buffer, expected: Buffer): Promise<Comparison> {
  const blank = await page.context().newPage();
  try {
    return await blank.evaluate(
      async ({ a, b, tolerance }) => {
        const load = async (base64: string) => {
          const blob = await (await fetch(`data:image/png;base64,${base64}`)).blob();
          return createImageBitmap(blob);
        };
        const [imageA, imageB] = await Promise.all([load(a), load(b)]);
        const width = Math.max(imageA.width, imageB.width);
        const height = Math.max(imageA.height, imageB.height);
        const pixels = (image: ImageBitmap) => {
          const canvas = new OffscreenCanvas(width, height);
          const context = canvas.getContext('2d');
          if (!context) throw new Error('no 2d context');
          context.drawImage(image, 0, 0);
          return context.getImageData(0, 0, width, height).data;
        };
        const dataA = pixels(imageA);
        const dataB = pixels(imageB);
        const out = new OffscreenCanvas(width, height);
        const outContext = out.getContext('2d');
        if (!outContext) throw new Error('no 2d context');
        const diff = outContext.createImageData(width, height);
        let different = 0;
        for (let at = 0; at < dataA.length; at += 4) {
          const delta = Math.max(
            Math.abs((dataA[at] ?? 0) - (dataB[at] ?? 0)),
            Math.abs((dataA[at + 1] ?? 0) - (dataB[at + 1] ?? 0)),
            Math.abs((dataA[at + 2] ?? 0) - (dataB[at + 2] ?? 0)),
            Math.abs((dataA[at + 3] ?? 0) - (dataB[at + 3] ?? 0)),
          );
          if (delta > tolerance) {
            different += 1;
            diff.data[at] = 255;
            diff.data[at + 1] = 0;
            diff.data[at + 2] = 60;
          } else {
            // The baseline, greyed and dimmed, so the red stands out.
            const grey = 0.3 * (dataB[at] ?? 0) + 0.59 * (dataB[at + 1] ?? 0) + 0.11 * (dataB[at + 2] ?? 0);
            const dim = 40 + grey * 0.5;
            diff.data[at] = dim;
            diff.data[at + 1] = dim;
            diff.data[at + 2] = dim;
          }
          diff.data[at + 3] = 255;
        }
        outContext.putImageData(diff, 0, 0);
        const blob = await out.convertToBlob({ type: 'image/png' });
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let text = '';
        for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return {
          share: different / (width * height),
          sizeNote:
            imageA.width === imageB.width && imageA.height === imageB.height
              ? null
              : `boyut değişti: ${imageB.width} × ${imageB.height} → ${imageA.width} × ${imageA.height}`,
          diffPng: btoa(text),
        };
      },
      { a: actual.toString('base64'), b: expected.toString('base64'), tolerance: CHANNEL_TOLERANCE },
    );
  } finally {
    await blank.close();
  }
}

/** A screenshot that has stopped changing: two in a row are the same bytes. */
async function settled(page: Page, mask: Locator[], fullPage: boolean): Promise<Buffer> {
  const take = () => page.screenshot({ fullPage, mask, animations: 'disabled', caret: 'hide', scale: 'css', type: 'png' });
  let previous = await take();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.waitForTimeout(150);
    const next = await take();
    if (next.equals(previous)) return next;
    previous = next;
  }
  return previous;
}

export async function shot(
  page: Page,
  testInfo: TestInfo,
  log: VisualEntry[],
  name: string,
  options: { mask?: Locator[]; fullPage?: boolean } = {},
): Promise<void> {
  const project = testInfo.project.name;
  const entry: VisualEntry = { name, project, status: 'same' };
  log.push(entry);
  try {
    await expectStylesApplied(page, name);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    if (!testInfo.project.use.hasTouch) await page.mouse.move(1, 1);
    const mask = [...VOLATILE.map((selector) => page.locator(selector)), ...(options.mask ?? [])];
    const actual = await settled(page, mask, options.fullPage ?? true);
    const baseline = join(ensureDir(BASELINES), `${name}-${project}.png`);
    if (process.env.QUALITY_UPDATE_BASELINES === '1' || !existsSync(baseline)) {
      entry.status = existsSync(baseline) ? 'updated' : 'created';
      writeFileSync(baseline, actual);
      return;
    }
    const expected = readFileSync(baseline);
    if (expected.equals(actual)) {
      entry.differentPercent = 0;
      return;
    }
    const result = await compare(page, actual, expected);
    entry.differentPercent = round(result.share * 100, 3);
    if (result.sizeNote === null && result.share <= MAX_DIFFERENT_SHARE) return;
    entry.status = 'different';
    entry.note = result.sizeNote ?? undefined;
    ensureDir(VISUAL_DIFFS);
    entry.diffImage = `${name}-${project}-fark.png`;
    entry.actualImage = `${name}-${project}-simdi.png`;
    writeFileSync(join(VISUAL_DIFFS, entry.diffImage), Buffer.from(result.diffPng, 'base64'));
    writeFileSync(join(VISUAL_DIFFS, entry.actualImage), actual);
  } catch (error) {
    entry.status = 'failed';
    entry.note = `karşılaştırılamadı: ${String((error as Error).message).split('\n')[0]?.slice(0, 200)}`;
  }
}
