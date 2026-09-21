/**
 * Small pure helpers behind the SRT/VTT import and export UI (ADR-016).
 *
 * The parsing, the import rules and the output mapping live in
 * subtitleFormats.ts, commands.ts and captions.ts; these only prepare what the
 * dialogs show and name the downloaded file, so they can be unit-tested
 * without a browser.
 */

import type { Project } from './edl';
import type { ParsedSubtitles, SubtitleFormat } from './subtitleFormats';
import { US_PER_SECOND, type Micros } from './time';
import { buildTimeline } from './timeline';

/**
 * Turkish letters have no NFD decomposition for dotless ı, and İ decomposes to
 * "I + combining dot" which would survive as a stray mark, so they are folded
 * explicitly before the generic accent strip.
 */
const TURKISH_FOLD: Record<string, string> = {
  ç: 'c',
  Ç: 'C',
  ğ: 'g',
  Ğ: 'G',
  ı: 'i',
  İ: 'I',
  ö: 'o',
  Ö: 'O',
  ş: 's',
  Ş: 'S',
  ü: 'u',
  Ü: 'U',
};

const COMBINING_MARKS = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, 'g');

/** Long enough to recognise a project, short enough for every file system. */
const MAX_BASE_LENGTH = 60;

/**
 * The download name for a subtitle file: the project title folded to plain
 * ASCII (some players and older TVs still mangle non-ASCII file names), with
 * anything that is not a letter, digit, dash or underscore removed so the
 * name can never carry a path, a reserved character or a hidden extension.
 * Falls back to "altyazi" when nothing usable is left.
 */
export function subtitleFileName(title: string, format: SubtitleFormat): string {
  const folded = Array.from(title)
    .map((char) => TURKISH_FOLD[char] ?? char)
    .join('')
    .normalize('NFD')
    .replace(COMBINING_MARKS, '');
  const base = folded
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, MAX_BASE_LENGTH)
    .replace(/[-_]+$/g, '');
  return `${base || 'altyazi'}.${format}`;
}

/**
 * The block number (1-based, as the parser counts them) of every parsed cue.
 *
 * The import report names skipped lines by their position among the PARSED
 * cues, but a person looks at the file, where unreadable blocks are counted
 * too. The parser numbers each counted block once, either as a cue or as a
 * problem, so the cues take the block numbers the problems did not.
 */
export function cueBlockNumbers(parsed: Pick<ParsedSubtitles, 'cues' | 'problems'>): number[] {
  const problemBlocks = new Set(parsed.problems.map((problem) => problem.block));
  const numbers: number[] = [];
  let block = 0;
  while (numbers.length < parsed.cues.length) {
    block += 1;
    if (!problemBlocks.has(block)) numbers.push(block);
  }
  return numbers;
}

/**
 * True when the output is the anchored video from start to end with nothing
 * cut, reordered or repeated: then output time equals source time and both
 * answers to "what was this file timed against?" give the same result.
 */
export function outputIsWholeSource(project: Project): boolean {
  const video = project.assets.find((asset) => asset.kind === 'video');
  if (!video) return false;
  const timeline = buildTimeline(project);
  if (timeline.length === 0) return false;
  let cursor = 0;
  for (const entry of timeline) {
    if (entry.assetId !== video.assetId || entry.sourceInUs !== cursor) return false;
    cursor = entry.sourceOutUs;
  }
  return cursor === video.durationUs;
}

/** Plain minus, the typographic minus and the en dash all mean "earlier". */
const MINUS_SIGNS = new RegExp(`^[-${String.fromCharCode(0x2212, 0x2013)}]`);

/**
 * Reads the exact shift field: seconds with a comma or a dot as the decimal
 * mark (Turkish writes "0,5"), an optional sign, at most millisecond
 * precision. Null when it is not such a number or the amount is absurd.
 */
export function parseShiftSeconds(raw: string): Micros | null {
  const text = raw.trim().replace(/\s+/g, '').replace(MINUS_SIGNS, '-').replace(',', '.');
  if (!/^[-+]?(\d+(\.\d{0,3})?|\.\d{1,3})$/.test(text)) return null;
  const seconds = Number(text);
  // Nothing real is out of sync by more than a day; this also keeps the
  // micro-second value far inside the safe integer range.
  if (!Number.isFinite(seconds) || Math.abs(seconds) > 86_400) return null;
  return Math.round(seconds * 1000) * 1000;
}

/** "+0,1" / "−1,25" in the Turkish style, for the shift report. */
export function formatShiftSeconds(deltaUs: Micros, decimalMark: ',' | '.' = ','): string {
  const sign = deltaUs < 0 ? String.fromCharCode(0x2212) : '+';
  const millis = Math.round(Math.abs(deltaUs) / 1000);
  const whole = Math.floor(millis / 1000);
  const fraction = String(millis % 1000).padStart(3, '0').replace(/0+$/, '');
  return `${sign}${whole}${fraction ? `${decimalMark}${fraction}` : ''}`;
}

export const SHIFT_STEPS_US: readonly Micros[] = [
  -US_PER_SECOND,
  -US_PER_SECOND / 10,
  US_PER_SECOND / 10,
  US_PER_SECOND,
];
