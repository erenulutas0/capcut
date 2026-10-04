/**
 * Scores what the APP wrote (scripts/transcript/run-app.mjs) against the
 * measurement clips' references, with the October spike's own measures
 * (ADR-036; the spike: docs/spikes/2026-10-03-asr-on-device-english.md §5):
 *
 * - WER, the STRICT measure the ADR-017 threshold was judged with (lower
 *   case, punctuation → space; number formats not normalised) — the
 *   normaliser and the Levenshtein are the spike's (`spike/asr/metrics.mjs`);
 * - invented text: on a clip whose right answer is empty, any letter or
 *   digit in a line the panel SHOWS; on the clips with pauses, a written
 *   word that starts inside a marked gap;
 * - word timing against the forced-alignment reference: matched words only,
 *   start and end error, median and p95, share within ±250 ms;
 * - speed (wall time / audio length, model start included) and the browser
 *   process tree's peak private memory.
 *
 *   node scripts/transcript/score.mjs [tag …]      # default: every app-*.json
 * Output: transcript-results/summary.json and summary.md
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeText, percentile } from '../../spike/asr/metrics.mjs';

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = join(webDir, 'transcript-results');
const manifest = JSON.parse(readFileSync(join(webDir, 'tests', 'media', 'transcript', 'manifest.json'), 'utf8'));
const clipById = new Map(manifest.clips.map((clip) => [clip.id, clip]));
const speechManifest = existsSync(join(manifest.source, 'manifest-en.json'))
  ? JSON.parse(readFileSync(join(manifest.source, 'manifest-en.json'), 'utf8'))
  : null;
const TIMING_THRESHOLD_S = 0.25;
const MIB = 1048576;

const tags = process.argv.slice(2);
const files = readdirSync(outDir)
  .filter((name) => /^app-.*\.json$/.test(name))
  .filter((name) => tags.length === 0 || tags.includes(name.slice(4, -5)));

/** Levenshtein alignment that also returns which reference word met which written word. */
function align(ref, hyp) {
  const n = ref.length;
  const m = hyp.length;
  const d = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = 0; i <= n; i += 1) d[i][0] = i;
  for (let j = 0; j <= m; j += 1) d[0][j] = j;
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1));
    }
  }
  const pairs = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1)) {
      if (ref[i - 1] === hyp[j - 1]) pairs.push([i - 1, j - 1]);
      i -= 1;
      j -= 1;
    } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      i -= 1;
    } else {
      j -= 1;
    }
  }
  return { errors: d[n][m], pairs: pairs.reverse() };
}

/** The written words as scoring tokens, each keeping the time of the word it came from (seconds). */
function hypTokens(segments) {
  const tokens = [];
  for (const segment of segments ?? []) {
    for (const word of segment.words) {
      for (const token of normalizeText(word.text, 'en').split(' ').filter(Boolean)) {
        tokens.push({ w: token, s: word.startUs / 1e6, e: word.endUs / 1e6 });
      }
    }
  }
  return tokens;
}

/** Reference words: with times where the clip has a forced alignment, else from the text. */
function refTokens(clip) {
  if (clip.words) {
    return clip.words.flatMap((word) => normalizeText(word.w, 'en').split(' ').filter(Boolean).map((w) => ({ w, s: word.s, e: word.e })));
  }
  return normalizeText(clip.reference ?? '', 'en').split(' ').filter(Boolean).map((w) => ({ w, s: null, e: null }));
}

/** The long files are the spike's long clips end to end: their reference is those clips' words, shifted. */
function longReference(clip) {
  if (!clip.parts || !speechManifest) return null;
  const byId = new Map(speechManifest.clips.map((item) => [item.id, item]));
  const tokens = [];
  let offset = 0;
  for (const id of clip.parts) {
    const part = byId.get(id);
    if (!part) return null;
    if (offset >= clip.durationS) break;
    const words = part.words
      ? part.words.map((word) => ({ w: word.w, s: word.s + offset, e: word.e + offset }))
      : normalizeText(typeof part.reference === 'string' ? part.reference : (part.reference?.raw ?? ''), 'en').split(' ').map((w) => ({ w, s: null, e: null }));
    for (const word of words) {
      if (word.s !== null && word.s >= clip.durationS) continue;
      for (const w of normalizeText(word.w, 'en').split(' ').filter(Boolean)) tokens.push({ w, s: word.s, e: word.e });
    }
    offset += part.durationS;
  }
  return tokens;
}

const stats = (errors) => {
  if (errors.length === 0) return null;
  const abs = errors.map(Math.abs);
  const sorted = [...errors].sort((a, b) => a - b);
  return {
    n: errors.length,
    medianAbs: percentile(abs, 50),
    p95Abs: percentile(abs, 95),
    medianSigned: sorted[Math.floor(sorted.length / 2)],
    meanSigned: errors.reduce((a, b) => a + b, 0) / errors.length,
    within: abs.filter((value) => value <= TIMING_THRESHOLD_S).length / abs.length,
  };
};

const summary = { createdAt: new Date().toISOString(), timingThresholdS: TIMING_THRESHOLD_S, runs: [] };

for (const file of files) {
  const run = JSON.parse(readFileSync(join(outDir, file), 'utf8'));
  const rows = [];
  for (const row of run.rows) {
    const clip = clipById.get(row.id);
    if (!clip) continue;
    const out = { id: row.id, set: row.set, durationS: row.durationS, error: row.error ?? null, failed: row.failed ?? null };
    if (!row.error) {
      const shown = (row.lines ?? []).filter((line) => line.kind === 'cue');
      const shownText = shown.map((line) => line.text).join(' ');
      out.lines = shown.length;
      out.unclearLines = (row.lines ?? []).filter((line) => line.kind === 'unclear').length;
      out.spans = row.stats?.spans ?? null;
      out.unclearSpans = row.stats?.unclearSpans ?? null;
      out.speechS = row.stats ? row.stats.speechUs / 1e6 : null;
      out.rtf = row.rtf;
      out.wallS = row.wallMs / 1000;
      out.stats = row.stats ? { loadMs: row.stats.loadMs, listenMs: row.stats.listenMs, writeMs: row.stats.writeMs } : null;
      out.cpuBusy = row.cpuBusy ?? null;
      out.memory = row.memory ? { baselineMiB: Math.round((row.memory.baselineBytes ?? 0) / MIB), peakMiB: Math.round(row.memory.peakBytes / MIB), peakProcessMiB: Math.round(row.memory.peakLargestProcessBytes / MIB) } : null;
      out.csp = (row.csp ?? []).length;
      out.outsideRequests = (row.outsideRequests ?? []).length;
      const hyp = hypTokens(row.segments);
      if (clip.kind === 'negative' || ['neg', 'negh', 'negv'].includes(clip.set)) {
        // Judged on what the user is shown, and on the raw words too: both must be empty.
        out.invented = /[\p{L}\p{N}]/u.test(shownText) || hyp.length > 0;
        out.shownText = shownText;
      } else {
        const ref = clip.parts ? longReference(clip) : refTokens(clip);
        if (ref && ref.length > 0) {
          const aligned = align(ref.map((token) => token.w), hyp.map((token) => token.w));
          out.refWords = ref.length;
          out.hypWords = hyp.length;
          out.errors = aligned.errors;
          out.wer = aligned.errors / ref.length;
          const startErr = [];
          const endErr = [];
          for (const [i, j] of aligned.pairs) {
            if (ref[i].s === null) continue;
            startErr.push(hyp[j].s - ref[i].s);
            endErr.push(hyp[j].e - ref[i].e);
          }
          if (startErr.length > 0) out.timing = { start: stats(startErr), end: stats(endErr), startErr, endErr };
        }
        if (clip.gaps) {
          // A written word that starts inside a marked gap (0.3 s in from each edge) was not said there.
          out.gapWords = hyp.filter((token) => clip.gaps.some((gap) => token.s > gap.start + 0.3 && token.s < gap.end - 0.3)).map((token) => token.w);
        }
        // Lines per minute and the longest line, for the line limit.
        out.linesPerMinute = shown.length / (row.durationS / 60);
      }
    }
    rows.push(out);
  }
  summary.runs.push({ tag: run.tag, browser: run.browser, browserVersion: run.browserVersion, model: run.model, machine: run.machine, modelDownload: run.modelDownload ?? null, rows });
}

const pool = (rows, which) => stats(rows.flatMap((row) => row.timing?.[`${which}Err`] ?? []));
const pct = (value, digits = 1) => (value === null || value === undefined ? '—' : `${(value * 100).toFixed(digits)}%`);
const ms = (value) => (value === null || value === undefined ? '—' : `${Math.round(value * 1000)} ms`);
const lines = ['# Yazıya dök — uygulama yolu ölçümleri', '', `Üretildi: ${summary.createdAt} · \`node scripts/transcript/score.mjs\``, ''];
for (const run of summary.runs) {
  lines.push(`## ${run.tag} — ${run.browser} ${run.browserVersion ?? ''}, model ${run.model}`, '');
  const negatives = run.rows.filter((row) => 'invented' in row);
  if (negatives.length) {
    lines.push(`Negatif klipler: **${negatives.filter((row) => row.invented).length} / ${negatives.length} uydurma** (anlaşılamadı satırı: ${negatives.reduce((sum, row) => sum + (row.unclearLines ?? 0), 0)}).`, '');
  }
  const speech = run.rows.filter((row) => row.wer !== undefined);
  if (speech.length) {
    lines.push('| Klip | Süre | WER (katı) | Kelime (ref/yazılan) | Anlaşılamayan aralık | Boşluğa yazılan | Başlangıç ort./p95/±250 | Bitiş ort./p95/±250 | RTF | Bellek tepe |', '|---|---|---|---|---|---|---|---|---|---|');
    for (const row of speech) {
      const t = row.timing;
      lines.push(
        `| ${row.id} | ${row.durationS.toFixed(0)} s | ${pct(row.wer)} | ${row.refWords}/${row.hypWords} | ${row.unclearSpans}/${row.spans} | ${row.gapWords ? row.gapWords.length : '—'} | ${t ? `${ms(t.start.medianAbs)} / ${ms(t.start.p95Abs)} / ${pct(t.start.within, 0)}` : '—'} | ${t ? `${ms(t.end.medianAbs)} / ${ms(t.end.p95Abs)} / ${pct(t.end.within, 0)}` : '—'} | ${row.rtf.toFixed(3)} | ${row.memory ? `${row.memory.peakMiB} MiB` : '—'} |`,
      );
    }
    // Pooled per set: total errors over total reference words.
    const sets = [...new Set(speech.map((row) => row.set))];
    lines.push(
      '',
      `Kümelere göre WER (toplam hata / toplam referans kelime): ${sets
        .map((set) => {
          const rows = speech.filter((row) => row.set === set);
          const errors = rows.reduce((sum, row) => sum + row.errors, 0);
          const words = rows.reduce((sum, row) => sum + row.refWords, 0);
          const dropped = rows.reduce((sum, row) => sum + (row.unclearSpans ?? 0), 0);
          const spans = rows.reduce((sum, row) => sum + (row.spans ?? 0), 0);
          return `${set} ${pct(errors / words)} (${errors}/${words}; anlaşılamayan ${dropped}/${spans} aralık)`;
        })
        .join(' · ')}.`,
    );
    const timed = speech.filter((row) => row.timing);
    if (timed.length) {
      const start = pool(timed, 'start');
      const end = pool(timed, 'end');
      lines.push('', `Zaman, bütün eşleşen kelimeler (n = ${start.n}): başlangıç ortanca ${ms(start.medianAbs)}, p95 ${ms(start.p95Abs)}, işaretli ortanca ${ms(start.medianSigned)}, ±250 ms içinde ${pct(start.within, 0)}; bitiş ortanca ${ms(end.medianAbs)}, p95 ${ms(end.p95Abs)}, işaretli ortanca ${ms(end.medianSigned)}, ±250 ms içinde ${pct(end.within, 0)}.`);
    }
    lines.push('');
  }
  const failed = run.rows.filter((row) => row.error || (row.failed && row.failed !== 'nothing_heard'));
  if (failed.length) lines.push(`Başarısız: ${failed.map((row) => `${row.id} (${row.error ?? row.failed})`).join('; ')}`, '');
  const leaks = run.rows.filter((row) => row.csp || row.outsideRequests);
  lines.push(`CSP ihlali olan klip: ${leaks.filter((row) => row.csp).length}; site dışına istek yapan klip: ${leaks.filter((row) => row.outsideRequests).length}.`, '');
}
// The raw error lists are large; the summary keeps the statistics.
for (const run of summary.runs) for (const row of run.rows) if (row.timing) { delete row.timing.startErr; delete row.timing.endErr; }
writeFileSync(join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 1)}\n`);
writeFileSync(join(outDir, 'summary.md'), `${lines.join('\n')}\n`);
console.log(lines.join('\n'));
