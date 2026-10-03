/**
 * Turns the raw run-en.mjs result files into the tables of
 * docs/spikes/2026-10-03-asr-on-device-english.md. Nothing here is estimated:
 * every figure is recomputed from the stored hypotheses, word times, speech
 * spans and window figures. Runs that did not finish are listed and left out.
 *
 *   node summarize-en.mjs [--tag=2026-10-03]
 *
 * Writes web/spike-results/asr-<tag>-summary.json and prints markdown.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

import { normalizeText, wordErrors, charErrors, percentile } from './metrics.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = dirname(dirname(here));
const speechDir = join(webRoot, 'tests', 'media', 'speech');
const outDir = join(webRoot, 'spike-results');
const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const found = args.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};
const tag = argValue('tag', '2026-10-03');

/** Subtitle practice: a cue that starts or ends within about a quarter second of the word is comfortable. ADR-017's threshold. */
const TIMING_THRESHOLD_S = 0.25;
/** A word counts as "at a seam" when its middle is this close to one. */
const SEAM_NEAR_S = 1.0;

// ---------------------------------------------------------------- clips
const clipById = new Map();
{
  const en = JSON.parse(readFileSync(join(speechDir, 'manifest-en.json'), 'utf8'));
  for (const c of en.clips) clipById.set(c.id, c);
  const september = JSON.parse(readFileSync(join(speechDir, 'manifest.json'), 'utf8'));
  for (const c of september.clips) if (c.kind !== 'negative') clipById.set(c.id, { ...c, set: c.lang === 'en' ? 'short' : 'tr', kind: 'speech', words: null });
}

// ---------------------------------------------------------------- helpers
const pct = (v, d = 1) => (v === null || v === undefined || Number.isNaN(v) ? '—' : `${(v * 100).toFixed(d)}%`);
const msf = (v) => (v === null || v === undefined ? '—' : `${Math.round(v * 1000)} ms`);
const num = (v, d = 2) => (v === null || v === undefined || Number.isNaN(v) ? '—' : v.toFixed(d));
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const median = (xs) => percentile(xs, 50);

/** Edit distance only (two rows): long files need no backtrace for the plain WER. */
function distance(ref, hyp) {
  let prev = new Uint32Array(hyp.length + 1);
  let cur = new Uint32Array(hyp.length + 1);
  for (let j = 0; j <= hyp.length; j += 1) prev[j] = j;
  for (let i = 1; i <= ref.length; i += 1) {
    cur[0] = i;
    for (let j = 1; j <= hyp.length; j += 1) {
      const cost = ref[i - 1] === hyp[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[hyp.length];
}

/** Alignment with the index of both sides, in reading order. */
function align(ref, hyp) {
  const n = ref.length;
  const m = hyp.length;
  const d = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = 0; i <= n; i += 1) d[i][0] = i;
  for (let j = 0; j <= m; j += 1) d[0][j] = j;
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const cost = ref[i - 1] === hyp[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    }
  }
  const ops = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1)) {
      ops.push({ op: ref[i - 1] === hyp[j - 1] ? 'hit' : 'sub', ri: i - 1, hi: j - 1 });
      i -= 1;
      j -= 1;
    } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      ops.push({ op: 'del', ri: i - 1, hi: null });
      i -= 1;
    } else {
      ops.push({ op: 'ins', ri: null, hi: j - 1 });
      j -= 1;
    }
  }
  return ops.reverse();
}

/** Hypothesis chunks → one entry per word; a multi-word chunk (segment times) gives its start to the first word and its end to the last. */
function hypWords(chunks) {
  const out = [];
  for (const c of chunks ?? []) {
    const tokens = normalizeText(c.text, 'en').split(' ').filter(Boolean);
    tokens.forEach((w, k) => {
      const single = tokens.length === 1;
      out.push({
        w,
        s: c.start !== null && (single || k === 0) ? c.start : null,
        e: c.end !== null && (single || k === tokens.length - 1) ? c.end : null,
        mid: c.start !== null && c.end !== null ? c.start + ((c.end - c.start) * (k + 0.5)) / tokens.length : null,
        segment: !single,
      });
    });
  }
  return out;
}

function stats(errors) {
  if (errors.length === 0) return null;
  const abs = errors.map(Math.abs);
  return {
    n: errors.length,
    medianAbs: median(abs),
    p95Abs: percentile(abs, 95),
    meanSigned: sum(errors) / errors.length,
    within: abs.filter((v) => v <= TIMING_THRESHOLD_S).length / abs.length,
  };
}

// ---------------------------------------------------------------- normalised WER (python, one call)
const normaliseQueue = [];
function queueNormalise(text) {
  normaliseQueue.push(text ?? '');
  return normaliseQueue.length - 1;
}
function runNormalise() {
  const python = join(here, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  if (!existsSync(python)) throw new Error('no .venv: python -m venv .venv && .venv/Scripts/pip install whisper-normalizer');
  const r = spawnSync(python, [join(here, 'normalize_en.py')], { input: JSON.stringify(normaliseQueue), maxBuffer: 1 << 30, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  if (r.status !== 0) throw new Error(r.stderr.toString());
  return JSON.parse(r.stdout.toString('utf8'));
}

// ---------------------------------------------------------------- per-result analysis
const files = readdirSync(outDir).filter((f) => f.startsWith(`asr-${tag}-`) && f.endsWith('.json') && !f.includes('summary') && !f.includes('load-failed') && !f.includes('vad-dump') && !f.includes('phone'));
const results = [];
const incomplete = [];
for (const f of files) {
  const r = JSON.parse(readFileSync(join(outDir, f), 'utf8'));
  if (!r.complete) {
    incomplete.push(f);
    continue;
  }
  results.push({ file: f, ...r });
}

const pending = [];
/** Raw signed word-time errors per row, so sets of clips are pooled from the errors themselves. */
const rawTiming = new Map();
for (const r of results) {
  r.rows = [];
  for (const row of r.clips) {
    const clip = clipById.get(row.id);
    if (!clip) continue;
    if (row.error) {
      r.rows.push({ id: row.id, set: row.set, error: row.error });
      continue;
    }
    const out = { id: row.id, set: clip.set, kind: clip.kind, lang: clip.lang, audioS: row.audioS, ms: row.ms, rtf: row.rtf, vadMs: row.vadMs, hyp: row.hyp };
    // What the pre-filter let through.
    if (row.spans) {
      out.passedS = sum(row.spans.map((s) => s.end - s.start));
      if (clip.words) {
        const lost = clip.words.filter((w) => w.w && !row.spans.some((s) => (w.s + w.e) / 2 >= s.start && (w.s + w.e) / 2 <= s.end));
        out.refWordsTimed = clip.words.filter((w) => w.w).length;
        out.wordsOutsideSpans = lost.length;
        out.wordsOutsideSpansList = lost.slice(0, 12).map((w) => `${w.w}@${w.s.toFixed(2)}`);
      }
      if (clip.gaps) {
        out.gapS = sum(clip.gaps.map((g) => g.end - g.start));
        out.gapPassedS = sum(clip.gaps.map((g) => sum(row.spans.map((s) => Math.max(0, Math.min(s.end, g.end) - Math.max(s.start, g.start))))));
      }
    }
    // Whisper's own guards, per window.
    out.windows = (row.windows ?? []).map((w) => {
      const text = w.text ?? '';
      const bytes = Buffer.from(text, 'utf8');
      return {
        start: w.pieces[0].start,
        end: w.pieces[w.pieces.length - 1].end,
        pieces: w.pieces,
        text,
        words: normalizeText(text, clip.lang).split(' ').filter(Boolean).length,
        noSpeechProb: w.noSpeechProb,
        avgLogprob: w.avgLogprob,
        compressionRatio: bytes.length ? bytes.length / deflateSync(bytes).length : null,
        dropped: Boolean(w.dropped),
        droppedText: w.droppedText ?? null,
        droppedWords: w.dropped ? normalizeText(w.droppedText ?? '', clip.lang).split(' ').filter(Boolean).length : 0,
      };
    });
    if (clip.kind === 'negative') {
      const visible = (row.hyp ?? '').replace(/[\s.,!?…\-–—"'“”]/g, '');
      out.invented = visible.length > 0;
      out.inventedText = (row.hyp ?? '').trim();
      out.punctuationOnly = !out.invented && (row.hyp ?? '').trim().length > 0;
    } else {
      const w = wordErrors(clip.reference.raw, row.hyp, clip.lang);
      const c = charErrors(clip.reference.raw, row.hyp, clip.lang);
      out.refWords = w.refWords;
      out.strictErrors = w.errors;
      out.strictOps = w.ops;
      out.refChars = c.refChars;
      out.charErrors = c.errors;
      if (clip.lang === 'en') pending.push({ out, ref: queueNormalise(clip.reference.raw), hyp: queueNormalise(row.hyp) });

      const hw = hypWords(row.chunks);
      // Words written inside a region that holds no speech.
      if (clip.words) {
        const refTokens = clip.words.map((x) => x.w ?? '\u0000unk');
        const ops = align(refTokens, hw.map((h) => h.w));
        const startErr = [];
        const endErr = [];
        const thirds = [[], [], []];
        const refError = new Uint8Array(refTokens.length);
        const insAt = [];
        for (const o of ops) {
          if (o.op === 'hit') {
            const ref = clip.words[o.ri];
            const h = hw[o.hi];
            if (h.s !== null) {
              startErr.push(h.s - ref.s);
              thirds[Math.min(2, Math.floor((ref.s / row.audioS) * 3))].push(h.s - ref.s);
            }
            if (h.e !== null) endErr.push(h.e - ref.e);
          } else if (o.op === 'ins') {
            if (hw[o.hi].mid !== null) insAt.push(hw[o.hi].mid);
          } else if (clip.words[o.ri].w) refError[o.ri] = 1;
        }
        // Words written inside a region that holds no speech: words the reference does not have
        // (insertions or substitutions) whose time falls in a gap. A real word that merely drifts
        // over a gap's edge is a timing error, counted in the timing table, not an invention.
        if (clip.gaps) {
          const extra = ops.filter((o) => o.op === 'ins' || o.op === 'sub').map((o) => hw[o.hi]).filter((h) => h.mid !== null && clip.gaps.some((g) => h.mid > g.start && h.mid < g.end));
          out.wordsInGaps = extra.length;
          out.wordsInGapsText = extra.map((h) => h.w).join(' ');
        }
        rawTiming.set(out, { start: startErr, end: endErr });
        out.timing = { wordLevel: !hw.some((h) => h.segment), start: stats(startErr), end: stats(endErr), drift: thirds.map((t) => (t.length ? { n: t.length, medianSigned: median(t), medianAbs: median(t.map(Math.abs)) } : null)) };
        // Seams.
        const seams = { cut: [], pause: [], joint: [] };
        if (row.longForm) {
          for (let t = 25; t < row.audioS - 5; t += 20) seams.cut.push(t);
        } else {
          (row.windows ?? []).forEach((w, k, all) => {
            for (let p = 1; p < w.pieces.length; p += 1) (Math.abs(w.pieces[p].start - w.pieces[p - 1].end) < 0.01 ? seams.cut : seams.joint).push((w.pieces[p].start + w.pieces[p - 1].end) / 2);
            if (k > 0) {
              const prevEnd = all[k - 1].pieces.at(-1).end;
              (Math.abs(w.pieces[0].start - prevEnd) < 0.01 ? seams.cut : seams.pause).push((w.pieces[0].start + prevEnd) / 2);
            }
          });
        }
        const near = (t, list) => list.some((s) => Math.abs(t - s) <= SEAM_NEAR_S);
        const tally = { cut: [0, 0], pause: [0, 0], joint: [0, 0], away: [0, 0] };
        clip.words.forEach((w, i) => {
          if (!w.w) return;
          const mid = (w.s + w.e) / 2;
          const where = near(mid, seams.cut) ? 'cut' : near(mid, seams.pause) ? 'pause' : near(mid, seams.joint) ? 'joint' : 'away';
          tally[where][0] += 1;
          tally[where][1] += refError[i];
        });
        for (const t of insAt) tally[near(t, seams.cut) ? 'cut' : near(t, seams.pause) ? 'pause' : near(t, seams.joint) ? 'joint' : 'away'][1] += 1;
        out.seams = { counts: { cut: seams.cut.length, pause: seams.pause.length, joint: seams.joint.length }, tally };
      }
      // Punctuation and casing against a punctuated, cased reference (FLEURS).
      if (clip.set === 'short' || clip.id === 'long-fleurs') {
        const count = (s, re) => (s.match(re) ?? []).length;
        const refRaw = clip.reference.raw;
        const caseTokens = (s) => s.replace(/[^\p{L}\p{N}\s']/gu, ' ').split(/\s+/).filter(Boolean);
        const rt = caseTokens(refRaw);
        const ht = caseTokens(row.hyp);
        const ops = align(rt.map((x) => x.toLowerCase()), ht.map((x) => x.toLowerCase()));
        let hits = 0;
        let sameCase = 0;
        let refCapital = 0;
        let capitalKept = 0;
        for (const o of ops) {
          if (o.op !== 'hit') continue;
          hits += 1;
          if (rt[o.ri] === ht[o.hi]) sameCase += 1;
          if (/^\p{Lu}/u.test(rt[o.ri])) {
            refCapital += 1;
            if (/^\p{Lu}/u.test(ht[o.hi])) capitalKept += 1;
          }
        }
        out.punct = {
          refSentenceEnds: count(refRaw, /[.?!](\s|$)/g),
          hypSentenceEnds: count(row.hyp, /[.?!](\s|$)/g),
          refCommas: count(refRaw, /,/g),
          hypCommas: count(row.hyp, /,/g),
          hits,
          sameCase,
          refCapital,
          capitalKept,
          refNumberTokens: count(refRaw, /\b\d[\d.,:]*\b/g),
          hypNumberTokens: count(row.hyp, /\b\d[\d.,:]*\b/g),
        };
      }
    }
    r.rows.push(out);
  }
}
const normalised = pending.length ? runNormalise() : [];
for (const p of pending) {
  const ref = normalised[p.ref].split(' ').filter(Boolean);
  const hyp = normalised[p.hyp].split(' ').filter(Boolean);
  p.out.normRefWords = ref.length;
  p.out.normErrors = distance(ref, hyp);
}

// ---------------------------------------------------------------- aggregation
const key = (r) => `${r.model}/${r.device}${r.threads ? `/t${r.threads}` : ''}/${r.browser}/${r.pre}${r.suffix ?? ''}`;
function group(r, pred) {
  const rows = r.rows.filter((x) => !x.error && pred(x));
  if (rows.length === 0) return null;
  const speech = rows.filter((x) => x.kind === 'speech');
  const g = {
    clips: rows.length,
    audioS: sum(rows.map((x) => x.audioS)),
    rtf: sum(rows.map((x) => x.ms)) / 1000 / sum(rows.map((x) => x.audioS)),
    vadShare: sum(rows.map((x) => x.vadMs ?? 0)) / Math.max(1, sum(rows.map((x) => x.ms))),
  };
  if (speech.length) {
    g.strictWer = sum(speech.map((x) => x.strictErrors)) / sum(speech.map((x) => x.refWords));
    g.cer = sum(speech.map((x) => x.charErrors)) / sum(speech.map((x) => x.refChars));
    const en = speech.filter((x) => x.normRefWords !== undefined);
    if (en.length) g.normWer = sum(en.map((x) => x.normErrors)) / sum(en.map((x) => x.normRefWords));
    g.refWords = sum(speech.map((x) => x.refWords));
  }
  return g;
}

const summary = { tag, timingThresholdS: TIMING_THRESHOLD_S, incomplete, results: results.map((r) => ({ file: r.file, key: key(r), model: r.model, device: r.device, browser: r.browser, version: r.version, pre: r.pre, threads: r.threads, suffix: r.suffix ?? '', isolate: r.isolate ?? true, guard: r.guard ?? null, vadParams: r.vadParams ?? null, cpu: r.cpu ?? null, dtype: r.dtype, size: r.size, load: r.load, memory: r.memory, gpu: r.gpu, wordTimestamps: r.wordTimestamps, errors: r.errors, rows: r.rows.map(({ hyp, ...rest }) => rest) })) };
writeFileSync(join(outDir, `asr-${tag}-summary.json`), JSON.stringify(summary, null, 1));

// ---------------------------------------------------------------- markdown
const order = ['moonshine-tiny', 'moonshine-base', 'base', 'base-fp16', 'distil-small.en', 'small', 'small-fp16', 'distil-large-v3.5', 'turbo'];
results.sort((a, b) => order.indexOf(a.model) - order.indexOf(b.model) || a.device.localeCompare(b.device) || (a.threads ?? 0) - (b.threads ?? 0) || a.browser.localeCompare(b.browser) || a.pre.localeCompare(b.pre));
const lines = [];
const p = (s = '') => lines.push(s);
const weightsOf = (r) => (r.size ? `${Math.round(r.size.totalBytes / 1e6)} MB` : '—');
const dtypeOf = (r) => `${r.dtype.encoder_model}/${r.dtype.decoder_model_merged}`;
const label = (r) => `${r.model} | ${r.device}${r.threads ? ` (${r.threads} thr.)` : ''}${r.isolate === false ? ' (not isolated)' : ''} | ${r.browser}${r.suffix ? ` ${r.suffix}` : ''}`;

if (incomplete.length) {
  p(`Runs that did not finish (left out): ${incomplete.join(', ')}`);
  p();
}

p('#### T1. Models: download, load, speed, memory (pre-filter: Silero VAD)');
p();
p('| Model | Device | Browser | Weights (enc/dec) | Download | Load cold / warm | RTF long | RTF all | Private bytes baseline → peak | GPU memory baseline → peak | Word times |');
p('|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of results.filter((x) => x.pre === 'silero')) {
  const long = group(r, (x) => x.set === 'long');
  const all = group(r, () => true);
  p(`| ${label(r)} | ${dtypeOf(r)} | ${weightsOf(r)} | ${(r.load.cold.ms / 1000).toFixed(1)} s / ${(r.load.warm.ms / 1000).toFixed(1)} s | ${num(long?.rtf, 3)} | ${num(all?.rtf, 3)} | ${r.load.baseline.memory?.peakTotalMib ?? '—'} → ${r.memory?.peakTotalMib ?? '—'} MiB | ${r.load.baseline.gpu?.peakMib ?? '—'} → ${r.gpu?.peakMib ?? '—'} MiB | ${r.load.type !== 'whisper' ? 'none (only the span it was given)' : r.wordTimestamps ? 'yes' : 'no (segments)'} |`);
}
p();

p('#### T2. English word error rate (Whisper-normalised / strict September metric)');
p();
p('| Model | Device | Browser | Pre | short clean (September's 6 FLEURS clips) | long-a | long-b | long-c | long-fleurs | long, all | mix-clean | music 20 dB | music 10 dB | music 5 dB | music 0 dB | pink 10 dB | pink 5 dB | pause | val-clean | val-pink-5 | val-music-5 |');
p('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
const werCell = (g) => (g ? `${pct(g.normWer)} / ${pct(g.strictWer)}` : '—');
for (const r of results) {
  if (!r.rows.some((x) => x.kind === 'speech' && x.lang === 'en')) continue;
  const one = (id) => werCell(group(r, (x) => x.id === id));
  p(`| ${label(r)} | ${r.pre} | ${werCell(group(r, (x) => x.set === 'short' && x.id.startsWith('en-')))} | ${one('long-a')} | ${one('long-b')} | ${one('long-c')} | ${one('long-fleurs')} | ${werCell(group(r, (x) => x.set === 'long'))} | ${one('mix-clean')} | ${one('mix-music-20')} | ${one('mix-music-10')} | ${one('mix-music-5')} | ${one('mix-music-0')} | ${one('mix-pink-10')} | ${one('mix-pink-5')} | ${werCell(group(r, (x) => x.set === 'pause'))} | ${one('val-clean')} | ${one('val-pink-5')} | ${one('val-music-5')} |`);
}
p();

p('#### T3. Negatives: invented text (the right transcript is empty; "neg" = 11 clips, "negh" = 6 held-out clips)');
p();
const GUARDS = {
  none: () => false,
  'nsp>0.6 & lp<-1': (w) => w.noSpeechProb !== null && w.noSpeechProb > 0.6 && w.avgLogprob !== null && w.avgLogprob < -1,
  'nsp>0.6': (w) => w.noSpeechProb !== null && w.noSpeechProb > 0.6,
  'lp<-1': (w) => w.avgLogprob !== null && w.avgLogprob < -1,
  'nsp>0.6 or lp<-1': (w) => (w.noSpeechProb !== null && w.noSpeechProb > 0.6) || (w.avgLogprob !== null && w.avgLogprob < -1),
  'lp<-0.7': (w) => w.avgLogprob !== null && w.avgLogprob < -0.7,
};
const visibleWords = (w) => w.words > 0;
p(`| Model | Device | Browser | Pre | Set | Clips with invented text | Punctuation only | ${Object.keys(GUARDS).slice(1).map((g) => `after guard ${g}`).join(' | ')} | Invented text |`);
p(`|---|---|---|---|---|---|---|${Object.keys(GUARDS).slice(1).map(() => '---').join('|')}|---|`);
for (const r of results) {
  for (const set of ['neg', 'negh', 'negv']) {
    const neg = r.rows.filter((x) => x.kind === 'negative' && x.set === set && !x.error);
    if (neg.length === 0) continue;
    const invented = neg.filter((x) => x.invented);
    // Offline guards need the per-window figures; a run with the guard already applied, or without them, shows n/a.
    const hasFigures = !r.guard && neg.every((x) => x.windows.every((w) => w.avgLogprob !== null && w.noSpeechProb !== null));
    const cells = Object.entries(GUARDS).slice(1).map(([, rule]) => (hasFigures ? `${neg.filter((x) => x.windows.some((w) => visibleWords(w) && !rule(w))).length}/${neg.length}` : 'n/a'));
    p(`| ${label(r)} | ${r.pre}${r.guard ? ' + guard in engine' : ''} | ${set} | ${invented.length}/${neg.length} | ${neg.filter((x) => x.punctuationOnly).length} | ${cells.join(' | ')} | ${invented.map((x) => `${x.id}: "${x.inventedText.slice(0, 50)}"`).join('; ') || '—'} |`);
  }
}
p();

p('#### T4. What the guards would cost on real speech (windows wrongly dropped, all English speech clips)');
p();
p(`| Model | Device | Browser | Pre | Speech windows | ${Object.keys(GUARDS).slice(1).map((g) => `dropped by ${g} (words)`).join(' | ')} |`);
p(`|---|---|---|---|---|${Object.keys(GUARDS).slice(1).map(() => '---').join('|')}|`);
for (const r of results) {
  const speech = r.rows.filter((x) => x.kind === 'speech' && x.lang === 'en' && !x.error && x.set !== 'pause');
  const windows = speech.flatMap((x) => x.windows);
  if (windows.length === 0 || windows.every((w) => w.avgLogprob === null)) continue;
  const cells = Object.entries(GUARDS).slice(1).map(([, rule]) => {
    const dropped = windows.filter(rule);
    return `${dropped.length} (${sum(dropped.map((w) => w.words))})`;
  });
  p(`| ${label(r)} | ${r.pre} | ${windows.length} | ${cells.join(' | ')} |`);
}
p();

p('#### T5. Speech with long pauses (pause-01, pause-02): words written inside the gaps, and what the pre-filter passed');
p();
p('| Model | Device | Browser | Pre | Words inside gaps | Text | Gap seconds passed to the model | WER (norm.) |');
p('|---|---|---|---|---|---|---|---|');
for (const r of results) {
  const rows = r.rows.filter((x) => x.set === 'pause' && !x.error);
  if (rows.length === 0) continue;
  const gapS = sum(rows.map((x) => x.gapS ?? 0));
  p(`| ${label(r)} | ${r.pre} | ${sum(rows.map((x) => x.wordsInGaps ?? 0))} | ${rows.map((x) => x.wordsInGapsText).filter(Boolean).join(' / ') || '—'} | ${rows[0].gapPassedS === undefined ? 'all (no filter)' : `${num(sum(rows.map((x) => x.gapPassedS)), 1)} of ${num(gapS, 1)} s`} | ${pct(group(r, (x) => x.set === 'pause').normWer)} |`);
}
p();

p('#### T6. Pre-filter alone: reference words left outside the speech spans (model-independent)');
p();
p('| Pre | Clip | Audio | Passed to the model | Reference words (timed) | Words outside the spans | Which |');
p('|---|---|---|---|---|---|---|');
{
  const seen = new Set();
  for (const r of results) {
    for (const x of r.rows) {
      if (x.error || x.passedS === undefined) continue;
      const k = `${r.pre}/${x.id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      p(`| ${r.pre} | ${x.id} | ${num(x.audioS, 1)} s | ${num(x.passedS, 1)} s (${pct(x.passedS / x.audioS, 0)}) | ${x.refWordsTimed ?? '—'} | ${x.wordsOutsideSpans ?? '—'} | ${(x.wordsOutsideSpansList ?? []).join(' ')} |`);
    }
  }
}
p();

p(`#### T7. Timing against the forced-alignment reference (threshold ±${TIMING_THRESHOLD_S * 1000} ms)`);
p();
p('| Model | Device | Browser | Pre | Clips | Kind | Start: n / median / p95 / mean signed / within | End: n / median / p95 / mean signed / within |');
p('|---|---|---|---|---|---|---|---|');
const pool = (rows, which) => stats(rows.flatMap((x) => rawTiming.get(x)?.[which] ?? []));
const timingCell = (s) => (s ? `${s.n} / ${msf(s.medianAbs)} / ${msf(s.p95Abs)} / ${s.meanSigned >= 0 ? '+' : ''}${Math.round(s.meanSigned * 1000)} ms / ${pct(s.within, 0)}` : '—');
for (const r of results) {
  for (const [name, pred] of [['long (LibriSpeech, clean)', (x) => x.set === 'long'], ['mix-clean', (x) => x.id === 'mix-clean'], ['music 10 dB', (x) => x.id === 'mix-music-10'], ['music 0 dB', (x) => x.id === 'mix-music-0'], ['pause', (x) => x.set === 'pause']]) {
    const rows = r.rows.filter((x) => !x.error && x.timing && pred(x));
    if (rows.length === 0) continue;
    p(`| ${label(r)} | ${r.pre} | ${name} | ${rows[0].timing.wordLevel ? 'word' : 'segment edges'} | ${timingCell(pool(rows, 'start'))} | ${timingCell(pool(rows, 'end'))} |`);
  }
}
p();

// The word times of these exports sit a near-constant amount late. A fixed correction is fair only if it
// is fixed where it is not judged: the offset is the median signed error on long-a, the figures are for
// every other clip with reference times.
p(`#### T7b. The same with one constant taken off (calibrated on long-a only, judged on the other clips; threshold ±${TIMING_THRESHOLD_S * 1000} ms)`);
p();
p('| Model | Device | Browser | Pre | Offset start / end (median signed error on long-a) | Judged on | Start: n / median / p95 / mean signed / within | End: n / median / p95 / mean signed / within |');
p('|---|---|---|---|---|---|---|---|');
summary.calibration = [];
for (const r of results) {
  const cal = r.rows.find((x) => !x.error && x.id === 'long-a' && rawTiming.get(x)?.start.length);
  if (!cal) continue;
  const off = { start: median(rawTiming.get(cal).start), end: median(rawTiming.get(cal).end) };
  const corrected = (rows, which) => stats(rows.flatMap((x) => (rawTiming.get(x)?.[which] ?? []).map((v) => v - off[which])));
  for (const [name, pred] of [['long-b, long-c', (x) => x.id === 'long-b' || x.id === 'long-c'], ['mix-clean', (x) => x.id === 'mix-clean'], ['music 10 dB', (x) => x.id === 'mix-music-10'], ['music 0 dB', (x) => x.id === 'mix-music-0'], ['pause', (x) => x.set === 'pause']]) {
    const rows = r.rows.filter((x) => !x.error && x.timing && pred(x));
    if (rows.length === 0) continue;
    const cs = corrected(rows, 'start');
    const ce = corrected(rows, 'end');
    summary.calibration.push({ key: key(r), offset: off, judgedOn: name, start: cs, end: ce });
    p(`| ${label(r)} | ${r.pre} | ${Math.round(off.start * 1000)} ms / ${Math.round(off.end * 1000)} ms | ${name} | ${timingCell(cs)} | ${timingCell(ce)} |`);
  }
}
writeFileSync(join(outDir, `asr-${tag}-summary.json`), JSON.stringify(summary, null, 1));
p();

p('#### T8. Drift over long files (median signed start error per third of the file)');
p();
p('| Model | Device | Pre | Clip | First third | Middle third | Last third |');
p('|---|---|---|---|---|---|---|');
for (const r of results) {
  for (const x of r.rows.filter((y) => !y.error && y.set === 'long' && y.timing)) {
    p(`| ${r.model} | ${r.device}${r.threads ? ` t${r.threads}` : ''} ${r.browser} | ${r.pre} | ${x.id} | ${x.timing.drift.map((d) => (d ? `${d.medianSigned >= 0 ? '+' : ''}${Math.round(d.medianSigned * 1000)} ms (n ${d.n})` : '—')).join(' | ')} |`);
  }
}
p();

p(`#### T9. Seams: reference-word error rate within ±${SEAM_NEAR_S} s of a seam vs. elsewhere (LibriSpeech long + mix-clean)`);
p();
p('| Model | Device | Pre | Forced cuts: seams / words / errors | Window ends at a pause: seams / words / errors | Joints inside a window: seams / words / errors | Elsewhere: words / errors |');
p('|---|---|---|---|---|---|---|');
for (const r of results) {
  const rows = r.rows.filter((x) => !x.error && x.seams && (x.set === 'long' || x.id === 'mix-clean'));
  if (rows.length === 0) continue;
  const cell = (k, withSeams = true) => {
    const words = sum(rows.map((x) => x.seams.tally[k][0]));
    const errors = sum(rows.map((x) => x.seams.tally[k][1]));
    const seams = withSeams ? `${sum(rows.map((x) => x.seams.counts[k]))} / ` : '';
    return `${seams}${words} / ${errors} (${words ? pct(errors / words) : '—'})`;
  };
  p(`| ${r.model} | ${r.device}${r.threads ? ` t${r.threads}` : ''} ${r.browser} | ${r.pre} | ${cell('cut')} | ${cell('pause')} | ${cell('joint')} | ${cell('away', false)} |`);
}
p();

p('#### T10. Punctuation, casing, numbers (FLEURS: long-fleurs + 7 short clips)');
p();
p('| Model | Device | Pre | Sentence ends ref → hyp | Commas ref → hyp | Capitalised words kept | Same casing on matched words | Number tokens ref → hyp |');
p('|---|---|---|---|---|---|---|---|');
for (const r of results) {
  const rows = r.rows.filter((x) => !x.error && x.punct);
  if (rows.length === 0) continue;
  const t = (k) => sum(rows.map((x) => x.punct[k]));
  p(`| ${r.model} | ${r.device}${r.threads ? ` t${r.threads}` : ''} ${r.browser} | ${r.pre} | ${t('refSentenceEnds')} → ${t('hypSentenceEnds')} | ${t('refCommas')} → ${t('hypCommas')} | ${t('capitalKept')}/${t('refCapital')} (${pct(t('capitalKept') / t('refCapital'), 0)}) | ${t('sameCase')}/${t('hits')} (${pct(t('sameCase') / t('hits'), 0)}) | ${t('refNumberTokens')} → ${t('hypNumberTokens')} |`);
}
p();

p('#### T13. Guard applied in the engine: what it dropped');
p();
p('| Model | Device | Browser | Pre | Guard | Negatives: spans dropped (clips) | Speech clips: spans kept / dropped | Words in the dropped speech spans | Which |');
p('|---|---|---|---|---|---|---|---|---|');
for (const r of results) {
  if (!r.guard) continue;
  const neg = r.rows.filter((x) => !x.error && x.kind === 'negative');
  const speech = r.rows.filter((x) => !x.error && x.kind === 'speech');
  const negDropped = neg.flatMap((x) => x.windows.filter((w) => w.dropped).map(() => x.id));
  const speechWindows = speech.flatMap((x) => x.windows.map((w) => ({ id: x.id, ...w })));
  const dropped = speechWindows.filter((w) => w.dropped);
  p(`| ${label(r)} | ${r.pre}${r.perSpan ? ', per span' : ''} | ${r.guard.noSpeech === null ? `log-prob. < ${r.guard.logprob}${r.guard.compression ? ` or zlib ratio > ${r.guard.compression}` : ''}` : `no-speech > ${r.guard.noSpeech} and log-prob. < ${r.guard.logprob}`} | ${negDropped.length} (${new Set(negDropped).size}) | ${speechWindows.length - dropped.length} / ${dropped.length} | ${sum(dropped.map((w) => w.droppedWords))} | ${dropped.map((w) => `${w.id} ${num(w.start, 1)}–${num(w.end, 1)} s "${(w.droppedText ?? '').trim().slice(0, 40)}"`).join('; ') || '—'} |`);
}
p();

p('#### T12. Repetition loops: windows whose text compresses more than 2.4× (the loop test Whisper itself uses)');
p();
p('| Model | Device | Pre | Clip | Window | Compression ratio | Mean log-prob. | Words | Text starts |');
p('|---|---|---|---|---|---|---|---|---|');
for (const r of results) {
  for (const x of r.rows.filter((y) => !y.error)) {
    for (const w of x.windows.filter((v) => v.compressionRatio !== null && v.compressionRatio > 2.4)) {
      p(`| ${r.model} | ${r.device}${r.threads ? ` t${r.threads}` : ''} ${r.browser}${r.suffix ?? ''} | ${r.pre} | ${x.id} | ${num(w.start, 1)}–${num(w.end, 1)} s | ${num(w.compressionRatio, 1)} | ${num(w.avgLogprob, 2)} | ${w.words} | "${w.text.trim().slice(0, 60)}" |`);
    }
  }
}
p();

if (results.some((r) => r.rows.some((x) => x.set === 'tr'))) {
  p('#### T11. Turkish (September set: 12 clean + 3 noisy)');
  p();
  p('| Model | Device | Pre | WER clean (strict) | CER clean | WER noisy (strict) | RTF |');
  p('|---|---|---|---|---|---|---|');
  for (const r of results) {
    const clean = group(r, (x) => x.set === 'tr' && x.id.startsWith('tr-'));
    if (!clean) continue;
    const noisy = group(r, (x) => x.set === 'tr' && x.id.startsWith('noisy-'));
    p(`| ${r.model} | ${r.device} ${r.browser} | ${r.pre} | ${pct(clean.strictWer)} | ${pct(clean.cer)} | ${pct(noisy?.strictWer)} | ${num(clean.rtf, 3)} |`);
  }
  p();
}

writeFileSync(join(outDir, `asr-${tag}-summary.md`), lines.join('\n'));
console.log(lines.join('\n'));
