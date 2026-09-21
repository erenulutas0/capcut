/**
 * Small pure helpers behind the caption editing UI.
 *
 * Kept out of the React components so the rules ("where does a new line go",
 * "which lines do not fit", "where are they on the strip") are unit-tested and
 * can be read without the UI around them. They never change the recipe: the
 * commands in application/commands.ts stay the only writers.
 */

import type { CaptionCueV2, CaptionStyleV2 } from './edl';
import { layoutCaption, type CaptionFrame, type MeasureText } from './captionLayout';
import {
  CAPTION_LIMITS,
  cueVisibility,
  normalizeCaptionText,
  sortCues,
  type CueVisibility,
} from './captions';
import type { Micros } from './time';

/** Length of a line added with "Satır ekle"; long enough to be read aloud once. */
export const DEFAULT_CUE_LENGTH_US: Micros = 2_000_000;

const US_PER_MS = 1000;

export type NewCueRangeResult =
  | { ok: true; startUs: Micros; endUs: Micros }
  | { ok: false; reason: 'caption_outside_output' | 'caption_no_room' };

/**
 * Where "Satır ekle" puts a new line.
 *
 * It starts at the playhead, rounded to a whole millisecond so the time the
 * list shows is exactly the time that is stored. If the playhead sits inside
 * an existing line the new one starts where that line ends: pressing the
 * button twice in a row should give two consecutive lines, not an overlap
 * error. It ends after DEFAULT_CUE_LENGTH_US, earlier if the next line starts
 * sooner, and never past the output end (the command cuts there too).
 */
export function suggestNewCueRange(
  cues: readonly CaptionCueV2[],
  playheadUs: Micros,
  outputDurationUs: Micros,
): NewCueRangeResult {
  const sorted = sortCues(cues);
  let startUs = Math.max(0, Math.round(playheadUs / US_PER_MS) * US_PER_MS);
  for (const cue of sorted) {
    if (cue.startUs <= startUs && startUs < cue.endUs) startUs = cue.endUs;
  }
  if (startUs >= outputDurationUs) return { ok: false, reason: 'caption_outside_output' };

  const next = sorted.find((cue) => cue.startUs >= startUs);
  const endUs = Math.min(
    startUs + DEFAULT_CUE_LENGTH_US,
    next ? next.startUs : Number.POSITIVE_INFINITY,
    outputDurationUs,
  );
  if (endUs - startUs < CAPTION_LIMITS.minCueDurationUs) {
    return { ok: false, reason: 'caption_no_room' };
  }
  return { ok: true, startUs, endUs };
}

/**
 * Whether a line, as it will be stored, fits in two lines on this frame.
 *
 * Takes the raw text from the field and normalises it first, so the answer is
 * about what the command would store, while the user is still typing. Empty
 * text is not a fitting problem (the command reports it on its own).
 * `measure` must use the bundled caption font; the caller only asks once the
 * font is loaded, otherwise a fallback font would give a wrong answer.
 */
export function captionFits(
  rawText: string,
  style: CaptionStyleV2,
  frame: CaptionFrame,
  measure: MeasureText,
): boolean {
  const text = normalizeCaptionText(rawText);
  if (text === '') return true;
  return layoutCaption(text, style, frame, measure).ok;
}

export interface CaptionMark {
  cueId: string;
  /** Position on the output strip, in percent of the output duration. */
  leftPct: number;
  widthPct: number;
  visibility: Exclude<CueVisibility, 'outside'>;
}

/**
 * Where each line sits on the output strip. Lines past the output end are
 * left out (they are not drawn in the file either); a clipped line is shown
 * up to the end, like the render plan cuts it.
 */
export function captionMarks(
  cues: readonly CaptionCueV2[],
  outputDurationUs: Micros,
): CaptionMark[] {
  if (outputDurationUs <= 0) return [];
  const marks: CaptionMark[] = [];
  for (const cue of sortCues(cues)) {
    const visibility = cueVisibility(cue, outputDurationUs);
    if (visibility === 'outside') continue;
    const endUs = Math.min(cue.endUs, outputDurationUs);
    marks.push({
      cueId: cue.cueId,
      leftPct: (cue.startUs / outputDurationUs) * 100,
      widthPct: ((endUs - cue.startUs) / outputDurationUs) * 100,
      visibility,
    });
  }
  return marks;
}
