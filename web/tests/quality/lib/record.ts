/**
 * Where the quality specs leave what they measured (docs/quality/README.md).
 *
 * One JSON file per section and browser project, in a gitignored folder; the
 * runner (scripts/quality/run.mjs) reads them, judges them against the
 * budgets and writes the report. Nothing here decides pass or fail.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const SCRATCH = join(process.cwd(), '.scratch', 'quality');
export const RESULTS = join(SCRATCH, 'results');
/** Files the app saved during the measurements (synthetic media only). */
export const OUTPUTS = join(SCRATCH, 'outputs');
/** Sources generated for the measurements (ffmpeg; never real footage). */
export const SOURCES = join(SCRATCH, 'sources');

/** Which build the server in front of the specs serves: the runner says so, a spec never guesses. */
export const BUILD = process.env.QUALITY_BUILD ?? 'bilinmiyor';

export function ensureDir(dir: string): string {
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** `<section>.<part>.json`: `part` is the browser project or any other split of a section. */
export function writeResult(section: string, part: string, data: unknown): void {
  ensureDir(RESULTS);
  writeFileSync(
    join(RESULTS, `${section}.${part}.json`),
    `${JSON.stringify({ section, part, build: BUILD, measuredAt: new Date().toISOString(), data }, null, 2)}\n`,
  );
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? null;
}

/** A number as the Turkish report prints it: decimal comma, dots between thousands. */
export function tr(value: number, digits = 2): string {
  return value.toLocaleString('tr-TR', { maximumFractionDigits: digits });
}

export function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
