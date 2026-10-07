/**
 * Where the speech is (ADR-036): turns the speech detector's per-frame
 * probabilities into speech spans, and cuts a span that is too long for the
 * recogniser at its quietest point.
 *
 * A port of the October spike's `segments.mjs` (docs/spikes/2026-10-03-asr-
 * on-device-english.md), rule for rule: the published Silero defaults, and
 * every span recognised ON ITS OWN ("per span") — a stretch of music the
 * detector let through then stands alone, where the recogniser's own doubt
 * about it can be seen and the span dropped.
 *
 * Times here are SECONDS on the source clock, as in the spike: the detector
 * works in 32 ms frames and the numbers were measured in this form. They
 * become integer microseconds where the transcript is built
 * (`transcript.ts`), before anything is stored.
 */

export interface VadParams {
  /** A frame at or above this is speech. */
  threshold: number;
  /** Below this a started span may end (Silero: threshold − 0.15). */
  negThreshold: number;
  /** Shorter speech is dropped (a click, a cough). */
  minSpeechS: number;
  /** A pause shorter than this does not end a span. */
  minSilenceS: number;
  /** Kept on both sides of a span so word onsets and endings survive. */
  padS: number;
}

/** Silero's published defaults. The spike swept them and changed nothing. */
export const DEFAULT_VAD: VadParams = {
  threshold: 0.5,
  negThreshold: 0.35,
  minSpeechS: 0.25,
  minSilenceS: 0.5,
  padS: 0.2,
};

/**
 * The settings in force since 7 Oct 2026 (ADR-036, "Gerçekçi küme"): the
 * same thresholds, but a pause has to last 1.2 s before it ends a span, and
 * 0.4 s is kept on both sides.
 *
 * Why: people talking to each other speak in short bursts ("yeah", "okay —
 * so…"). With the published 0.5 s every burst became a span of its own, and
 * a one-second span is exactly what the recogniser is least sure of: the
 * guard dropped it. Joined across short pauses, the recogniser hears a
 * sentence with its context. Chosen on the development half of the realistic
 * set against 0.5 / 0.2 (the defaults), 0.8 / 0.3 and 2.0 / 0.4, frozen, then
 * run once on the validation half. 2.0 s wrote more by the clock but lost
 * words INSIDE long spans without saying so, and was not taken.
 */
export const CONVERSATION_VAD: VadParams = {
  ...DEFAULT_VAD,
  minSilenceS: 1.2,
  padS: 0.4,
};

/** Silero v5 at 16 kHz: 512 new samples per step, the last 64 of the previous step in front. */
export const VAD_SAMPLE_RATE = 16_000;
export const VAD_HOP = 512;
export const VAD_CONTEXT = 64;
export const VAD_FRAME_S = VAD_HOP / VAD_SAMPLE_RATE;

/** The recogniser's window: Whisper hears 30 s at a time. */
export const MAX_SPAN_S = 30;

export interface SpeechSpan {
  start: number;
  end: number;
}

export function spansFromProbs(
  probs: ArrayLike<number>,
  frameS: number,
  totalS: number,
  params: Partial<VadParams> = {},
): SpeechSpan[] {
  const { threshold, negThreshold, minSpeechS, minSilenceS, padS } = { ...DEFAULT_VAD, ...params };
  const raw: SpeechSpan[] = [];
  let start: number | null = null;
  let silenceFrom: number | null = null;
  for (let i = 0; i < probs.length; i += 1) {
    const t = i * frameS;
    const p = probs[i] as number;
    if (start === null) {
      if (p >= threshold) {
        start = t;
        silenceFrom = null;
      }
      continue;
    }
    if (p >= threshold) {
      silenceFrom = null;
    } else if (p < negThreshold) {
      if (silenceFrom === null) silenceFrom = t;
      if (t + frameS - silenceFrom >= minSilenceS) {
        if (silenceFrom - start >= minSpeechS) raw.push({ start, end: silenceFrom });
        start = null;
        silenceFrom = null;
      }
    }
  }
  if (start !== null) {
    const end = silenceFrom ?? totalS;
    if (end - start >= minSpeechS) raw.push({ start, end: Math.min(end, totalS) });
  }
  // Pad; neighbours that would overlap share the gap half and half.
  const out = raw.map((span) => ({ ...span }));
  for (let i = 0; i < out.length; i += 1) {
    const current = raw[i] as SpeechSpan;
    const target = out[i] as SpeechSpan;
    const prevEnd = i > 0 ? (raw[i - 1] as SpeechSpan).end : 0;
    const nextStart = i < raw.length - 1 ? (raw[i + 1] as SpeechSpan).start : totalS;
    target.start = Math.max(current.start - padS, i > 0 ? (prevEnd + current.start) / 2 : 0);
    target.end = Math.min(current.end + padS, i < raw.length - 1 ? (current.end + nextStart) / 2 : totalS);
  }
  // Touching spans (gap fully eaten by the padding) become one.
  const merged: SpeechSpan[] = [];
  for (const span of out) {
    const last = merged[merged.length - 1];
    if (last && span.start - last.end < 1e-6) last.end = span.end;
    else merged.push(span);
  }
  return merged;
}

/**
 * The place to cut a long span: the frame with the lowest speech probability
 * in [from, to].
 */
export function quietestFrameTime(probs: ArrayLike<number>, frameS: number, from: number, to: number): number {
  let best = Math.floor(from / frameS);
  const last = Math.min(probs.length - 1, Math.floor(to / frameS));
  for (let i = best; i <= last; i += 1) {
    if ((probs[i] as number) < (probs[best] as number)) best = i;
  }
  return best * frameS;
}

/**
 * Every span as its own piece for the recogniser; a span longer than `maxS`
 * is cut at the quietest point of the second half of each window, one second
 * spare (the spike's "forced cut").
 */
export function splitLongSpans(
  spans: readonly SpeechSpan[],
  quietestAt: ((from: number, to: number) => number) | null,
  maxS: number = MAX_SPAN_S,
): SpeechSpan[] {
  const pieces: SpeechSpan[] = [];
  for (const span of spans) {
    let from = span.start;
    while (span.end - from > maxS) {
      const proposed = quietestAt ? quietestAt(from + maxS / 2, from + maxS - 1) : from + maxS - 1;
      // A cut must move forward and stay inside the window, whatever the probabilities say.
      const cut = Math.min(from + maxS - 1, Math.max(from + maxS / 2, proposed));
      pieces.push({ start: from, end: cut });
      from = cut;
    }
    pieces.push({ start: from, end: span.end });
  }
  return pieces;
}
