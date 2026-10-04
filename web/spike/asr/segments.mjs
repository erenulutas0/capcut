/**
 * Speech pre-filter plumbing, pure (runs in the worker and in Node):
 *
 *  - `spansFromProbs`: Silero-style hysteresis over per-frame speech
 *    probabilities → speech spans.
 *  - `packWindows`: packs the speech spans into windows of at most 30 s of
 *    SPEECH audio. A window is the concatenation of its pieces; everything
 *    between the pieces never reaches the recogniser. (Same idea as
 *    faster-whisper's `vad_filter`.)
 *  - `windowAudio` / `toSourceTime`: builds a window's samples and maps a time
 *    inside the concatenation back to the source clock.
 *
 * All times are seconds on the source clock unless stated otherwise.
 */

export const DEFAULT_VAD = {
  /** A frame at or above this is speech. */
  threshold: 0.5,
  /** Below this a started span may end (hysteresis; Silero uses threshold − 0.15). */
  negThreshold: 0.35,
  /** Shorter speech is dropped (a click, a cough). */
  minSpeechS: 0.25,
  /** A pause shorter than this does not end a span. */
  minSilenceS: 0.5,
  /** Kept on both sides of a span so word onsets and endings survive. */
  padS: 0.2,
};

export function spansFromProbs(probs, frameS, totalS, params = DEFAULT_VAD) {
  const { threshold, negThreshold, minSpeechS, minSilenceS, padS } = { ...DEFAULT_VAD, ...params };
  const raw = [];
  let start = null;
  let silenceFrom = null;
  for (let i = 0; i < probs.length; i += 1) {
    const t = i * frameS;
    const p = probs[i];
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
  const out = raw.map((s) => ({ ...s }));
  for (let i = 0; i < out.length; i += 1) {
    const prevEnd = i > 0 ? raw[i - 1].end : 0;
    const nextStart = i < raw.length - 1 ? raw[i + 1].start : totalS;
    out[i].start = Math.max(raw[i].start - padS, i > 0 ? (prevEnd + raw[i].start) / 2 : 0);
    out[i].end = Math.min(raw[i].end + padS, i < raw.length - 1 ? (raw[i].end + nextStart) / 2 : totalS);
  }
  // Touching spans (gap fully eaten by the padding) become one.
  const merged = [];
  for (const s of out) {
    const last = merged[merged.length - 1];
    if (last && s.start - last.end < 1e-6) last.end = s.end;
    else merged.push(s);
  }
  return merged;
}

/**
 * Splits spans longer than `maxS` and packs the pieces greedily.
 * `quietestAt(from, to)` returns the best place to cut inside [from, to]
 * (lowest speech probability / lowest level); without it the cut is at `to`.
 */
export function packWindows(spans, { maxS = 30, quietestAt = null, perSpan = false } = {}) {
  const pieces = [];
  for (const span of spans) {
    let from = span.start;
    while (span.end - from > maxS) {
      // Look for a pause in the second half of the window, leaving 1 s spare.
      const cut = quietestAt ? quietestAt(from + maxS / 2, from + maxS - 1) : from + maxS - 1;
      pieces.push({ start: from, end: cut, cut: true });
      from = cut;
    }
    pieces.push({ start: from, end: span.end });
  }
  const windows = [];
  let cur = null;
  for (const piece of pieces) {
    const len = piece.end - piece.start;
    // `perSpan`: every span is recognised on its own, so the recogniser's confidence is known per
    // span and a stretch of music that slipped through cannot hide inside a window full of speech.
    if (!cur || perSpan || cur.speechS + len > maxS) {
      cur = { pieces: [], speechS: 0 };
      windows.push(cur);
    }
    cur.pieces.push({ start: piece.start, end: piece.end });
    cur.speechS += len;
  }
  return windows;
}

/** Concatenates a window's pieces. Also records where each piece starts inside the concatenation. */
export function windowAudio(audio, sampleRate, window) {
  const ranges = window.pieces.map((p) => [Math.max(0, Math.round(p.start * sampleRate)), Math.min(audio.length, Math.round(p.end * sampleRate))]);
  const total = ranges.reduce((n, [a, b]) => n + Math.max(0, b - a), 0);
  const out = new Float32Array(total);
  const offsets = [];
  let at = 0;
  for (const [a, b] of ranges) {
    offsets.push(at / sampleRate);
    if (b > a) {
      out.set(audio.subarray(a, b), at);
      at += b - a;
    }
  }
  return { samples: out, offsets, durationS: total / sampleRate };
}

/** A time inside the window's concatenation → source time. `asEnd` keeps an end time inside the piece it ends in. */
export function toSourceTime(window, offsets, t, asEnd = false) {
  let k = 0;
  for (let i = 0; i < offsets.length; i += 1) {
    const starts = offsets[i];
    if (asEnd ? t > starts + 1e-9 : t >= starts - 1e-9) k = i;
  }
  const piece = window.pieces[k];
  return Math.min(piece.end, Math.max(piece.start, piece.start + (t - offsets[k])));
}

/** Speech = the complement of removable silences (our ADR-018 detector reports silences, not speech). */
export function complement(silences, totalS) {
  const out = [];
  let at = 0;
  for (const s of [...silences].sort((a, b) => a.start - b.start)) {
    if (s.start - at > 1e-6) out.push({ start: at, end: s.start });
    at = Math.max(at, s.end);
  }
  if (totalS - at > 1e-6) out.push({ start: at, end: totalS });
  return out;
}
