/**
 * The settings of the recogniser of "Yazıya dök" (ADR-036), in one place.
 *
 * Two named sets exist so that a change can be MEASURED against what it
 * replaces with the same build, the same clips and the same browser:
 *
 * - `ENGINE_SETTINGS_2026_10_05`: what shipped on 5 Oct 2026 (the October
 *   spike's combination, unchanged);
 * - `ENGINE_SETTINGS`: what runs today.
 *
 * The app always runs `ENGINE_SETTINGS`. A measuring script (never a user:
 * see `transcriptClient.ts`) may ask for the older set, or for the lab's
 * extra attempts, to produce the before/after tables of the ADR.
 */

import { DEFAULT_LEVEL, type LevelParams } from './levelNormalise';
import { DEFAULT_VAD, type VadParams } from './speechSpans';

export interface EngineSettings {
  /**
   * Level normalisation in front of the speech detector; null = the detector
   * hears the sound as it was decoded (5 Oct 2026).
   */
  level: LevelParams | null;
  vad: VadParams;
  /**
   * Bring each speech span to full level before the recogniser hears it.
   * Whisper's own input scaling keeps only ~80 dB below the loudest moment
   * of a span and has a fixed floor: very quiet speech loses its detail to
   * that floor unless it is turned up first.
   */
  spanLevel: boolean;
  /** A second attempt for a span the guard dropped; null = none. */
  secondLook: SecondLookParams | null;
}

export interface SecondLookParams {
  /**
   * A dropped span at least this long is cut in two at its quietest point
   * and each half is recognised and judged on its own, by the same guard.
   */
  splitMinS: number;
  /** Halves are split again down to this depth. */
  maxDepth: number;
}

export const ENGINE_SETTINGS_2026_10_05: EngineSettings = {
  level: null,
  vad: DEFAULT_VAD,
  spanLevel: false,
  secondLook: null,
};

export const ENGINE_SETTINGS: EngineSettings = {
  level: DEFAULT_LEVEL,
  vad: DEFAULT_VAD,
  spanLevel: false,
  secondLook: { splitMinS: 2, maxDepth: 2 },
};

export const NAMED_ENGINE_SETTINGS = {
  current: ENGINE_SETTINGS,
  '2026-10-05': ENGINE_SETTINGS_2026_10_05,
} as const;

/** What a measuring script may ask the worker for. Never set in normal use. */
export interface EngineProbe {
  /** One of the named sets, then individual fields over it. */
  base?: keyof typeof NAMED_ENGINE_SETTINGS;
  settings?: Partial<EngineSettings>;
  /** Also return what the guard saw for every span (text, log-probability, tokens). */
  trace?: boolean;
  /**
   * Lab only: for every span the guard dropped, also try these and record
   * what came out — WITHOUT using it. `pad`: the span with this many seconds
   * of the sound around it; `split`: the span cut in two.
   */
  lab?: { padS?: number[]; split?: boolean };
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** The settings a probe asks for; anything malformed falls back to the shipped set. */
export function settingsFromProbe(probe: EngineProbe | undefined): EngineSettings {
  if (!isRecord(probe)) return ENGINE_SETTINGS;
  const named = probe.base === '2026-10-05' ? ENGINE_SETTINGS_2026_10_05 : ENGINE_SETTINGS;
  const over = isRecord(probe.settings) ? (probe.settings as Partial<EngineSettings>) : {};
  return {
    level: over.level === undefined ? named.level : over.level === null ? null : { ...DEFAULT_LEVEL, ...over.level },
    vad: { ...named.vad, ...(isRecord(over.vad) ? over.vad : {}) },
    spanLevel: typeof over.spanLevel === 'boolean' ? over.spanLevel : named.spanLevel,
    secondLook: over.secondLook === undefined ? named.secondLook : over.secondLook,
  };
}
