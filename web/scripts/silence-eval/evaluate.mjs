/**
 * Evaluates `src/domain/silence.ts` against the ground-truth set built by
 * `build-dataset.mjs` (ADR-018 measurement gate).
 *
 *   node scripts/silence-eval/evaluate.mjs [--tag=name] [--no-listen] [--detector=path/to/silence.ts]
 *
 * Detector input: ffmpeg's per-10 ms RMS of the mono mix (astats), -inf
 * clamped to -120 dB, i.e. an envelope computed independently of the app.
 * Speech check: ffmpeg's per-5 ms RMS of the SPEECH STEM of the same file
 * (different framing from the detector's), plus the geometric overlap of each
 * cut with the known speech segments. Results: web/spike-results/.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { RATE, evalDir, ffmpegEnvelope, loadDetector, percentile, readWav16, resultsDir, rng, slidingRms1ms, writeWav16 } from './lib.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);
const TAG = args.tag ?? 'default';
const MS = RATE / 1000;
/** Gate rules (ADR-018 + the task brief). */
const OVERLAP_LIMIT_MS = 20;
const LEVEL_WITHIN_DB = 20;

const manifest = JSON.parse(readFileSync(join(evalDir, 'manifest.json'), 'utf8'));
const detector = await loadDetector(args.detector ? String(args.detector) : undefined);

const overlap = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

function frameMax(env5, fromMs, toMs) {
  // 5 ms frames that overlap [fromMs, toMs).
  let max = -120;
  const first = Math.max(0, Math.floor(fromMs / 5));
  const last = Math.min(env5.length - 1, Math.ceil(toMs / 5) - 1);
  for (let k = first; k <= last; k += 1) max = Math.max(max, env5[k]);
  return max;
}

console.log('measuring envelopes with ffmpeg');
const measured = manifest.files.map((file) => {
  const mixPath = join(evalDir, 'files', `${file.id}.wav`);
  const stemPath = join(evalDir, 'stems', `${file.id}.speech.wav`);
  const env10 = ffmpegEnvelope(mixPath, 480, file.lengthSamples);
  const stem5 = ffmpegEnvelope(stemPath, 240, file.lengthSamples);
  const mix5 = ffmpegEnvelope(mixPath, 240, file.lengthSamples);
  const inSpeech = [];
  for (let k = 0; k < stem5.length; k += 1) {
    const c = k * 5 + 2.5;
    if (file.speechSegments.some((s) => c >= s.startMs && c < s.endMs)) inSpeech.push(stem5[k]);
  }
  const speechLevelDb = inSpeech.length ? percentile(inSpeech, 0.95) : null;
  return { file, env10, stem5, mix5, speechLevelDb };
});

function evaluateFile(m, params) {
  const { file, env10, stem5, mix5, speechLevelDb } = m;
  const analysis = detector.findSilences({ startUs: 0, frameUs: 10_000, db: env10 }, params);
  const keepMs = params.keepUs / 1000;
  const cuts = [];
  const suggestions = analysis.ok ? analysis.suggestions : [];
  for (const s of suggestions) {
    const startMs = s.startUs / 1000;
    const endMs = s.endUs / 1000;
    const speechOverlapMs = file.speechSegments.reduce((sum, seg) => sum + overlap(startMs, endMs, seg.startMs, seg.endMs), 0);
    const stemMaxDb = frameMax(stem5, startMs, endMs);
    const mixMaxDb = frameMax(mix5, startMs, endMs);
    const stemRel = speechLevelDb === null ? null : stemMaxDb - speechLevelDb;
    const mixRel = speechLevelDb === null ? null : mixMaxDb - speechLevelDb;
    const gap = file.gaps.find((g) => overlap(startMs, endMs, g.startMs, g.endMs) > 0);
    const clip = file.clips.find((c) => overlap(startMs, endMs, c.speech.startMs, c.speech.endMs) > 0);
    const pause = clip?.pauses.find((p) => overlap(startMs, endMs, p.startMs, p.endMs) > 0) ?? null;
    let kind = 'other';
    if (gap) kind = gap.kind;
    else if (pause) kind = 'natural';
    cuts.push({
      startMs,
      endMs,
      lengthMs: endMs - startMs,
      kind,
      gap: gap ? { startMs: gap.startMs, endMs: gap.endMs, nominalS: gap.nominalS } : null,
      pause,
      speechOverlapMs,
      stemMaxRelDb: stemRel,
      mixMaxRelDb: mixRel,
      incident: speechOverlapMs > OVERLAP_LIMIT_MS || (stemRel !== null && stemRel >= -LEVEL_WITHIN_DB),
      incidentMix: speechOverlapMs > OVERLAP_LIMIT_MS || (mixRel !== null && mixRel >= -LEVEL_WITHIN_DB),
    });
  }
  const gaps = file.gaps
    .filter((g) => g.kind !== 'lead')
    .map((g) => {
      const hits = cuts.filter((c) => overlap(c.startMs, c.endMs, g.startMs, g.endMs) > 0);
      const eligible = g.nominalS * 1_000_000 >= params.minSilenceUs;
      let startDevMs = null;
      let endDevMs = null;
      if (hits.length) {
        startDevMs = hits[0].startMs - (g.startMs + keepMs);
        endDevMs = g.kind === 'tail' ? hits[hits.length - 1].endMs - g.endMs : hits[hits.length - 1].endMs - (g.endMs - keepMs);
      }
      return { ...g, eligible, detected: hits.length > 0, pieces: hits.length, startDevMs, endDevMs };
    });
  return {
    id: file.id,
    condition: file.condition,
    ok: analysis.ok,
    reason: analysis.ok ? null : analysis.reason,
    stats: analysis.stats,
    speechLevelDb,
    cuts,
    gaps,
  };
}

const CONDITIONS = ['a-digital', 'b-room', 'c-low', 'd-noisy', 'e-music', 'f-mixed', 'neg'];

function summarise(files) {
  const cuts = files.flatMap((f) => f.cuts);
  const gaps = files.flatMap((f) => f.gaps);
  const inner = gaps.filter((g) => g.kind === 'inner');
  const eligible = inner.filter((g) => g.eligible);
  const devs = gaps.flatMap((g) => (g.detected ? [g.startDevMs, ...(g.kind === 'inner' ? [g.endDevMs] : [])] : []));
  const abs = devs.map(Math.abs);
  const natural = cuts.filter((c) => c.kind === 'natural');
  const byNominal = {};
  for (const g of inner) {
    byNominal[g.nominalS] ??= { n: 0, detected: 0 };
    byNominal[g.nominalS].n += 1;
    byNominal[g.nominalS].detected += g.detected ? 1 : 0;
  }
  return {
    files: files.length,
    lowContrast: files.filter((f) => !f.ok).length,
    suggestions: cuts.length,
    suggestedSeconds: cuts.reduce((s, c) => s + c.lengthMs, 0) / 1000,
    incidents: cuts.filter((c) => c.incident).length,
    incidentsMixLevel: cuts.filter((c) => c.incidentMix).length,
    worstStemRelDb: cuts.length ? Math.max(...cuts.map((c) => c.stemMaxRelDb ?? -Infinity)) : null,
    maxSpeechOverlapMs: cuts.length ? Math.max(...cuts.map((c) => c.speechOverlapMs)) : null,
    innerGaps: inner.length,
    eligibleGaps: eligible.length,
    recalled: eligible.filter((g) => g.detected).length,
    recall: eligible.length ? eligible.filter((g) => g.detected).length / eligible.length : null,
    shortGapsSuggested: inner.filter((g) => !g.eligible && g.detected).length,
    shortGaps: inner.filter((g) => !g.eligible).length,
    tailsDetected: gaps.filter((g) => g.kind === 'tail' && g.detected).length,
    tails: gaps.filter((g) => g.kind === 'tail').length,
    splitGaps: gaps.filter((g) => g.pieces > 1).length,
    boundary: {
      n: abs.length,
      p50: abs.length ? percentile(abs, 0.5) : null,
      p95: abs.length ? percentile(abs, 0.95) : null,
      max: abs.length ? Math.max(...abs) : null,
      signedMin: devs.length ? Math.min(...devs) : null,
      signedMax: devs.length ? Math.max(...devs) : null,
    },
    byNominal,
    naturalCuts: natural.length,
    naturalCutLengthsMs: natural.map((c) => Math.round(c.lengthMs)),
    otherCuts: cuts.filter((c) => c.kind === 'other').length,
  };
}

function run(params) {
  const files = measured.map((m) => evaluateFile(m, params));
  const perCondition = Object.fromEntries(CONDITIONS.map((c) => [c, summarise(files.filter((f) => f.condition === c))]));
  const gateFiles = files.filter((f) => ['a-digital', 'b-room', 'c-low'].includes(f.condition));
  const musicFiles = files.filter((f) => f.condition === 'e-music' || f.id === 'neg-03' || f.id === 'neg-04');
  return {
    params,
    files,
    perCondition,
    overall: summarise(files),
    recallABC: summarise(gateFiles),
    musicWrongCuts: musicFiles.reduce((s, f) => s + f.cuts.length, 0),
    negativeCuts: files.filter((f) => f.condition === 'neg').reduce((s, f) => s + f.cuts.length, 0),
  };
}

const defaults = detector.DEFAULT_SILENCE_PARAMS;
const main = run(defaults);

// Parameter sweep.
const sweep = [];
for (const minSilenceUs of [500_000, 700_000, 1_000_000]) {
  for (const keepUs of [100_000, 150_000, 250_000]) {
    for (const sensitivityDb of [-5, 0, 5]) {
      const r = run({ minSilenceUs, keepUs, sensitivityDb });
      sweep.push({
        minSilenceS: minSilenceUs / 1e6,
        keepMs: keepUs / 1000,
        sensitivityDb,
        incidents: r.overall.incidents,
        incidentsMixLevel: r.overall.incidentsMixLevel,
        recallABC: r.recallABC.recall,
        recalled: r.recallABC.recalled,
        eligible: r.recallABC.eligibleGaps,
        boundaryP95: r.recallABC.boundary.p95,
        boundaryP95All: r.overall.boundary.p95,
        musicWrongCuts: r.musicWrongCuts,
        noisySuggestions: r.perCondition['d-noisy'].suggestions,
        naturalCuts: r.overall.naturalCuts,
        suggestedSeconds: r.overall.suggestedSeconds,
      });
    }
  }
}

// Listen substitute: 10 random suggested cuts from the default run.
let listen = [];
if (!args['no-listen']) {
  const pool = main.files.filter((f) => f.condition !== 'neg').flatMap((f) => f.cuts.map((c) => ({ id: f.id, speechLevelDb: f.speechLevelDb, ...c })));
  const random = rng(42);
  const picks = [];
  const taken = new Set();
  while (picks.length < Math.min(10, pool.length)) {
    const k = Math.floor(random() * pool.length);
    if (taken.has(k)) continue;
    taken.add(k);
    picks.push(pool[k]);
  }
  const outDir = join(resultsDir, 'silence-listen', TAG);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const cache = new Map();
  listen = picks.map((p, n) => {
    if (!cache.has(p.id)) cache.set(p.id, readWav16(join(evalDir, 'files', `${p.id}.wav`)));
    const mix = cache.get(p.id);
    const s = Math.round(p.startMs * MS);
    const e = Math.round(p.endMs * MS);
    const ctx = 1.5 * RATE;
    const before = mix.subarray(Math.max(0, s - ctx), s);
    const after = mix.subarray(e, Math.min(mix.length, e + ctx));
    const original = mix.subarray(Math.max(0, s - ctx), Math.min(mix.length, e + ctx));
    const cut = new Float32Array(before.length + after.length);
    cut.set(before, 0);
    cut.set(after, before.length);
    const base = `${String(n + 1).padStart(2, '0')}-${p.id}-${Math.round(p.startMs)}ms`;
    writeWav16(join(outDir, `${base}-original.wav`), original);
    writeWav16(join(outDir, `${base}-cut.wav`), cut);
    // Syllable-boundary proxy: 10 ms RMS (1 ms hop) in the 50 ms on each side of both edges.
    const rel = (from, to) => {
      const a = Math.max(0, from);
      const b = Math.min(mix.length, to);
      const env = slidingRms1ms(mix.subarray(a, b));
      return env.length ? { first: env[0] - p.speechLevelDb, last: env[env.length - 1] - p.speechLevelDb, max: Math.max(...env) - p.speechLevelDb } : null;
    };
    const w = 50 * MS;
    const keptBefore = rel(s - w, s);
    const removedStart = rel(s, s + w);
    const removedEnd = rel(e - w, e);
    const keptAfter = rel(e, e + w);
    const flags = [];
    // Flags: speech-level sound (gate rule: within 20 dB) in the 50 ms removed
    // next to an edge, or energy climbing >10 dB towards an edge on the kept side
    // while above -30 dB re speech (a syllable running into the splice).
    if (removedStart && removedStart.max >= -LEVEL_WITHIN_DB) flags.push('speech-level sound in the 50 ms removed after the cut start');
    if (removedEnd && removedEnd.max >= -LEVEL_WITHIN_DB) flags.push('speech-level sound in the 50 ms removed before the cut end');
    if (keptBefore && keptBefore.last - keptBefore.first > 10 && keptBefore.max >= -30) flags.push('energy rising into the cut start');
    if (keptAfter && keptAfter.first - keptAfter.last > 10 && keptAfter.max >= -30) flags.push('energy falling out of the cut end');
    return {
      file: p.id,
      kind: p.kind,
      startMs: p.startMs,
      endMs: p.endMs,
      wavs: [`${base}-original.wav`, `${base}-cut.wav`],
      relToSpeechDb: { keptBefore, removedStart, removedEnd, keptAfter },
      keptSlopeDbPer50ms: {
        beforeCut: keptBefore ? keptBefore.last - keptBefore.first : null,
        afterCut: keptAfter ? keptAfter.last - keptAfter.first : null,
      },
      flags,
    };
  });
}

mkdirSync(resultsDir, { recursive: true });
const outFile = join(resultsDir, `silence-eval-2026-09-22-${TAG}.json`);
writeFileSync(
  outFile,
  JSON.stringify({ createdAt: new Date().toISOString(), tag: TAG, detectorDefaults: defaults, rules: { OVERLAP_LIMIT_MS, LEVEL_WITHIN_DB }, main, sweep, listen }, null, 2),
);

// Console summary.
const pct = (v) => (v === null ? '-' : `${(v * 100).toFixed(1)}%`);
const ms = (v) => (v === null ? '-' : `${Math.round(v)}`);
console.log(`\n[${TAG}] defaults ${JSON.stringify(defaults)}`);
console.log('condition     files lowC sugg incid(stem/mix) recall        short-sugg tails bnd p50/p95/max  natural other');
for (const [c, s] of Object.entries(main.perCondition)) {
  console.log(
    `${c.padEnd(13)} ${String(s.files).padStart(5)} ${String(s.lowContrast).padStart(4)} ${String(s.suggestions).padStart(4)} ${`${s.incidents}/${s.incidentsMixLevel}`.padStart(15)} ${`${s.recalled}/${s.eligibleGaps} ${pct(s.recall)}`.padEnd(13)} ${`${s.shortGapsSuggested}/${s.shortGaps}`.padStart(10)} ${`${s.tailsDetected}/${s.tails}`.padStart(5)} ${`${ms(s.boundary.p50)}/${ms(s.boundary.p95)}/${ms(s.boundary.max)}`.padStart(13)} ${String(s.naturalCuts).padStart(7)} ${String(s.otherCuts).padStart(5)}`,
  );
}
const o = main.overall;
console.log(`overall: incidents ${o.incidents} (mix-level ${o.incidentsMixLevel}); recall a/b/c ${main.recallABC.recalled}/${main.recallABC.eligibleGaps} ${pct(main.recallABC.recall)}; boundary a/b/c p95 ${ms(main.recallABC.boundary.p95)} ms (all ${ms(o.boundary.p95)}); music wrong cuts ${main.musicWrongCuts}; negatives ${main.negativeCuts}`);
for (const f of main.files) {
  const bad = f.cuts.filter((c) => c.incident);
  const missed = f.gaps.filter((g) => g.eligible && !g.detected && g.kind === 'inner');
  console.log(
    `  ${f.id.padEnd(13)} ${f.ok ? 'ok ' : f.reason.padEnd(3)} floor ${f.stats.floorDb.toFixed(1)} loud ${f.stats.loudDb.toFixed(1)} thr ${f.stats.thresholdDb.toFixed(1)} speech ${f.speechLevelDb?.toFixed(1) ?? '-'} cuts ${f.cuts.length}${bad.length ? ` INCIDENTS ${bad.map((c) => `${Math.round(c.startMs)}-${Math.round(c.endMs)}(${c.kind},ov ${Math.round(c.speechOverlapMs)},rel ${c.stemMaxRelDb.toFixed(1)})`).join(' ')}` : ''}${missed.length ? ` MISSED ${missed.map((g) => g.nominalS).join(',')}` : ''}`,
  );
}
console.log(`\nwrote ${outFile}`);
