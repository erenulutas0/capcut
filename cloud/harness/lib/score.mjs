/**
 * Scores a provider transcript with the SAME measures as the on-device tables
 * of ADR-036, so the two can be put side by side.
 *
 * Reused as is (imported, not copied):
 *  - `normalizeText` and `percentile` from `web/spike/asr/metrics.mjs` — the
 *    STRICT measure's normaliser (lower case, punctuation → space, numbers as
 *    written), the one `web/scripts/transcript/score.mjs` and `score-real.mjs`
 *    use;
 *  - `web/spike/asr/normalize_en.py` (OpenAI's EnglishTextNormalizer) for the
 *    NORMALISED English measure, through the same venv `score-real.mjs` uses.
 *    If that venv does not exist the normalised column is reported as "not
 *    computed" — it is never approximated.
 *
 * Ported (those two scripts run on import, so their functions cannot be
 * imported): the memory-light Levenshtein with a backtrace from
 * `score-real.mjs`, the matched-word timing statistics from `score.mjs`
 * (matched words only; start and end error; median, p95, share within
 * ±250 ms), and the "share of the reference speech time that was written".
 *
 * ONE DIFFERENCE, stated wherever the number is printed: on the device a
 * reference word counts as "written" when its midpoint falls inside a span the
 * app shows text for. The provider returns words, not spans, so here a span is
 * a run of returned words with gaps of at most `joinS` (1.0 s), padded by
 * `padS` (0.25 s). The deleted-words share of the WER is the stricter
 * comparison and is printed next to it.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { normalizeText, percentile } from '../../../web/spike/asr/metrics.mjs';
import { repoRoot } from './manifest.mjs';

export const TIMING_THRESHOLD_S = 0.25;
export const COVERAGE_JOIN_S = 1.0;
export const COVERAGE_PAD_S = 0.25;

/** Token errors by Levenshtein, split into substitutions, deletions and insertions, with the matched pairs. */
export function errors(ref, hyp) {
  const n = ref.length;
  const m = hyp.length;
  let previous = new Uint32Array(m + 1);
  const back = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1));
  for (let j = 0; j <= m; j += 1) {
    previous[j] = j;
    back[0][j] = 2;
  }
  for (let i = 1; i <= n; i += 1) {
    const current = new Uint32Array(m + 1);
    current[0] = i;
    back[i][0] = 1;
    for (let j = 1; j <= m; j += 1) {
      const same = ref[i - 1] === hyp[j - 1];
      const diagonal = previous[j - 1] + (same ? 0 : 1);
      const up = previous[j] + 1;
      const left = current[j - 1] + 1;
      const best = Math.min(diagonal, up, left);
      current[j] = best;
      back[i][j] = best === diagonal ? 0 : best === up ? 1 : 2;
    }
    previous = current;
  }
  const out = { errors: previous[m], sub: 0, del: 0, ins: 0, pairs: [] };
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const step = back[i][j];
    if (i > 0 && j > 0 && step === 0) {
      if (ref[i - 1] !== hyp[j - 1]) out.sub += 1;
      else out.pairs.push([i - 1, j - 1]);
      i -= 1;
      j -= 1;
    } else if (i > 0 && (step === 1 || j === 0)) {
      out.del += 1;
      i -= 1;
    } else {
      out.ins += 1;
      j -= 1;
    }
  }
  out.pairs.reverse();
  return out;
}

const stats = (list) => {
  if (list.length === 0) return null;
  const abs = list.map(Math.abs);
  return {
    n: list.length,
    medianAbsS: percentile(abs, 50),
    p95AbsS: percentile(abs, 95),
    meanSignedS: list.reduce((a, b) => a + b, 0) / list.length,
    within: abs.filter((value) => value <= TIMING_THRESHOLD_S).length / abs.length,
  };
};

/** The provider's words as scoring tokens; each keeps the time (seconds) and speaker of the word it came from. */
export function hypTokens(transcript, lang) {
  const tokens = [];
  for (const word of transcript.words ?? []) {
    for (const w of normalizeText(word.text, lang).split(' ').filter(Boolean)) {
      tokens.push({ w, s: word.start / 1000, e: word.end / 1000, speaker: word.speaker ?? null });
    }
  }
  return tokens;
}

export function refTokens(entry) {
  if (entry.words) {
    return entry.words.flatMap((word) => normalizeText(word.w, entry.lang).split(' ').filter(Boolean).map((w) => ({ w, s: word.s, e: word.e })));
  }
  return normalizeText(entry.reference ?? '', entry.lang).split(' ').filter(Boolean).map((w) => ({ w, s: null, e: null }));
}

/** Runs of returned words → spans (see the note at the top). */
export function hypSpans(tokens, joinS = COVERAGE_JOIN_S, padS = COVERAGE_PAD_S) {
  const spans = [];
  for (const token of [...tokens].sort((a, b) => a.s - b.s)) {
    const last = spans[spans.length - 1];
    if (last && token.s - last.end <= joinS) last.end = Math.max(last.end, token.e);
    else spans.push({ start: token.s, end: token.e });
  }
  return spans.map((span) => ({ start: span.start - padS, end: span.end + padS }));
}

/**
 * @param entry       a resolved manifest entry (reference, words, gaps, lang, expectedSpeakers)
 * @param transcript  the provider's transcript object
 */
export function scoreTranscript(entry, transcript) {
  const lang = entry.lang ?? 'en';
  const hyp = hypTokens(transcript, lang);
  const out = { lang, hypWords: hyp.length, strict: null, cer: null, coverage: null, timing: null, gapWords: null, speakers: null, detectedLanguage: transcript.language_code ?? null };

  // Speakers: how many labels came back, against how many people are in the recording.
  const labels = new Set((transcript.utterances ?? []).map((utterance) => utterance.speaker).filter(Boolean));
  for (const token of hyp) if (token.speaker) labels.add(token.speaker);
  if (labels.size > 0 || entry.expectedSpeakers) {
    out.speakers = {
      found: labels.size,
      expected: entry.expectedSpeakers ?? null,
      matches: entry.expectedSpeakers ? labels.size === entry.expectedSpeakers : null,
    };
  }
  if (entry.reference === null || entry.reference === undefined) return out;

  const ref = refTokens(entry);
  if (lang === 'ja') {
    // Japanese has no spaces between words: character error rate, as the September spike did (metrics.mjs charErrors).
    const refChars = [...normalizeText(entry.reference, lang).replace(/\s+/g, '')];
    const hypChars = [...hyp.map((token) => token.w).join('')];
    const e = errors(refChars, hypChars);
    out.cer = { refChars: refChars.length, hypChars: hypChars.length, errors: e.errors, sub: e.sub, del: e.del, ins: e.ins, rate: refChars.length ? e.errors / refChars.length : null };
    return out;
  }
  const aligned = errors(ref.map((token) => token.w), hyp.map((token) => token.w));
  out.strict = {
    refWords: ref.length,
    hypWords: hyp.length,
    errors: aligned.errors,
    sub: aligned.sub,
    del: aligned.del,
    ins: aligned.ins,
    wer: ref.length ? aligned.errors / ref.length : null,
    deletedShare: ref.length ? aligned.del / ref.length : null,
  };

  const timed = (entry.words ?? []).filter((word) => word.e > word.s);
  if (timed.length > 0) {
    const spans = hypSpans(hyp);
    const share = { speechS: 0, writtenS: 0, missedS: 0, words: timed.length, writtenWords: 0, joinS: COVERAGE_JOIN_S, padS: COVERAGE_PAD_S };
    for (const word of timed) {
      const mid = (word.s + word.e) / 2;
      const length = word.e - word.s;
      share.speechS += length;
      if (spans.some((span) => span.start <= mid && mid < span.end)) {
        share.writtenS += length;
        share.writtenWords += 1;
      } else share.missedS += length;
    }
    share.written = share.speechS > 0 ? share.writtenS / share.speechS : null;
    out.coverage = share;

    const startErr = [];
    const endErr = [];
    for (const [i, j] of aligned.pairs) {
      if (ref[i].s === null || ref[i].s === undefined) continue;
      startErr.push(hyp[j].s - ref[i].s);
      endErr.push(hyp[j].e - ref[i].e);
    }
    if (startErr.length > 0) out.timing = { thresholdS: TIMING_THRESHOLD_S, start: stats(startErr), end: stats(endErr) };
  }
  if (entry.gaps) {
    out.gapWords = hyp.filter((token) => entry.gaps.some((gap) => token.s > gap.start + 0.3 && token.s < gap.end - 0.3)).map((token) => token.w);
  }
  return out;
}

/**
 * The normalised English measure for many (reference, hypothesis) pairs in one
 * call of the Python normaliser. Returns null when the scoring venv is absent.
 */
export function normalisedEnglishWer(pairs, { root = repoRoot } = {}) {
  const asr = join(root, 'web', 'spike', 'asr');
  const python = join(asr, '.venv', process.platform === 'win32' ? join('Scripts', 'python.exe') : join('bin', 'python'));
  if (pairs.length === 0 || !existsSync(python)) return null;
  const queue = pairs.flatMap((pair) => [pair.reference, pair.hypothesis]);
  const result = spawnSync(python, [join(asr, 'normalize_en.py')], { input: JSON.stringify(queue), maxBuffer: 1 << 30, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  if (result.status !== 0) return null;
  const normalised = JSON.parse(result.stdout.toString('utf8'));
  return pairs.map((_, index) => {
    const ref = normalised[index * 2].split(' ').filter(Boolean);
    const hyp = normalised[index * 2 + 1].split(' ').filter(Boolean);
    const e = errors(ref, hyp);
    return { refWords: ref.length, hypWords: hyp.length, errors: e.errors, sub: e.sub, del: e.del, ins: e.ins, wer: ref.length ? e.errors / ref.length : null, deletedShare: ref.length ? e.del / ref.length : null };
  });
}
