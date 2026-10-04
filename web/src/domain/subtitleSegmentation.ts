/**
 * Word-timed transcript → subtitle lines (ADR-036).
 *
 * The rules are the October spike's (`web/spike/asr/segment-lines.mjs`,
 * report §11.4), with the two faults its own examples showed put right: a
 * line no longer breaks inside "25 -30", and a sentence's last word is not
 * left alone on a line of its own when it can share the previous one.
 *
 * - at most 2 lines of 32 characters (a 9:16 frame; inside the app's 120
 *   characters / 2 lines, ADR-015);
 * - a line ends at a sentence end (. ? !), at a pause of 0.5 s or more, when
 *   the next word would not fit, or when it would pass 6 s; more than half
 *   full, it also ends at a comma;
 * - a line stays until 0.15 s after its last word, never into the next line,
 *   and for at least 0.8 s when the gap to the next line allows it;
 * - the break between the two lines goes where they are most even, with a
 *   preference for breaking after punctuation;
 * - words of different speech spans never share a line.
 *
 * Pure. `fits` lets the caller add the real test — the app's own caption
 * layout with the real typeface, for every frame shape — so a line this
 * module makes is a line the export will not refuse.
 */

import type { TranscriptSegment, TranscriptWord, UnclearRange } from './transcript';
import type { Micros } from './time';

export interface CueRules {
  maxLineChars: number;
  maxLines: 1 | 2;
  pauseUs: Micros;
  maxDurationUs: Micros;
  lingerUs: Micros;
  minDurationUs: Micros;
  /** No line is shorter than this on screen; lines that would be are joined to a neighbour. */
  hardMinDurationUs: Micros;
  /** A last line this short (characters) is shared with the line before it when it can be. */
  orphanChars: number;
}

export const CUE_RULES: CueRules = {
  maxLineChars: 32,
  maxLines: 2,
  pauseUs: 500_000,
  maxDurationUs: 6_000_000,
  lingerUs: 150_000,
  minDurationUs: 800_000,
  hardMinDurationUs: 300_000,
  orphanChars: 10,
};

export interface SegmentedCue {
  startUs: Micros;
  endUs: Micros;
  /** One or two lines, joined by a line feed. */
  text: string;
}

export type FitsFrame = (text: string) => boolean;

const LF = String.fromCharCode(0x0a);
const SENTENCE_END = /[.?!]["')\]]?$/;
const SOFT_END = /[,;:]$/;

const chars = (text: string): number => Array.from(text).length;
const joined = (words: readonly TranscriptWord[]): string => words.map((word) => word.text).join(' ');

/**
 * True when `next` belongs to `previous` and no line may end between them:
 * "25" + "-30", "$" + "5", "10" + "%", a word ending in a hyphen.
 */
export function glued(previous: string, next: string): boolean {
  if (/^[-‐-―%°'’.,;:!?)\]]/.test(next)) return true;
  if (/[-‐-―$#(\[€£]$/.test(previous)) return true;
  return false;
}

/**
 * The words as one line, or as the best two; null when they cannot be shown
 * in `maxLines` lines of `maxLineChars`.
 */
export function layoutLines(
  words: readonly TranscriptWord[],
  rules: CueRules = CUE_RULES,
  fits: FitsFrame = () => true,
): string[] | null {
  const text = joined(words);
  if (chars(text) <= rules.maxLineChars && fits(text)) return [text];
  // A single word wider than a line cannot be split here; the caption layout breaks it by letter.
  if (words.length === 1) return chars(text) <= rules.maxLineChars * rules.maxLines ? [text] : null;
  if (rules.maxLines < 2) return null;
  let best: { score: number; lines: string[] } | null = null;
  for (let k = 1; k < words.length; k += 1) {
    if (glued((words[k - 1] as TranscriptWord).text, (words[k] as TranscriptWord).text)) continue;
    const a = joined(words.slice(0, k));
    const b = joined(words.slice(k));
    if (chars(a) > rules.maxLineChars || chars(b) > rules.maxLineChars) continue;
    const score = Math.abs(chars(a) - chars(b)) - (/[,;:.?!]$/.test(a) ? 6 : 0);
    if (best && score >= best.score) continue;
    if (!fits(`${a}${LF}${b}`)) continue;
    best = { score, lines: [a, b] };
  }
  return best ? best.lines : null;
}

function groupWords(words: readonly TranscriptWord[], rules: CueRules, fits: FitsFrame): TranscriptWord[][] {
  const capacity = rules.maxLineChars * rules.maxLines;
  const groups: TranscriptWord[][] = [];
  let current: TranscriptWord[] = [];
  const flush = () => {
    if (current.length > 0) groups.push(current);
    current = [];
  };
  words.forEach((word, index) => {
    const last = current[current.length - 1];
    if (last) {
      const first = current[0] as TranscriptWord;
      const stuck = glued(last.text, word.text);
      const pause = word.startUs - last.endUs;
      const tooLong = word.endUs - first.startUs > rules.maxDurationUs;
      const room = layoutLines([...current, word], rules, fits) !== null;
      if (!room || (!stuck && (pause >= rules.pauseUs || tooLong))) flush();
    }
    current.push(word);
    const next = words[index + 1];
    if (next && glued(word.text, next.text)) return;
    const length = chars(joined(current));
    if (SENTENCE_END.test(word.text) || (SOFT_END.test(word.text) && length > capacity / 2)) flush();
  });
  flush();
  return groups;
}

/** Joins or re-divides two neighbouring groups; null when neither can be laid out. */
function shareOut(
  a: readonly TranscriptWord[],
  b: readonly TranscriptWord[],
  rules: CueRules,
  fits: FitsFrame,
): TranscriptWord[][] | null {
  const all = [...a, ...b];
  const first = all[0] as TranscriptWord;
  const last = all[all.length - 1] as TranscriptWord;
  if (last.endUs - first.startUs <= rules.maxDurationUs && layoutLines(all, rules, fits)) return [all];
  let best: { score: number; split: number } | null = null;
  for (let k = 1; k < all.length; k += 1) {
    const left = all.slice(0, k);
    const right = all.slice(k);
    if (glued((left[left.length - 1] as TranscriptWord).text, (right[0] as TranscriptWord).text)) continue;
    if (chars(joined(right)) <= rules.orphanChars) continue;
    if (!layoutLines(left, rules, fits) || !layoutLines(right, rules, fits)) continue;
    const punctuation = /[,;:]$/.test((left[left.length - 1] as TranscriptWord).text) ? 12 : 0;
    const score = Math.abs(chars(joined(left)) - chars(joined(right))) - punctuation;
    if (!best || score < best.score) best = { score, split: k };
  }
  return best ? [all.slice(0, best.split), all.slice(best.split)] : null;
}

/** A short last line of a sentence joins the line before it, or takes some of its words. */
function fixOrphans(groups: TranscriptWord[][], rules: CueRules, fits: FitsFrame): TranscriptWord[][] {
  const out: TranscriptWord[][] = [];
  for (const group of groups) {
    const previous = out[out.length - 1];
    if (previous && chars(joined(group)) <= rules.orphanChars) {
      const previousLast = previous[previous.length - 1] as TranscriptWord;
      const pause = (group[0] as TranscriptWord).startUs - previousLast.endUs;
      if (pause < rules.pauseUs && !SENTENCE_END.test(previousLast.text)) {
        const shared = shareOut(previous, group, rules, fits);
        if (shared) {
          out.splice(out.length - 1, 1, ...shared);
          continue;
        }
      }
    }
    out.push(group);
  }
  return out;
}

/** Lines that would flash by (the next one starts at once) are joined to a neighbour when they fit. */
function joinFlashes(groups: TranscriptWord[][], rules: CueRules, fits: FitsFrame): TranscriptWord[][] {
  const out = groups.map((group) => [...group]);
  for (let index = 0; index < out.length; index += 1) {
    const group = out[index] as TranscriptWord[];
    const next = out[index + 1];
    if (!next) break;
    const window = (next[0] as TranscriptWord).startUs - (group[0] as TranscriptWord).startUs;
    if (window >= rules.hardMinDurationUs) continue;
    if (layoutLines([...group, ...next], rules, fits)) {
      out.splice(index, 2, [...group, ...next]);
      index -= 1;
      continue;
    }
    const previous = out[index - 1];
    if (previous && layoutLines([...previous, ...group], rules, fits)) {
      out.splice(index - 1, 2, [...previous, ...group]);
      index -= 2;
    }
  }
  return out;
}

/**
 * Subtitle lines for the words of ONE speech span. `nextStartUs`: where the
 * next span's first line begins (or the end of the video), which the last
 * line here must not run into.
 */
export function cuesForWords(
  words: readonly TranscriptWord[],
  nextStartUs: Micros,
  rules: CueRules = CUE_RULES,
  fits: FitsFrame = () => true,
): SegmentedCue[] {
  const timed = words.filter((word) => word.text.length > 0);
  if (timed.length === 0) return [];
  const groups = joinFlashes(fixOrphans(groupWords(timed, rules, fits), rules, fits), rules, fits);
  return groups.map((group, index) => {
    const first = group[0] as TranscriptWord;
    const last = group[group.length - 1] as TranscriptWord;
    const following = groups[index + 1];
    const limit = following ? (following[0] as TranscriptWord).startUs : nextStartUs;
    const wanted = Math.max(last.endUs + rules.lingerUs, first.startUs + rules.minDurationUs);
    // Never into the next line; a line whose words run to the limit ends there.
    const endUs = Math.max(Math.min(limit, wanted), Math.min(last.endUs, limit));
    const lines = layoutLines(group, rules, fits) ?? [joined(group)];
    return { startUs: first.startUs, endUs, text: lines.join(LF) };
  });
}

export interface TranscriptCues {
  cues: SegmentedCue[];
  /** The spans that could not be written, for the "(anlaşılamadı)" lines. */
  unclear: UnclearRange[];
}

/** The whole transcript as subtitle lines and unclear ranges, in time order. */
export function transcriptToCues(
  segments: readonly TranscriptSegment[],
  videoDurationUs: Micros,
  rules: CueRules = CUE_RULES,
  fits: FitsFrame = () => true,
): TranscriptCues {
  const ordered = [...segments].sort((a, b) => a.startUs - b.startUs);
  const cues: SegmentedCue[] = [];
  const unclear: UnclearRange[] = [];
  ordered.forEach((segment, index) => {
    if (segment.state === 'unclear' || segment.words.length === 0) {
      const startUs = Math.max(0, segment.startUs);
      const endUs = Math.min(videoDurationUs, segment.endUs);
      if (endUs > startUs) unclear.push({ startUs, endUs });
      return;
    }
    let nextStartUs = videoDurationUs;
    for (let k = index + 1; k < ordered.length; k += 1) {
      const later = ordered[k] as TranscriptSegment;
      const firstWord = later.words[0];
      if (later.state === 'ok' && firstWord) {
        nextStartUs = Math.min(videoDurationUs, firstWord.startUs);
        break;
      }
    }
    cues.push(...cuesForWords(segment.words, nextStartUs, rules, fits));
  });
  return { cues, unclear };
}
