/**
 * Caption rules shared by validation, commands, the render plan and the UI.
 *
 * Pure and dependency-free like the rest of the domain. Text layout needs
 * font metrics, so it lives in captionLayout.ts behind a measuring function.
 */

import type { CaptionCueV2, CaptionStyleV2, CaptionTrackV2, Project } from './edl';
import type { Micros } from './time';

export const CAPTION_LIMITS = {
  /** v2 shows one track; a second (e.g. a translation) is a later decision. */
  maxTracks: 1,
  maxCuesPerTrack: 500,
  /** Counted in user-perceived characters (code points), not UTF-16 units. */
  maxTextChars: 120,
  /** Explicit line breaks the user may type; wrapping may not exceed it either. */
  maxLines: 2,
  /** Below this a line flashes by unread. */
  minCueDurationUs: 200_000,
} as const;

export const DEFAULT_CAPTION_STYLE: CaptionStyleV2 = {
  preset: 'box',
  position: 'bottom',
  size: 'medium',
};

export const CAPTION_PRESETS = ['box', 'outline'] as const;
export const CAPTION_POSITIONS = ['bottom', 'middle', 'top'] as const;
export const CAPTION_SIZES = ['small', 'medium', 'large'] as const;

const LANGUAGE_PATTERN = /^[a-z]{2,3}(-[A-Z]{2})?$/;

export function isCaptionLanguage(value: unknown): value is string {
  return typeof value === 'string' && LANGUAGE_PATTERN.test(value);
}

const CR = String.fromCharCode(0x0d);
const LF = String.fromCharCode(0x0a);
const TAB = String.fromCharCode(0x09);

const charRange = (from: number, to: number): string =>
  `${String.fromCharCode(from)}-${String.fromCharCode(to)}`;

/**
 * Characters removed from caption text: C0/C1 controls (except LF and tab), zero-width
 * space, Unicode line/paragraph separators and the BOM. Built from code points
 * so no invisible character ever sits in this source file.
 */
const STRIPPED = new RegExp(
  `[${charRange(0x00, 0x08)}${charRange(0x0b, 0x1f)}${charRange(0x7f, 0x9f)}` +
    `${String.fromCharCode(0x200b, 0x2028, 0x2029, 0xfeff)}]`,
  'g',
);
/** Horizontal whitespace inside a line: space, tab, no-break space. */
const SPACES = new RegExp(`[ ${TAB}${String.fromCharCode(0xa0)}]+`, 'g');

/**
 * The one canonical form of caption text. Stored text must equal its own
 * normalisation, so every reader (web, later Dart/Python) sees the same bytes.
 *
 * - CRLF/CR become LF; every other control character is removed (captions
 *   are drawn on a canvas, but stored text is still untrusted input).
 * - Runs of spaces/tabs collapse to one space; each line is trimmed.
 * - Empty lines are dropped, so at most `maxLines` real lines remain.
 */
export function normalizeCaptionText(raw: string): string {
  return raw
    .split(CR + LF)
    .join(LF)
    .split(CR)
    .join(LF)
    .replace(STRIPPED, '')
    .split(LF)
    .map((line) => line.replace(SPACES, ' ').trim())
    .filter((line) => line.length > 0)
    .join(LF);
}

export function captionCharCount(text: string): number {
  return Array.from(text).length;
}

export type CaptionTextProblem = 'caption_text_empty' | 'caption_text_too_long' | 'caption_too_many_lines';

/** Checks canonical text against the limits. `null` means acceptable. */
export function captionTextProblem(text: string): CaptionTextProblem | null {
  if (text.length === 0) return 'caption_text_empty';
  if (captionCharCount(text) > CAPTION_LIMITS.maxTextChars) return 'caption_text_too_long';
  if (text.split(LF).length > CAPTION_LIMITS.maxLines) return 'caption_too_many_lines';
  return null;
}

/** Cues are kept sorted by start; ties cannot exist because overlap is refused. */
export function sortCues(cues: readonly CaptionCueV2[]): CaptionCueV2[] {
  return [...cues].sort((a, b) => a.startUs - b.startUs || a.cueId.localeCompare(b.cueId));
}

/** True when two half-open ranges share any instant. */
export function rangesOverlap(aStart: Micros, aEnd: Micros, bStart: Micros, bEnd: Micros): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** The first cue of `cues` (other than `ignoreCueId`) that overlaps the range. */
export function overlappingCue(
  cues: readonly CaptionCueV2[],
  startUs: Micros,
  endUs: Micros,
  ignoreCueId?: string,
): CaptionCueV2 | undefined {
  return cues.find(
    (cue) => cue.cueId !== ignoreCueId && rangesOverlap(cue.startUs, cue.endUs, startUs, endUs),
  );
}

export function primaryCaptionTrack(project: Project): CaptionTrackV2 | undefined {
  return project.captionTracks[0];
}

/** The cue visible at an output instant, if any. Half-open: the end is not shown. */
export function activeCueAt(project: Project, outputUs: Micros): CaptionCueV2 | undefined {
  const track = primaryCaptionTrack(project);
  if (!track) return undefined;
  return track.cues.find((cue) => cue.startUs <= outputUs && outputUs < cue.endUs);
}

export type CueVisibility = 'visible' | 'clipped' | 'outside';

/**
 * How much of a cue survives the current output length. Editing moments can
 * shorten the video under existing captions; those cues are kept (the user
 * may lengthen the video again) but shown as clipped or outside, never
 * silently dropped.
 */
export function cueVisibility(cue: CaptionCueV2, outputDurationUs: Micros): CueVisibility {
  if (cue.startUs >= outputDurationUs) return 'outside';
  if (cue.endUs > outputDurationUs) return 'clipped';
  return 'visible';
}
