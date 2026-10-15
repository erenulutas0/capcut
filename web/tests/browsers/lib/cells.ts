/**
 * What the other-engines suite writes down (docs/quality/README.md).
 *
 * One JSON file per engine project and cell, in a gitignored folder; the
 * report (scripts/browsers/report.mjs) turns them into the table. A cell that
 * was not run has no file and is printed as "koşulmadı" — never guessed.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';

import { ensureDir } from '../../quality/lib/record';

// The same helper as the quality suite's; the other files of this suite take it from here.
export { ensureDir };

export const SCRATCH = join(process.cwd(), '.scratch', 'browsers');
export const RESULTS = join(SCRATCH, 'results');
export const OUTPUTS = join(SCRATCH, 'outputs');

/**
 * works    — the thing was done and what came out was checked.
 * refusal  — the app stopped and said so in words (the words are in `text`).
 * broken   — a file that is not what was promised, a wait that never ends,
 *            an error nobody was told about, or no words at all.
 * absent   — the browser does not have the feature and the app shows nothing
 *            for it (fine where nothing was promised, e.g. no install prompt).
 * not-run  — could not be exercised here; `note` says why.
 */
export type Verdict = 'works' | 'refusal' | 'broken' | 'absent' | 'not-run';

export interface Cell {
  /** `card` rows are the ten task cards; `platform` rows everything else. */
  area: 'card' | 'platform';
  id: string;
  project: string;
  verdict: Verdict;
  /** One line for the table. */
  summary: string;
  /** The words the user saw, when the app stopped. */
  text?: string;
  /** How far the user got: home → wizard → video accepted → download pressed → result. */
  reached?: string[];
  /** ffprobe's account of the file, when there was one. */
  output?: { bytes: number; durationS: number; streams: string[]; width: number | null; height: number | null } | null;
  checks?: Array<{ name: string; ok: boolean; value: string }>;
  problems?: { pageErrors: string[]; consoleErrors: string[]; unhandledRejections: string[] };
  seconds?: number;
  note?: string;
  facts?: Record<string, unknown>;
}

export function writeCell(cell: Cell): void {
  ensureDir(RESULTS);
  writeFileSync(
    join(RESULTS, `${cell.project}.${cell.area}.${cell.id}.json`),
    `${JSON.stringify({ ...cell, measuredAt: new Date().toISOString() }, null, 2)}\n`,
  );
}

export const engineOf = (testInfo: TestInfo): 'chromium' | 'firefox' | 'webkit' =>
  testInfo.project.name.startsWith('firefox') ? 'firefox' : testInfo.project.name.startsWith('webkit') ? 'webkit' : 'chromium';

export interface Problems {
  pageErrors: string[];
  consoleErrors: string[];
  unhandledRejections: string[];
}

/**
 * Everything a page can say about having broken; call before the page loads.
 * An unhandled rejection is counted on its own: Firefox and WebKit do not
 * all report it as a page error.
 */
export async function watchProblems(page: Page): Promise<Problems> {
  const problems: Problems = { pageErrors: [], consoleErrors: [], unhandledRejections: [] };
  page.on('pageerror', (error) => problems.pageErrors.push(error.message.slice(0, 300)));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.consoleErrors.push(message.text().slice(0, 300));
  });
  await page.exposeFunction('__browsersRejection', (reason: string) => {
    problems.unhandledRejections.push(reason.slice(0, 300));
  });
  await page.addInitScript(() => {
    window.addEventListener('unhandledrejection', (event) => {
      const report = (window as unknown as { __browsersRejection?: (reason: string) => void }).__browsersRejection;
      report?.(String((event.reason as { message?: string } | undefined)?.message ?? event.reason));
    });
  });
  return problems;
}

/**
 * Words that must never reach a user: a programmer's error where a sentence
 * should be. A refusal that contains one of these is not an honest refusal.
 */
const CRYPTIC = /\b(TypeError|ReferenceError|DOMException|NotSupportedError|UnknownError|undefined|null|NaN|\[object |is not a function|Can't find variable)\b/;

export const crypticIn = (text: string): string | null => CRYPTIC.exec(text)?.[0] ?? null;

/** Visible text of the first element that matches, whitespace collapsed; '' when there is none. */
export async function visibleText(page: Page, selector: string): Promise<string> {
  const target = page.locator(selector).first();
  if ((await target.count()) === 0) return '';
  const text = ((await target.innerText().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim();
  // The status line a screen reader hears repeats the title: a sighted user reads it once.
  return text.replace(/^(.{8,80}?[.!?]) \1/, '$1');
}
