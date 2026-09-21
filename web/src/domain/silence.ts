/**
 * Silence-cut SUGGESTIONS (doc 31, first local AI experiment; ADR-018).
 *
 * Pure: the input is a loudness envelope (dBFS per short frame) that an
 * adapter measured from the source audio; the output is a list of source
 * ranges that COULD be removed. Nothing here changes the recipe. The user
 * reviews the list, and only then does a domain command apply it (doc 31:
 * "AI önerisi veri, komut değil").
 *
 * The detector is deliberately simple and explainable — an adaptive level
 * threshold, not a speech model. It finds SILENCE, not "no speech": a pause
 * under background music is not silent and is not suggested. That is the
 * safe failure: a missed pause costs the user a second; a wrong cut costs a
 * syllable.
 */

import type { Micros } from './time';

/** Loudness of one source range, one value per frame. */
export interface LoudnessEnvelope {
  /** Source time of the first frame. */
  startUs: Micros;
  /** Frame length; the adapter uses 10 ms. */
  frameUs: Micros;
  /** dBFS per frame (RMS of the mono mix). Digital silence is clamped to FLOOR_DB. */
  db: readonly number[];
}

export const FLOOR_DB = -120;

export interface SilenceParams {
  /** Shortest pause worth suggesting. */
  minSilenceUs: Micros;
  /** Kept on each side of speech so word onsets and endings are never cut. */
  keepUs: Micros;
  /** Moves the threshold: positive finds more (louder) silence, negative is stricter. */
  sensitivityDb: number;
}

export const DEFAULT_SILENCE_PARAMS: SilenceParams = {
  minSilenceUs: 700_000,
  keepUs: 150_000,
  sensitivityDb: 0,
};

export const SILENCE_PARAM_LIMITS = {
  minSilenceUs: { min: 300_000, max: 3_000_000 },
  keepUs: { min: 0, max: 500_000 },
  // No plus side: every +5 dB setting in the ADR-018 sweep cut speech (1-7 cuts).
  sensitivityDb: { min: -10, max: 0 },
} as const;

/** Sound shorter than this inside a pause (a click, a lip smack) does not break it. */
const BLIP_US = 60_000;
/**
 * ...but only a quiet one. A short sound louder than this many dB under
 * speech (a plosive release, a one-syllable word, a loud click) always breaks
 * the pause. Measured (ADR-018 report): without this check the blip rule bridged
 * speech-level clicks and word ends; 25 dB keeps a margin for 5 ms peaks
 * that run a few dB above the 10 ms RMS.
 */
const BLIP_BELOW_LOUD_DB = 25;
/** A removal smaller than this after padding is not worth an extra cut. */
const MIN_REMOVAL_US = 200_000;
/**
 * Silence must sit at least this far under speech (see `levelStats`). Also the
 * least contrast with a reliable silence: 6 dB above the floor AND 20 dB under
 * speech only fit when floor and speech are 26 dB apart. Below it (noise at
 * 15 dB SNR, loud music) nothing is suggested.
 */
const SPEECH_MARGIN_DB = 20;
const MIN_CONTRAST_DB = SPEECH_MARGIN_DB + 6;

export interface LevelStats {
  /** 10th percentile: the quiet level between sounds. */
  floorDb: number;
  /** 95th percentile: the loud level of speech. */
  loudDb: number;
  /** Frames quieter than this count as silent. */
  thresholdDb: number;
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return FLOOR_DB;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[index] ?? FLOOR_DB;
}

/**
 * The threshold sits a share of the way from the quiet level up to the loud
 * level, never too close to either:
 * - at least 6 dB above the floor, so room tone jitter is not "sound";
 * - at least 20 dB below speech, so soft syllables and word endings are
 *   never "silence" — also after the user's sensitivity is applied;
 * - not lower than 40 dB under speech, so digital-silence gaps (−120 dB)
 *   do not drag it down and hide real room-tone pauses.
 */
export function levelStats(db: readonly number[], sensitivityDb = 0): LevelStats {
  const sorted = db.map((value) => (Number.isFinite(value) ? value : FLOOR_DB)).sort((a, b) => a - b);
  const floorDb = percentile(sorted, 0.1);
  const loudDb = percentile(sorted, 0.95);
  const range = loudDb - floorDb;
  const step = Math.min(20, Math.max(6, range * 0.3));
  const threshold = Math.max(floorDb + step, loudDb - 40) + sensitivityDb;
  return { floorDb, loudDb, thresholdDb: Math.min(threshold, loudDb - SPEECH_MARGIN_DB) };
}

function runMax(db: readonly number[], from: number, to: number): number {
  let max = FLOOR_DB;
  for (let k = from; k < to; k += 1) max = Math.max(max, db[k] ?? FLOOR_DB);
  return max;
}

/**
 * Silence is steady: digital zero or a constant room tone. Inside a pause
 * under music the level keeps rising and falling (beats, tremolo, decaying
 * notes); a range whose sound frames spread more than this is not silence
 * (see `findSilences`, step 4). Digital-silence frames are left out.
 */
const MAX_PAUSE_SPREAD_DB = 10;

function isSteady(db: readonly number[], from: number, to: number): boolean {
  const sound = db.slice(Math.max(0, from), Math.min(db.length, to)).filter((value) => value > FLOOR_DB + 20);
  if (sound.length < 10) return true;
  sound.sort((a, b) => a - b);
  return percentile(sound, 0.9) - percentile(sound, 0.1) <= MAX_PAUSE_SPREAD_DB;
}

export interface SilenceSuggestion {
  /** Source range proposed for removal (already shrunk by `keepUs`). */
  startUs: Micros;
  endUs: Micros;
}

export type SilenceAnalysis =
  | { ok: true; stats: LevelStats; suggestions: SilenceSuggestion[] }
  | { ok: false; reason: 'too_short' | 'low_contrast'; stats: LevelStats };

/**
 * Finds removable pauses in one source range.
 *
 * 1. Frames below the threshold are silent; quiet sound blips shorter than
 *    60 ms inside a pause are ignored.
 * 2. Pauses shorter than `minSilenceUs` are kept (natural rhythm).
 * 3. Each pause is shrunk by `keepUs` on every side that touches sound. A
 *    side that touches the start or end of the range needs no margin: there
 *    is nothing to protect there.
 * 4. What remains, if at least 200 ms, is suggested — unless its level rises
 *    and falls like music; then the whole range is `low_contrast` (no
 *    reliable silence), because a bed under one pause runs under all of them.
 */
export function findSilences(envelope: LoudnessEnvelope, params: SilenceParams): SilenceAnalysis {
  const { db, frameUs, startUs } = envelope;
  const stats = levelStats(db, params.sensitivityDb);
  if (db.length * frameUs < params.minSilenceUs) return { ok: false, reason: 'too_short', stats };
  if (stats.loudDb - stats.floorDb < MIN_CONTRAST_DB) return { ok: false, reason: 'low_contrast', stats };

  const silent = db.map((value) => !(value >= stats.thresholdDb));
  const blipFrames = Math.max(1, Math.round(BLIP_US / frameUs));
  // Fill short sound runs that sit between two silent runs.
  let index = 0;
  while (index < silent.length) {
    if (silent[index]) {
      index += 1;
      continue;
    }
    let end = index;
    while (end < silent.length && !silent[end]) end += 1;
    const bounded = index > 0 && end < silent.length;
    if (bounded && end - index <= blipFrames && runMax(db, index, end) < stats.loudDb - BLIP_BELOW_LOUD_DB) {
      for (let k = index; k < end; k += 1) silent[k] = true;
    }
    index = end;
  }

  const rangeEndUs = startUs + db.length * frameUs;
  const suggestions: SilenceSuggestion[] = [];
  index = 0;
  while (index < silent.length) {
    if (!silent[index]) {
      index += 1;
      continue;
    }
    let end = index;
    while (end < silent.length && silent[end]) end += 1;
    const pauseStart = startUs + index * frameUs;
    const pauseEnd = startUs + end * frameUs;
    if (pauseEnd - pauseStart >= params.minSilenceUs) {
      const from = index === 0 ? pauseStart : pauseStart + params.keepUs;
      const to = end === silent.length ? Math.min(pauseEnd, rangeEndUs) : pauseEnd - params.keepUs;
      if (to - from >= MIN_REMOVAL_US) {
        // One pause that rises and falls like music means a bed runs under
        // the whole range: its other "pauses" are not silence either.
        if (!isSteady(db, Math.floor((from - startUs) / frameUs), Math.ceil((to - startUs) / frameUs))) {
          return { ok: false, reason: 'low_contrast', stats };
        }
        suggestions.push({ startUs: from, endUs: to });
      }
    }
    index = end;
  }
  return { ok: true, stats, suggestions };
}

/** A suggestion tied to the moment it would be cut from. */
export interface ClipSilence extends SilenceSuggestion {
  clipId: string;
}

/**
 * How many moments the recipe would have after removing `removals` from a
 * moment `[inUs, outUs)`: an inner cut splits (+1), an edge cut trims (0),
 * a cut covering everything drops the moment (−1).
 */
export function piecesAfterRemoval(
  inUs: Micros,
  outUs: Micros,
  removals: readonly { startUs: Micros; endUs: Micros }[],
): { startUs: Micros; endUs: Micros }[] {
  const sorted = [...removals]
    .map((removal) => ({ startUs: Math.max(inUs, removal.startUs), endUs: Math.min(outUs, removal.endUs) }))
    .filter((removal) => removal.endUs > removal.startUs)
    .sort((a, b) => a.startUs - b.startUs);
  const pieces: { startUs: Micros; endUs: Micros }[] = [];
  let cursor = inUs;
  for (const removal of sorted) {
    if (removal.startUs > cursor) pieces.push({ startUs: cursor, endUs: removal.startUs });
    cursor = Math.max(cursor, removal.endUs);
  }
  if (cursor < outUs) pieces.push({ startUs: cursor, endUs: outUs });
  return pieces;
}
