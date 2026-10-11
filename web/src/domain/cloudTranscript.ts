/**
 * The cloud transcript route (ADR-039), as pure rules: what the proxy's
 * answers mean, how the provider's words become the app's transcript lines,
 * and the two numbers the choice screen shows before anything is sent.
 *
 * Nothing here touches the network. The route exists only in a build that
 * names the proxy (`NEXT_PUBLIC_CLOUD_TRANSCRIPT_URL`); this module is the
 * part of it that can be tested without a browser.
 */

import { CUE_RULES, cuesForWords, type CueRules, type FitsFrame, type SegmentedCue } from './subtitleSegmentation';
import { US_PER_SECOND, type Micros } from './time';
import type { TranscriptWord } from './transcript';

// ------------------------------------------------------------ what can go wrong

/**
 * Every way the cloud route can end without a transcript. Each has its own
 * sentence (`cloud.failed.<reason>`), and every one of them offers
 * "Cihazımda yaz" — the on-device route never depends on any of this.
 */
export type CloudFailure =
  /** The proxy did not answer: no network, the Worker is down, its daily request limit is used up. */
  | 'unreachable'
  /** The route is switched off: the founder's switch, or the month's spending cap is reached. */
  | 'off'
  /** The invite code is not (or no longer) valid. */
  | 'invite_invalid'
  /** The invite has fewer minutes left than this sound needs. */
  | 'minutes_used_up'
  /** The sound is longer than one job may be. */
  | 'too_long'
  /** Another job of this invite is still running. */
  | 'busy'
  /** Too many attempts from this address in the last hour. */
  | 'rate_limited'
  /** The connection was lost while the sound was being sent. */
  | 'upload_interrupted'
  /** The speech service refused or failed the job. */
  | 'provider_error'
  /** The job finished, and there was not one word in it. */
  | 'empty'
  /** No answer for far longer than such a job takes. */
  | 'timeout'
  /** This browser cannot make the sound-only file (no Opus and no AAC encoder). */
  | 'audio_unavailable'
  /** The video's sound could not be read. */
  | 'audio_unreadable'
  /** Anything else: a bug on our side, or an answer this build does not know. */
  | 'internal_error';

/** The proxy's refusal (`{ error }` with an HTTP status) as one of the above. */
export function failureFromAnswer(status: number, error: unknown): CloudFailure {
  const code = typeof error === 'string' ? error : '';
  if (code === 'invite_invalid' || code === 'invite_required') return 'invite_invalid';
  if (code === 'invite_minutes_used_up') return 'minutes_used_up';
  if (code === 'cloud_off' || code === 'monthly_cap_reached') return 'off';
  if (code === 'too_long') return 'too_long';
  if (code === 'job_in_progress') return 'busy';
  if (code === 'rate_limited') return 'rate_limited';
  if (code === 'provider_error') return 'provider_error';
  // Our own name for the job is already known to the proxy: the browser sent the upload a second time after
  // the connection broke under the first (browsers do that by themselves). For the user: sending was cut off.
  if (code === 'job_id_taken') return 'upload_interrupted';
  // Without a known code, the status alone.
  if (status === 401) return 'invite_invalid';
  if (status === 402) return 'minutes_used_up';
  if (status === 429) return 'rate_limited';
  if (status === 503) return 'off';
  if (status === 502 || status === 504) return 'provider_error';
  return 'internal_error';
}

// ------------------------------------------------------------ quota

export interface CloudQuota {
  /** False: the route is switched off or the month's cap is reached. */
  on: boolean;
  remainingMinutes: number;
  /** The longest sound one job may be. */
  maxJobMinutes: number;
}

export function parseQuota(body: unknown): CloudQuota | null {
  if (typeof body !== 'object' || body === null) return null;
  const { on, remainingMinutes, maxJobMinutes } = body as Record<string, unknown>;
  if (typeof on !== 'boolean') return null;
  if (typeof remainingMinutes !== 'number' || !Number.isFinite(remainingMinutes) || remainingMinutes < 0) return null;
  if (typeof maxJobMinutes !== 'number' || !Number.isFinite(maxJobMinutes) || maxJobMinutes <= 0) return null;
  return { on, remainingMinutes: Math.floor(remainingMinutes), maxJobMinutes: Math.floor(maxJobMinutes) };
}

/** Minutes this sound takes from the invite, as the card says it: whole minutes, rounded UP (never less than is taken). */
export function minutesCharged(durationUs: Micros): number {
  return Math.max(1, Math.ceil(durationUs / (60 * US_PER_SECOND)));
}

/** What the card can say about the minutes before anything is sent. */
export type MinutesVerdict =
  | { kind: 'fits'; charged: number; left: number }
  | { kind: 'not_enough'; charged: number; remaining: number }
  | { kind: 'too_long'; maxJobMinutes: number }
  | { kind: 'off' };

export function minutesVerdict(quota: CloudQuota, durationUs: Micros): MinutesVerdict {
  if (!quota.on) return { kind: 'off' };
  if (durationUs > quota.maxJobMinutes * 60 * US_PER_SECOND) return { kind: 'too_long', maxJobMinutes: quota.maxJobMinutes };
  const charged = minutesCharged(durationUs);
  if (charged > quota.remainingMinutes) return { kind: 'not_enough', charged, remaining: quota.remainingMinutes };
  return { kind: 'fits', charged, left: quota.remainingMinutes - charged };
}

// ------------------------------------------------------------ how long it takes

/**
 * "Yaklaşık N dakika sürer" on the cloud card, from the one real measurement
 * there is (ADR-039, addendum of 11 Oct 2026: twelve files through the same
 * provider, EU region, sound-only Opus, from upload to result):
 *
 *   51 min → 38,4 s · 21 min → 22,0 s · 14 min → 15,5 s and 20,7 s ·
 *   5 min → 10,8 s and 14,6 s · ~2 min → 10,9 s · 10 s → ≈ 4 s ·
 *   two more short files → 11,3 s and 15,2 s
 *
 * `20 s + 0,75 s per minute of sound` lies above every one of them
 * (51 min → 58 s, 14 min → 30,5 s, a file of seconds → 20 s). The card shows
 * it in whole minutes, rounded up, with "yaklaşık". It does NOT include
 * making the sound-only file on this device or a slow connection: neither
 * was measured (the ADR says so), and a phone will be slower than the
 * measuring machine.
 */
export const CLOUD_TIME_MODEL = { baseS: 20, perMinuteS: 0.75 } as const;

export function cloudEstimateMinutes(durationUs: Micros): number {
  const minutes = Math.max(0, durationUs) / (60 * US_PER_SECOND);
  return Math.max(1, Math.ceil((CLOUD_TIME_MODEL.baseS + CLOUD_TIME_MODEL.perMinuteS * minutes) / 60));
}

/** After this long without a result the job is given up (and deleted): 15 minutes, or ten times the estimate. */
export function cloudGiveUpMs(durationUs: Micros): number {
  return Math.max(15, cloudEstimateMinutes(durationUs) * 10) * 60_000;
}

// ------------------------------------------------------------ the result

/** A word of the result on the video's clock; `speaker` is 1 for the first voice heard, 2 for the next, … */
export interface CloudWord extends TranscriptWord {
  speaker: number | null;
}

export interface CloudResult {
  words: CloudWord[];
  /** BCP 47 as the caption track stores it ("tr", "en-US"), or null when the provider named none we can store. */
  language: string | null;
  /** How many different voices the provider told apart (0 when it named none). */
  speakers: number;
}

/** More speakers than this are not told apart on screen (a label per line would say nothing any more). */
export const MAX_SPEAKERS = 20;

const LANGUAGE = /^([a-z]{2,3})(?:[_-]([a-zA-Z]{2}))?$/;

/** "en_us" → "en-US"; anything that is not a language code → null. */
export function captionLanguage(code: unknown): string | null {
  if (typeof code !== 'string') return null;
  const match = LANGUAGE.exec(code.trim());
  if (!match) return null;
  return match[2] ? `${match[1]}-${match[2].toUpperCase()}` : (match[1] as string);
}

/**
 * The provider's finished transcript (passed through by the proxy untouched)
 * as words on the video's clock. Null when the answer is not a finished
 * transcript at all — that is a failure, not an empty transcript.
 *
 * - times arrive in milliseconds from the start of the sound we sent, which
 *   begins at the video's zero (`streamMono16k`), so they are source times;
 * - a word without readable text or times is left out (never guessed);
 * - words are kept in order and never run backwards or past the video;
 * - speakers are numbered in the order they are first heard.
 */
export function parseCloudResult(body: unknown, videoDurationUs: Micros): CloudResult | null {
  if (typeof body !== 'object' || body === null) return null;
  const raw = body as { status?: unknown; words?: unknown; language_code?: unknown };
  if (raw.status !== 'completed') return null;
  // A finished transcript of silence has `words: []` (or null): empty, not broken.
  const list = raw.words === null || raw.words === undefined ? [] : raw.words;
  if (!Array.isArray(list)) return null;

  const speakerNumbers = new Map<string, number>();
  const words: CloudWord[] = [];
  let floorUs = 0;
  for (const item of list) {
    if (typeof item !== 'object' || item === null) continue;
    const { text, start, end, speaker } = item as Record<string, unknown>;
    if (typeof text !== 'string' || typeof start !== 'number' || typeof end !== 'number') continue;
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const clean = text.replace(/\s+/g, ' ').trim();
    if (clean === '') continue;
    const startUs = Math.max(floorUs, Math.round(start * 1000));
    if (startUs >= videoDurationUs) continue;
    const endUs = Math.min(videoDurationUs, Math.max(startUs + 1000, Math.round(end * 1000)));
    let number: number | null = null;
    if (typeof speaker === 'string' && speaker !== '') {
      number = speakerNumbers.get(speaker) ?? null;
      if (number === null && speakerNumbers.size < MAX_SPEAKERS) {
        number = speakerNumbers.size + 1;
        speakerNumbers.set(speaker, number);
      }
    }
    words.push({ text: clean, startUs, endUs, speaker: number });
    floorUs = startUs;
  }
  return { words, language: captionLanguage(raw.language_code), speakers: speakerNumbers.size };
}

/** A stretch of words by one voice with no long silence inside. */
export interface CloudSegment {
  speaker: number | null;
  words: CloudWord[];
}

/**
 * Where one stretch ends and the next begins — the cloud route's stand-in for
 * the on-device detector's speech spans:
 *
 * - the speaker changes (a line never carries two people's words), or
 * - there is more than 1,0 s without a word (the same gap the measurement
 *   harness used to turn the provider's words into spans, ADR-039).
 *
 * Inside a stretch the on-device line rules apply unchanged
 * (`subtitleSegmentation.ts`: sentence ends, pauses of 0,5 s, line length).
 */
export const CLOUD_SEGMENT_GAP_US: Micros = 1_000_000;

export function cloudSegments(words: readonly CloudWord[]): CloudSegment[] {
  const segments: CloudSegment[] = [];
  let current: CloudSegment | null = null;
  let previous: CloudWord | null = null;
  for (const word of words) {
    const apart = previous !== null && (word.speaker !== previous.speaker || word.startUs - previous.endUs > CLOUD_SEGMENT_GAP_US);
    if (current === null || apart) {
      current = { speaker: word.speaker, words: [] };
      segments.push(current);
    }
    current.words.push(word);
    previous = word;
  }
  return segments;
}

export interface CloudCue extends SegmentedCue {
  speaker: number | null;
}

/** The whole result as subtitle lines, each with the voice that said it. */
export function cloudCues(
  result: Pick<CloudResult, 'words'>,
  videoDurationUs: Micros,
  rules: CueRules = CUE_RULES,
  fits: FitsFrame = () => true,
): CloudCue[] {
  const segments = cloudSegments(result.words);
  const cues: CloudCue[] = [];
  segments.forEach((segment, index) => {
    const following = segments[index + 1]?.words[0];
    const nextStartUs = following ? Math.min(videoDurationUs, following.startUs) : videoDurationUs;
    for (const cue of cuesForWords(segment.words, nextStartUs, rules, fits)) cues.push({ ...cue, speaker: segment.speaker });
  });
  return cues;
}

/**
 * Which voice each stored line belongs to, for the result screen. The recipe
 * (EDL v4) has no field for it and this route does not add one: the map lives
 * with the open wizard only. Lines are matched by their start time — the
 * transcript command numbers the accepted lines in time order and skips the
 * ones a caption rule refuses.
 */
export function speakersByCue(
  cues: readonly CloudCue[],
  stored: readonly { cueId: string; startUs: Micros }[],
): Map<string, number> {
  const byStart = new Map<number, number>();
  for (const cue of cues) if (cue.speaker !== null) byStart.set(Math.round(cue.startUs), cue.speaker);
  const out = new Map<string, number>();
  for (const line of stored) {
    const speaker = byStart.get(line.startUs);
    if (speaker !== undefined) out.set(line.cueId, speaker);
  }
  return out;
}
