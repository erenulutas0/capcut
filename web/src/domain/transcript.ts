/**
 * The transcript of "Yazıya dök" (ADR-036), as pure rules:
 *
 * - the guard that decides whether what the recogniser wrote for one speech
 *   span is kept or shown as "(anlaşılamadı)" — never invented, never
 *   silently deleted;
 * - the constant timing correction of the word times;
 * - the transcript as the lines of the panel, as plain text, and as the
 *   ranges "Bunlardan kesit yap" turns into kesitler.
 *
 * The numbers are the October spike's (docs/spikes/2026-10-03-asr-on-device-
 * english.md), fixed before its validation clips were made.
 */

import type { CaptionTrackV2 } from './edl';
import type { SpeechSpan } from './speechSpans';
import { US_PER_SECOND, type Micros } from './time';

// ------------------------------------------------------------ the guard

export const TRANSCRIPT_GUARD = {
  /** A span whose mean token log-probability is below this was a guess. */
  minAvgLogprob: -0.75,
  /** Text that zlib shrinks by more than this is one phrase said over and over. */
  maxCompressionRatio: 2.4,
} as const;

export interface SpanEvidence {
  text: string;
  /** Mean log-probability of the tokens the decoder picked; null when it picked none. */
  avgLogprob: number | null;
  /** UTF-8 bytes of the text / bytes after zlib; null when the text is empty. */
  compressionRatio: number | null;
}

/** Anything but white space and punctuation: a letter or a digit in any script. */
const HAS_CONTENT = /[\p{L}\p{N}]/u;

export type SpanVerdict = 'ok' | 'unclear';

/**
 * `unclear`: the detector heard speech here but the text is not shown — the
 * recogniser was unsure (log-probability), looped (compression), or wrote
 * nothing readable. The span stays in the transcript as "(anlaşılamadı)".
 */
export function spanVerdict(evidence: SpanEvidence): SpanVerdict {
  if (!HAS_CONTENT.test(evidence.text)) return 'unclear';
  if (evidence.avgLogprob !== null && evidence.avgLogprob < TRANSCRIPT_GUARD.minAvgLogprob) return 'unclear';
  if (evidence.compressionRatio !== null && evidence.compressionRatio > TRANSCRIPT_GUARD.maxCompressionRatio) {
    return 'unclear';
  }
  return 'ok';
}

// ------------------------------------------------------------ how much was understood

/** From this share of the found speech left unwritten, the result says so in numbers. */
export const COVERAGE_NOTE_FROM = 0.1;

export interface Coverage {
  /** Whole per cent of the FOUND speech time that was written, rounded down (never "100" with something missing). */
  writtenPercent: number;
  /** Stretches left as "(anlaşılamadı)". */
  unclearCount: number;
  /** A meaningful part was not written: tell the user plainly. */
  worthSaying: boolean;
}

/**
 * How much of the speech the detector found ended up as text, by time.
 * It cannot count speech the detector never found — the sentence shown
 * says "bulunan konuşmanın" for that reason.
 */
export function transcriptCoverage(run: { speechUs: number; unclearUs: number; unclearSpans: number }): Coverage {
  const speechUs = Math.max(0, run.speechUs);
  const unclearUs = Math.min(speechUs, Math.max(0, run.unclearUs));
  const share = speechUs > 0 ? unclearUs / speechUs : 0;
  return {
    writtenPercent: speechUs > 0 ? Math.floor((1 - share) * 100) : 0,
    unclearCount: Math.max(0, run.unclearSpans),
    worthSaying: run.unclearSpans > 0 && share >= COVERAGE_NOTE_FROM,
  };
}

// ------------------------------------------------------------ words and segments

export interface TranscriptWord {
  /** Source time, integer microseconds, half-open. */
  startUs: Micros;
  endUs: Micros;
  text: string;
}

/** One speech span of the detector and what was written for it. */
export interface TranscriptSegment {
  startUs: Micros;
  endUs: Micros;
  state: SpanVerdict;
  /** Empty for `unclear`. */
  words: TranscriptWord[];
}

/** A word as the recogniser reports it: seconds from the start of the span's audio. */
export interface RecognisedChunk {
  text: string;
  start: number | null;
  end: number | null;
}

/** How late the recogniser's word starts and word ends are, as measured per model. */
export interface TimingOffset {
  startUs: Micros;
  endUs: Micros;
}

const toUs = (seconds: number): Micros => Math.round(seconds * US_PER_SECOND);

/**
 * The recogniser's words on the source clock, the constant lateness of these
 * exports taken out (spike §6.4), never outside the span and never running
 * backwards.
 */
export function wordsOnSourceClock(
  span: SpeechSpan,
  chunks: readonly RecognisedChunk[],
  timingOffset: TimingOffset,
): TranscriptWord[] {
  const spanStartUs = toUs(span.start);
  const spanEndUs = Math.max(spanStartUs, toUs(span.end));
  const words: TranscriptWord[] = [];
  let floorUs = spanStartUs;
  for (const chunk of chunks) {
    const text = chunk.text.replace(/\s+/g, ' ').trim();
    if (!text || chunk.start === null) continue;
    const rawStart = spanStartUs + toUs(chunk.start) - timingOffset.startUs;
    const rawEnd = chunk.end === null ? spanEndUs : spanStartUs + toUs(chunk.end) - timingOffset.endUs;
    const startUs = Math.min(spanEndUs, Math.max(floorUs, rawStart));
    const endUs = Math.min(spanEndUs, Math.max(startUs, rawEnd));
    words.push({ startUs, endUs, text });
    floorUs = startUs;
  }
  return words;
}

export function buildSegment(
  span: SpeechSpan,
  chunks: readonly RecognisedChunk[],
  evidence: SpanEvidence,
  timingOffset: TimingOffset,
): TranscriptSegment {
  const startUs = toUs(span.start);
  const endUs = Math.max(startUs, toUs(span.end));
  if (spanVerdict(evidence) === 'unclear') return { startUs, endUs, state: 'unclear', words: [] };
  const words = wordsOnSourceClock(span, chunks, timingOffset);
  // Text without a single timed word cannot be placed: say so rather than guess a time.
  if (words.length === 0) return { startUs, endUs, state: 'unclear', words: [] };
  return { startUs, endUs, state: 'ok', words };
}

// ------------------------------------------------------------ the panel's lines

export interface UnclearRange {
  startUs: Micros;
  endUs: Micros;
}

export type TranscriptLine =
  | { kind: 'cue'; key: string; cueId: string; startUs: Micros; endUs: Micros; text: string }
  | { kind: 'unclear'; key: string; startUs: Micros; endUs: Micros };

/**
 * The lines of the transcript panel, in time order: the track's cues, and
 * the spans that could not be written. An unclear span a line has since been
 * typed over is not listed twice.
 */
export function transcriptLines(track: Pick<CaptionTrackV2, 'cues' | 'unclear'> | undefined): TranscriptLine[] {
  if (!track) return [];
  const lines: TranscriptLine[] = track.cues.map((cue) => ({
    kind: 'cue',
    key: cue.cueId,
    cueId: cue.cueId,
    startUs: cue.startUs,
    endUs: cue.endUs,
    text: cue.text,
  }));
  for (const range of track.unclear ?? []) {
    const covered = track.cues.some((cue) => cue.startUs < range.endUs && range.startUs < cue.endUs);
    if (!covered) lines.push({ kind: 'unclear', key: `u_${range.startUs}`, startUs: range.startUs, endUs: range.endUs });
  }
  return lines.sort((a, b) => a.startUs - b.startUs || (a.kind === 'cue' ? -1 : 1));
}

/** The line playing at a moment of the video: the last one that has started. Index, or -1. */
export function activeLineIndex(lines: readonly TranscriptLine[], videoUs: Micros): number {
  let low = 0;
  let high = lines.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if ((lines[mid] as TranscriptLine).startUs <= videoUs) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

// ------------------------------------------------------------ cut by text

/** Kept before the first word of a kesit made from lines (word onsets are soft). */
export const KESIT_LEAD_US: Micros = 150_000;
/** Lines closer than this in time are one kesit. */
export const KESIT_JOIN_GAP_US: Micros = 300_000;

export interface SourceRangeUs {
  sourceInUs: Micros;
  sourceOutUs: Micros;
}

/**
 * The kesitler "Bunlardan kesit yap" makes: every selected line's own range
 * (a short lead before its first word; its end already lingers past the last
 * word), neighbours in the list — or lines that all but touch — merged into
 * one, in time order, inside the video.
 */
export function kesitRangesFromLines(
  lines: readonly TranscriptLine[],
  selectedKeys: ReadonlySet<string>,
  videoDurationUs: Micros,
): SourceRangeUs[] {
  const ranges: SourceRangeUs[] = [];
  let previousIndex = -2;
  lines.forEach((line, index) => {
    if (!selectedKeys.has(line.key)) return;
    const sourceInUs = Math.max(0, line.startUs - KESIT_LEAD_US);
    const sourceOutUs = Math.min(videoDurationUs, line.endUs);
    if (sourceOutUs <= sourceInUs) return;
    const last = ranges[ranges.length - 1];
    if (last && (index === previousIndex + 1 || sourceInUs - last.sourceOutUs <= KESIT_JOIN_GAP_US)) {
      last.sourceOutUs = Math.max(last.sourceOutUs, sourceOutUs);
    } else {
      ranges.push({ sourceInUs, sourceOutUs });
    }
    previousIndex = index;
  });
  return ranges;
}

// ------------------------------------------------------------ plain text

function stamp(us: Micros): string {
  const total = Math.floor(us / US_PER_SECOND);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const two = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${two(minutes)}:${two(seconds)}`;
}

/** "0:12" / "1:02:03" for the panel. */
export function lineClock(us: Micros): string {
  const total = Math.floor(us / US_PER_SECOND);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

/**
 * "Metni indir": one line per transcript line, "[00:12] text". Unclear spans
 * are in the file too, in the reader's words — leaving them out would make
 * the text look complete when it is not.
 */
export function transcriptText(lines: readonly TranscriptLine[], unclearLabel: string, header: string): string {
  const body = lines.map((line) => {
    const text = line.kind === 'cue' ? line.text.split('\n').join(' ') : unclearLabel;
    return `[${stamp(line.startUs)}] ${text}`;
  });
  return `${[header, '', ...body].join('\r\n')}\r\n`;
}
