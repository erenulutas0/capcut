/**
 * Scores what the APP wrote on the realistic set (ADR-036, 7 Oct 2026):
 * `run-app.mjs` / `run-parts.mjs` results, one table per tag.
 *
 * For every speech clip:
 *  - WER, two measures side by side: STRICT (the measure ADR-017's threshold
 *    was judged with: lower case, punctuation → space, numbers as written)
 *    and NORMALISED (the usual one for conversational English: OpenAI's
 *    `EnglishTextNormalizer` on both sides — fillers such as "um", "uh",
 *    "mm-hmm" removed, numbers to digits, contractions expanded). The
 *    conversational references are full of fillers no recogniser writes, so
 *    the strict number is far above what a reader would call the error rate;
 *    both are printed, neither is hidden.
 *  - where the reference has word times (AMI, the synthetic clips): the
 *    share of the reference SPEECH TIME (the words' own durations) that
 *      was written        — inside a span whose text is shown,
 *      was dropped        — inside a span shown as "(anlaşılamadı)",
 *      was never heard    — outside every span the speech detector made.
 *  - words written inside marked non-speech gaps (music next to speech).
 * For every negative clip: invented text — any letter or digit in a line the
 * panel shows, or any raw word — which must be zero.
 *
 *   node scripts/transcript/score-real.mjs <tag> [<tag> …]
 * Output: transcript-results/real-<tag>.json, and a table on the console.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeText } from '../../spike/asr/metrics.mjs';

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = join(webDir, 'transcript-results');
const manifest = JSON.parse(readFileSync(join(webDir, 'tests', 'media', 'transcript', 'manifest.json'), 'utf8'));
const clipById = new Map(manifest.clips.map((clip) => [clip.id, clip]));
const tags = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (tags.length === 0) {
  console.error('usage: score-real.mjs <tag> [<tag> …]');
  process.exit(2);
}

/** Every part file of a tag, rows merged (a clip measured twice: the later file wins). */
function rowsOf(tag) {
  const files = readdirSync(outDir).filter((name) => name === `app-${tag}.json` || (name.startsWith(`app-${tag}.part`) && name.endsWith('.json')));
  const rows = new Map();
  let meta = null;
  for (const file of files.sort()) {
    const run = JSON.parse(readFileSync(join(outDir, file), 'utf8'));
    meta ??= { browser: run.browser, browserVersion: run.browserVersion, model: run.model, probe: run.probe ?? null };
    for (const row of run.rows) if (!row.error) rows.set(row.id, row);
    for (const row of run.rows) if (row.error && !rows.has(row.id)) rows.set(row.id, row);
  }
  return { meta, rows: [...rows.values()] };
}

/** Word errors by Levenshtein, with the split into substitutions, deletions and insertions. */
function errors(ref, hyp) {
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
  const out = { errors: previous[m], sub: 0, del: 0, ins: 0 };
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const step = back[i][j];
    if (i > 0 && j > 0 && step === 0) {
      if (ref[i - 1] !== hyp[j - 1]) out.sub += 1;
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
  return out;
}

// ---- the normalised measure: one call of the Python normaliser for everything
const queue = [];
const queued = (text) => queue.push(text) - 1;
function normaliseAll() {
  const python = join(webDir, 'spike', 'asr', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  if (!existsSync(python)) throw new Error('no scoring venv: cd spike/asr && python -m venv .venv && .venv/Scripts/pip install whisper-normalizer==0.1.15');
  const r = spawnSync(python, [join(webDir, 'spike', 'asr', 'normalize_en.py')], { input: JSON.stringify(queue), maxBuffer: 1 << 30, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  if (r.status !== 0) throw new Error(`normaliser failed: ${r.stderr}`);
  return JSON.parse(r.stdout.toString('utf8'));
}

const tokens = (text) => normalizeText(text, 'en').split(' ').filter(Boolean);

const results = [];
for (const tag of tags) {
  const { meta, rows } = rowsOf(tag);
  const scored = [];
  for (const row of rows) {
    const clip = clipById.get(row.id);
    if (!clip) continue;
    const out = { id: row.id, set: row.set, durationS: row.durationS, error: row.error ?? null, failed: row.failed ?? null, parallel: row.parallel === true };
    if (!row.error) {
      const segments = row.segments ?? [];
      const hypText = segments.flatMap((segment) => segment.words.map((word) => word.text)).join(' ');
      const shownText = (row.lines ?? []).filter((line) => line.kind === 'cue').map((line) => line.text).join(' ');
      out.spans = row.stats?.spans ?? 0;
      out.unclearSpans = row.stats?.unclearSpans ?? 0;
      out.detectedS = (row.stats?.speechUs ?? 0) / 1e6;
      out.unclearS = segments.filter((segment) => segment.state === 'unclear').reduce((sum, segment) => sum + (segment.endUs - segment.startUs) / 1e6, 0);
      out.secondLooks = row.stats?.secondLooks ?? 0;
      out.rescuedS = (row.stats?.rescuedUs ?? 0) / 1e6;
      out.wallS = row.wallMs / 1000;
      if (clip.kind === 'negative') {
        out.negative = true;
        out.invented = /[\p{L}\p{N}]/u.test(shownText) || /[\p{L}\p{N}]/u.test(hypText);
        out.shownText = shownText || hypText;
      } else {
        out.refQ = queued(clip.reference ?? '');
        out.hypQ = queued(hypText);
        const ref = tokens(clip.reference ?? '');
        const hyp = tokens(hypText);
        out.strict = { refWords: ref.length, hypWords: hyp.length, ...errors(ref, hyp) };
        const timed = (clip.words ?? []).filter((word) => word.e > word.s);
        if (timed.length > 0) {
          // Where does each reference word's own time fall?
          const share = { speechS: 0, writtenS: 0, droppedS: 0, missedS: 0, words: timed.length, writtenWords: 0, droppedWords: 0, missedWords: 0 };
          const ordered = [...segments].sort((a, b) => a.startUs - b.startUs);
          for (const word of timed) {
            const mid = ((word.s + word.e) / 2) * 1e6;
            const length = word.e - word.s;
            const segment = ordered.find((item) => item.startUs <= mid && mid < item.endUs);
            share.speechS += length;
            if (!segment) {
              share.missedS += length;
              share.missedWords += 1;
            } else if (segment.state === 'unclear') {
              share.droppedS += length;
              share.droppedWords += 1;
            } else {
              share.writtenS += length;
              share.writtenWords += 1;
            }
          }
          out.share = share;
        }
        if (clip.gaps) {
          const written = segments.flatMap((segment) => segment.words);
          out.gapWords = written.filter((word) => clip.gaps.some((gap) => word.startUs / 1e6 > gap.start + 0.3 && word.startUs / 1e6 < gap.end - 0.3)).map((word) => word.text);
        }
      }
    }
    scored.push(out);
  }
  results.push({ tag, meta, rows: scored });
}

const normalised = normaliseAll();
const pct = (value) => (value === null || value === undefined || Number.isNaN(value) ? '—' : `${(value * 100).toFixed(1)}%`);
for (const result of results) {
  for (const row of result.rows) {
    if (row.refQ === undefined) continue;
    const ref = normalised[row.refQ].split(' ').filter(Boolean);
    const hyp = normalised[row.hypQ].split(' ').filter(Boolean);
    row.normalised = { refWords: ref.length, hypWords: hyp.length, ...errors(ref, hyp) };
    delete row.refQ;
    delete row.hypQ;
  }
  const lines = [`## ${result.tag} — ${result.meta?.browser ?? ''} ${result.meta?.browserVersion ?? ''}, model ${result.meta?.model ?? ''}${result.meta?.probe?.base ? `, settings ${result.meta.probe.base}` : ''}`, ''];
  const speech = result.rows.filter((row) => row.normalised);
  lines.push('| clip | set | WER normalised | WER strict | deleted (norm.) | speech written | dropped by guard | missed by detector | spans dropped | 2nd looks → rescued | gap words |', '|---|---|---|---|---|---|---|---|---|---|---|');
  const line = (name, set, rows) => {
    const sum = (pick) => rows.reduce((total, row) => total + (pick(row) ?? 0), 0);
    const withShare = rows.filter((row) => row.share);
    const speechS = withShare.reduce((total, row) => total + row.share.speechS, 0);
    const gapRows = rows.filter((row) => row.gapWords);
    return `| ${name} | ${set} | ${pct(sum((r) => r.normalised.errors) / sum((r) => r.normalised.refWords))} (${sum((r) => r.normalised.errors)}/${sum((r) => r.normalised.refWords)}) | ${pct(sum((r) => r.strict.errors) / sum((r) => r.strict.refWords))} | ${pct(sum((r) => r.normalised.del) / sum((r) => r.normalised.refWords))} | ${withShare.length ? pct(withShare.reduce((t, r) => t + r.share.writtenS, 0) / speechS) : '—'} | ${withShare.length ? pct(withShare.reduce((t, r) => t + r.share.droppedS, 0) / speechS) : '—'} | ${withShare.length ? pct(withShare.reduce((t, r) => t + r.share.missedS, 0) / speechS) : '—'} | ${sum((r) => r.unclearSpans)}/${sum((r) => r.spans)} (${sum((r) => r.unclearS).toFixed(0)} s of ${sum((r) => r.detectedS).toFixed(0)} s) | ${sum((r) => r.secondLooks)} → ${sum((r) => r.rescuedS).toFixed(0)} s | ${gapRows.length ? gapRows.reduce((t, r) => t + r.gapWords.length, 0) : '—'} |`;
  };
  for (const row of speech) lines.push(line(row.id, row.set, [row]));
  for (const set of [...new Set(speech.map((row) => row.set))]) {
    const rows = speech.filter((row) => row.set === set);
    if (rows.length > 1) lines.push(line(`**all of ${set}**`, set, rows));
  }
  const negatives = result.rows.filter((row) => row.negative);
  if (negatives.length) {
    lines.push('');
    for (const set of [...new Set(negatives.map((row) => row.set))]) {
      const rows = negatives.filter((row) => row.set === set);
      lines.push(`Negatives ${set}: **${rows.filter((row) => row.invented).length} / ${rows.length} with invented text**; "(anlaşılamadı)" spans ${rows.reduce((t, r) => t + r.unclearSpans, 0)} in ${rows.filter((r) => r.unclearSpans > 0).length} clips${rows.some((row) => row.invented) ? ` — ${rows.filter((row) => row.invented).map((row) => `${row.id}: "${row.shownText.slice(0, 80)}"`).join('; ')}` : ''}.`);
    }
  }
  const gapped = result.rows.filter((row) => row.gapWords && row.gapWords.length > 0);
  if (gapped.length) lines.push('', `Words written inside marked gaps: ${gapped.map((row) => `${row.id}: ${row.gapWords.join(' ')}`).join('; ')}`);
  const broken = result.rows.filter((row) => row.error || (row.failed && row.failed !== 'nothing_heard'));
  if (broken.length) lines.push('', `FAILED: ${broken.map((row) => `${row.id} (${row.error ?? row.failed})`).join('; ')}`);
  lines.push('');
  result.table = lines.join('\n');
  console.log(result.table);
  writeFileSync(join(outDir, `real-${result.tag}.json`), `${JSON.stringify(result, null, 1)}\n`);
}
