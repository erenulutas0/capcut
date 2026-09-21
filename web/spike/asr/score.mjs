/**
 * Scoring shared by the driver (console + JSON) and the summariser, which
 * re-scores every stored hypothesis so a metric fix never needs a re-run.
 */
import { charErrors, timingProxies, wordErrors } from './metrics.mjs';

export function scoreClip(clip, result) {
  const lang = clip.lang;
  const hyp = result.text ?? '';
  const row = { id: clip.id, lang, kind: clip.kind, audioS: result.audioS, ms: Math.round(result.ms), rtf: Number(result.rtf.toFixed(3)), hyp, ref: clip.reference.raw };
  if (clip.kind === 'negative') {
    const visible = hyp.replace(/[\s.,!?…\-–—"'“”]/g, '');
    row.hallucinated = visible.length > 0;
    row.visibleChars = visible.length;
  } else {
    // Same normaliser on both sides, starting from the raw (punctuated, cased) reference.
    const w = wordErrors(clip.reference.raw, hyp, lang);
    const c = charErrors(clip.reference.raw, hyp, lang);
    row.refWords = w.refWords;
    row.hypWords = w.hypWords;
    row.wordErrors = w.errors;
    row.wer = w.refWords ? Number((w.errors / w.refWords).toFixed(4)) : null;
    row.ops = w.ops;
    row.alignment = w.alignment;
    row.refChars = c.refChars;
    row.charErrors = c.errors;
    row.cer = c.refChars ? Number((c.errors / c.refChars).toFixed(4)) : null;
  }
  row.chunks = result.chunks;
  row.timing = timingProxies(result.chunks, clip);
  return row;
}

/** Re-scores a stored row (hyp + chunks + timings) against the current manifest clip. */
export function rescoreRow(row, clip) {
  if (row.error) return row;
  return scoreClip(clip, { text: row.hyp, chunks: row.chunks ?? [], ms: row.ms, audioS: row.audioS, rtf: row.rtf });
}

export function aggregate(rows) {
  const groups = {};
  const add = (name, r) => {
    const g = (groups[name] ??= { clips: 0, refWords: 0, wordErrors: 0, cappedErrors: 0, loops: 0, refChars: 0, charErrors: 0, audioS: 0, ms: 0, rtfs: [] });
    g.clips += 1;
    g.audioS += r.audioS;
    g.ms += r.ms;
    g.rtfs.push(r.rtf);
    if (r.wer !== undefined && r.wer !== null) {
      g.refWords += r.refWords;
      g.wordErrors += r.wordErrors;
      // A runaway repetition loop counts as 100% for its clip, so one clip cannot hide the rest.
      g.cappedErrors += Math.min(r.wordErrors, r.refWords);
      if (r.wordErrors > r.refWords) g.loops += 1;
      g.refChars += r.refChars;
      g.charErrors += r.charErrors;
    }
  };
  for (const r of rows) {
    if (r.error) continue;
    add(`${r.kind}-${r.lang}`, r);
    add(r.kind, r);
    add('all', r);
  }
  const out = {};
  for (const [name, g] of Object.entries(groups)) {
    out[name] = {
      clips: g.clips,
      wer: g.refWords ? Number((g.wordErrors / g.refWords).toFixed(4)) : null,
      werCapped: g.refWords ? Number((g.cappedErrors / g.refWords).toFixed(4)) : null,
      loops: g.loops,
      cer: g.refChars ? Number((g.charErrors / g.refChars).toFixed(4)) : null,
      rtf: Number((g.ms / 1000 / g.audioS).toFixed(3)),
      rtfMax: Number(Math.max(...g.rtfs).toFixed(3)),
      audioS: Number(g.audioS.toFixed(1)),
    };
  }
  const negatives = rows.filter((r) => r.kind === 'negative' && !r.error);
  out.negatives = { clips: negatives.length, hallucinated: negatives.filter((r) => r.hallucinated).length };
  const timed = rows.filter((r) => r.kind === 'clean' && r.timing?.measured);
  const onset = timed.map((r) => r.timing.onsetDevS).filter((v) => v !== null);
  const offset = timed.map((r) => r.timing.offsetDevS).filter((v) => v !== null);
  const pauses = timed.flatMap((r) => r.timing.pauseDevS);
  const pct = (vals, p) => {
    if (!vals.length) return null;
    const s = [...vals].sort((a, b) => a - b);
    return Number(s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)].toFixed(3));
  };
  out.timingProxy = {
    clipsWithWordTimes: timed.length,
    monotonic: timed.filter((r) => r.timing.monotonic).length,
    inRange: timed.filter((r) => r.timing.inRange).length,
    onset: { n: onset.length, p50: pct(onset, 50), p95: pct(onset, 95) },
    offset: { n: offset.length, p50: pct(offset, 50), p95: pct(offset, 95) },
    pause: { n: pauses.length, p50: pct(pauses, 50), p95: pct(pauses, 95) },
  };
  return out;
}
