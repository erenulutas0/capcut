/**
 * Caption rules shared by validation, commands, the render plan and the UI.
 *
 * Pure and dependency-free like the rest of the domain. Text layout needs
 * font metrics, so it lives in captionLayout.ts behind a measuring function.
 */

import type { CaptionCueV2, CaptionStyleV2, CaptionTrackV2, Project } from './edl';
import type { Micros } from './time';
import { buildTimeline, mapOutputToSource } from './timeline';

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

/** A caption as it appears on the output timeline. */
export interface OutputCue {
  cueId: string;
  /**
   * Which appearance of the cue this is, in output order. Always 0 for output
   * tracks; a source cue whose range is used twice appears as 0 and 1.
   */
  occurrence: number;
  /** Half-open output range. */
  startUs: Micros;
  endUs: Micros;
  text: string;
}

/**
 * THE mapping from the stored track to what is shown on the output timeline.
 * Preview, render plan, export files (SRT/VTT) and the timeline lane all read
 * captions through this function, so they cannot disagree.
 *
 * - Output tracks: the cues as stored (they may run past the output end; the
 *   caller clips).
 * - Source tracks: every moment cut from the track's video shows the part of
 *   each cue that falls inside the moment, shifted to where the moment sits in
 *   the output (ADR-009: O + (t - S)). Nothing lands outside the output, and
 *   because an output instant shows exactly one source instant, the pieces
 *   never overlap.
 */
export function outputCues(project: Project): OutputCue[] {
  const track = primaryCaptionTrack(project);
  if (!track) return [];
  if (track.timeBase === 'output') {
    return track.cues.map((cue) => ({ ...cue, occurrence: 0 }));
  }

  const pieces: Omit<OutputCue, 'occurrence'>[] = [];
  for (const entry of buildTimeline(project)) {
    if (entry.assetId !== track.assetId) continue;
    for (const cue of track.cues) {
      const from = Math.max(cue.startUs, entry.sourceInUs);
      const to = Math.min(cue.endUs, entry.sourceOutUs);
      if (to <= from) continue;
      pieces.push({
        cueId: cue.cueId,
        startUs: entry.startUs + (from - entry.sourceInUs),
        endUs: entry.startUs + (to - entry.sourceInUs),
        text: cue.text,
      });
    }
  }
  pieces.sort((a, b) => a.startUs - b.startUs);
  const seen = new Map<string, number>();
  return pieces.map((piece) => {
    const occurrence = seen.get(piece.cueId) ?? 0;
    seen.set(piece.cueId, occurrence + 1);
    return { ...piece, occurrence };
  });
}

/** The caption visible at an output instant, if any. Half-open: the end is not shown. */
export function activeCueAt(project: Project, outputUs: Micros): OutputCue | undefined {
  return outputCues(project).find((cue) => cue.startUs <= outputUs && outputUs < cue.endUs);
}

/**
 * The instant on the track's own clock that is playing at an output instant:
 * the output time itself for output tracks, the source time for source
 * tracks. Null when a source track's video is not what plays there.
 */
export function trackTimeAtOutput(project: Project, outputUs: Micros): Micros | null {
  const track = primaryCaptionTrack(project);
  if (!track || track.timeBase === 'output') return outputUs;
  const position = mapOutputToSource(project, outputUs);
  if (!position || position.entry.assetId !== track.assetId) return null;
  return position.sourceUs;
}

export interface SourceCueUsage {
  /** How many times the cue appears in the output (0 = no moment reaches it). */
  occurrences: number;
  /** True when at least one appearance is cut short by a moment's edge. */
  partial: boolean;
}

/** For source tracks: whether the current moments show a cue, and whole. */
export function sourceCueUsage(project: Project, cue: CaptionCueV2): SourceCueUsage {
  const shown = outputCues(project).filter((item) => item.cueId === cue.cueId);
  const full = cue.endUs - cue.startUs;
  return {
    occurrences: shown.length,
    partial: shown.some((item) => item.endUs - item.startUs < full),
  };
}

export type CueVisibility = 'visible' | 'clipped' | 'outside';

/**
 * How much of an OUTPUT-track cue survives the current output length. Editing moments can
 * shorten the video under existing captions; those cues are kept (the user
 * may lengthen the video again) but shown as clipped or outside, never
 * silently dropped.
 */
export function cueVisibility(cue: CaptionCueV2, outputDurationUs: Micros): CueVisibility {
  if (cue.startUs >= outputDurationUs) return 'outside';
  if (cue.endUs > outputDurationUs) return 'clipped';
  return 'visible';
}

/**
 * What an SRT/VTT export of the finished video contains: the output view of
 * the captions (`outputCues`), cut at the output end, with lines wholly past
 * it left out. Adjacent appearances are not merged; each stays a line.
 */
export function outputCuesForExport(project: Project, outputDurationUs: Micros): OutputCue[] {
  return outputCues(project)
    .filter((cue) => cue.startUs < outputDurationUs)
    .map((cue) => ({ ...cue, endUs: Math.min(cue.endUs, outputDurationUs) }));
}

export type TimeBaseHint = 'source' | 'output' | 'same' | null;

/**
 * A HINT for the import dialog, never a decision (ADR-009: the time base is
 * not guessed silently; the user picks). It only speaks when the file's own
 * timing makes one answer clearly impossible:
 * - `same`: the output is the whole video uncut, so both clocks agree;
 * - `source`: lines run past the output but fit the video;
 * - `output`: lines run past the video itself, so they cannot be source times.
 */
export function suggestTimeBase(
  cues: readonly { endUs: Micros }[],
  outputDurationUs: Micros,
  sourceDurationUs: Micros,
  outputIsWholeSource: boolean,
): TimeBaseHint {
  if (outputIsWholeSource) return 'same';
  const lastEnd = cues.reduce((max, cue) => Math.max(max, cue.endUs), 0);
  const slack = 500_000;
  if (lastEnd > sourceDurationUs + slack) return 'output';
  if (lastEnd > outputDurationUs + slack) return 'source';
  return null;
}

// ------------------------------------------------ the video's clock (ADR-026)

/** A caption line placed on the VIDEO's own clock, for the preview and the strip. */
export interface VideoCue {
  cueId: string;
  startUs: Micros;
  endUs: Micros;
  text: string;
}

/**
 * Where each line shows on the video's own clock, the one clock of the
 * editor since ADR-026.
 *
 * - A source-anchored line already is on that clock.
 * - An output-anchored line (older projects) is timed on the joined download.
 *   It is placed wherever a kesit shows that moment of the joined video; a
 *   line no kesit reaches has no place on the video.
 */
export function videoCues(project: Project): VideoCue[] {
  const track = primaryCaptionTrack(project);
  if (!track) return [];
  if (track.timeBase === 'source') {
    const video = project.assets.find((asset) => asset.kind === 'video');
    if (!video || video.assetId !== track.assetId) return [];
    return sortCues(track.cues).map(({ cueId, startUs, endUs, text }) => ({ cueId, startUs, endUs, text }));
  }
  const placed: VideoCue[] = [];
  for (const entry of buildTimeline(project)) {
    for (const cue of track.cues) {
      const from = Math.max(cue.startUs, entry.startUs);
      const to = Math.min(cue.endUs, entry.endUs);
      if (to <= from) continue;
      placed.push({
        cueId: cue.cueId,
        startUs: entry.sourceInUs + (from - entry.startUs),
        endUs: entry.sourceInUs + (to - entry.startUs),
        text: cue.text,
      });
    }
  }
  return placed.sort((a, b) => a.startUs - b.startUs);
}

/**
 * The line to draw at a moment of the video. For an output-anchored track the
 * same video moment can belong to two kesitler with different lines (a range
 * used twice); the kesit being played or selected (`preferClipId`) decides,
 * otherwise the first kesit in the list that shows it.
 */
export function captionAtVideoTime(
  project: Project,
  videoUs: Micros,
  preferClipId: string | null,
): VideoCue | undefined {
  const track = primaryCaptionTrack(project);
  if (!track) return undefined;
  if (track.timeBase === 'source') {
    return videoCues(project).find((cue) => cue.startUs <= videoUs && videoUs < cue.endUs);
  }
  const timeline = buildTimeline(project);
  const contains = (entry: (typeof timeline)[number]) =>
    videoUs >= entry.sourceInUs && videoUs < entry.sourceOutUs;
  const entry =
    timeline.find((item) => item.clipId === preferClipId && contains(item)) ?? timeline.find(contains);
  if (!entry) return undefined;
  const outputUs = entry.startUs + (videoUs - entry.sourceInUs);
  const cue = track.cues.find((item) => item.startUs <= outputUs && outputUs < item.endUs);
  return cue ? { cueId: cue.cueId, startUs: cue.startUs, endUs: cue.endUs, text: cue.text } : undefined;
}
