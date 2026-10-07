/**
 * The speech detector on its own, outside the browser (ADR-036, 7 Oct 2026):
 * what share of the real speech does it find, and how much that is not
 * speech does it let through — with and without level normalisation, and
 * with other detector settings.
 *
 * It runs the SAME detector file the app ships (public/models/silero-vad-…,
 * through onnxruntime-node) and the app's own rules (`domain/speechSpans.ts`,
 * `domain/levelNormalise.ts`, compiled here from the TypeScript sources), on
 * the 16 kHz clips of the measurement sets. It is the cheap first look that
 * decides which settings are worth a full run through the app
 * (`run-app.mjs`), where the numbers that are reported come from. The audio
 * here is the WAV, not the AAC the app decodes: close, not identical.
 *
 *   node scripts/transcript/vad-lab.mjs --sets=rdev,rneg,neg,negh,negv,stress,pause  --variants='legacy;level'
 *   node scripts/transcript/vad-lab.mjs --clips=steps-libri --variants='legacy;level:aheadS=1.0,maxGainDb=30'
 *
 * A variant is `legacy` (the detector as shipped on 5 Oct) or `level` (level
 * normalisation with its defaults), each optionally followed by
 * `:key=value,…` overriding a level parameter or a detector parameter.
 * Output: transcript-results/vad-lab.json and a table on the console.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import * as ort from 'onnxruntime-node';
import ts from 'typescript';

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const found = args.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};

async function domain(name) {
  const source = readFileSync(join(webDir, 'src', 'domain', `${name}.ts`), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  if (/from '\.\//.test(outputText)) throw new Error(`${name}.ts has a runtime import: compile that too`);
  const dir = join(webDir, 'transcript-results', '.generated');
  mkdirSync(dir, { recursive: true });
  const target = join(dir, `${name}.mjs`);
  writeFileSync(target, outputText);
  return import(`${pathToFileURL(target).href}?${Date.now()}`);
}
const spansModule = await domain('speechSpans');
const levelModule = await domain('levelNormalise');
const { VAD_HOP, VAD_CONTEXT, VAD_FRAME_S, VAD_SAMPLE_RATE, spansFromProbs } = spansModule;

const speechDir = join(webDir, 'tests', 'media', 'speech');
const manifests = ['manifest-en.json', 'manifest-real.json'].filter((name) => existsSync(join(speechDir, name))).map((name) => JSON.parse(readFileSync(join(speechDir, name), 'utf8')));
const all = manifests.flatMap((manifest) => manifest.clips);
const wantedSets = arg('sets', '').split(',').filter(Boolean);
const wantedClips = arg('clips', '').split(',').filter(Boolean);
const clips = all.filter((clip) => wantedClips.includes(clip.id) || wantedSets.includes(clip.set));
if (clips.length === 0) {
  console.error('vad-lab: no clips (--sets= / --clips=)');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(join(webDir, 'src', 'domain', 'modelManifest.json'), 'utf8'));
const session = await ort.InferenceSession.create(join(webDir, 'public', 'models', manifest.groups.vad.dir, 'onnx', 'model.onnx'));

function readWav(file) {
  const buf = readFileSync(file);
  const dataAt = buf.indexOf('data', 12) + 8;
  const count = (buf.length - dataAt) >> 1;
  const out = new Float32Array(count);
  for (let i = 0; i < count; i += 1) out[i] = buf.readInt16LE(dataAt + i * 2) / 32768;
  return out;
}

/** The engine's detector loop, sample for sample. */
async function probabilities(samples) {
  const probs = [];
  const sr = new ort.Tensor('int64', BigInt64Array.from([BigInt(VAD_SAMPLE_RATE)]), []);
  let state = new ort.Tensor('float32', new Float32Array(2 * 128), [2, 1, 128]);
  const frame = new Float32Array(VAD_CONTEXT + VAD_HOP);
  for (let at = 0; at + VAD_HOP <= samples.length; at += VAD_HOP) {
    frame.copyWithin(0, VAD_HOP, VAD_HOP + VAD_CONTEXT);
    frame.set(samples.subarray(at, at + VAD_HOP), VAD_CONTEXT);
    const out = await session.run({ input: new ort.Tensor('float32', Float32Array.from(frame), [1, frame.length]), sr, state });
    state = out.stateN;
    probs.push(out.output.data[0]);
  }
  return probs;
}

function parseVariant(text) {
  const [kind, rest] = text.split(':');
  const overrides = {};
  for (const pair of (rest ?? '').split(',').filter(Boolean)) {
    const [key, value] = pair.split('=');
    overrides[key] = Number(value);
  }
  const levelKeys = ['blockS', 'backS', 'aheadS', 'targetDb', 'maxGainDb', 'minContrastDb'];
  const level = Object.fromEntries(Object.entries(overrides).filter(([key]) => levelKeys.includes(key)));
  const vad = Object.fromEntries(Object.entries(overrides).filter(([key]) => !levelKeys.includes(key)));
  return { name: text, kind, level, vad };
}
const variants = arg('variants', 'legacy;level').split(';').filter(Boolean).map(parseVariant);

/** Seconds of [a) that lie inside the union of `spans`. */
function overlap(intervals, spans) {
  let total = 0;
  let k = 0;
  for (const interval of intervals) {
    while (k < spans.length && spans[k].end <= interval.start) k += 1;
    for (let j = k; j < spans.length && spans[j].start < interval.end; j += 1) {
      total += Math.max(0, Math.min(interval.end, spans[j].end) - Math.max(interval.start, spans[j].start));
    }
  }
  return total;
}
const length = (intervals) => intervals.reduce((sum, i) => sum + (i.end - i.start), 0);

const outDir = join(webDir, 'transcript-results');
mkdirSync(outDir, { recursive: true });
const rows = [];
const cache = new Map();
for (const clip of clips) {
  const samples = readWav(join(speechDir, clip.file));
  for (const variant of variants) {
    const key = `${clip.id}|${variant.kind}|${JSON.stringify(variant.level)}`;
    let probs = cache.get(key);
    if (!probs) {
      if (variant.kind === 'union') {
        // Either copy says speech: the detector on the sound as decoded AND on the level-normalised copy.
        const plain = await probabilities(samples);
        const levelled = await probabilities(levelModule.normaliseLevel(samples, VAD_SAMPLE_RATE, variant.level));
        probs = plain.map((value, index) => Math.max(value, levelled[index] ?? 0));
      } else {
        probs = await probabilities(variant.kind === 'level' ? levelModule.normaliseLevel(samples, VAD_SAMPLE_RATE, variant.level) : samples);
      }
      cache.set(key, probs);
    }
    const spans = spansFromProbs(probs, VAD_FRAME_S, samples.length / VAD_SAMPLE_RATE, variant.vad);
    const row = { id: clip.id, set: clip.set, variant: variant.name, durationS: clip.durationS, spans: spans.length, spanS: length(spans) };
    const words = (clip.words ?? []).filter((w) => w.e > w.s).map((w) => ({ start: w.s, end: w.e }));
    if (words.length > 0) {
      // Speech time = the reference words' own durations; "found" = the part inside a detector span.
      row.speechS = length(words);
      row.foundS = overlap(words, spans);
      row.recall = row.foundS / row.speechS;
      row.shortSpans = spans.filter((span) => span.end - span.start < 2).length;
    }
    if (clip.gaps) row.gapS = overlap(clip.gaps, spans);
    if (clip.kind === 'negative') row.passedS = length(spans);
    if (clip.levels && words.length > 0) {
      // Per level step: how much of the speech at that gain was found.
      const byGain = new Map();
      for (const level of clip.levels.map((entry, index, list) => ({ start: entry.start ?? entry.atS, end: entry.end ?? list[index + 1]?.atS ?? clip.durationS, gainDb: entry.gainDb ?? entry.db }))) {
        const inside = words.filter((w) => w.start >= level.start && w.end <= level.end);
        const entry = byGain.get(level.gainDb) ?? { speechS: 0, foundS: 0 };
        entry.speechS += length(inside);
        entry.foundS += overlap(inside, spans);
        byGain.set(level.gainDb, entry);
      }
      row.byGain = Object.fromEntries([...byGain.entries()].sort((a, b) => b[0] - a[0]).map(([gainDb, entry]) => [gainDb, entry.speechS > 0 ? Number((entry.foundS / entry.speechS).toFixed(3)) : null]));
    }
    rows.push(row);
    const parts = [`${clip.id.padEnd(18)} ${variant.name.padEnd(34)} spans ${String(spans.length).padStart(4)} ${row.spanS.toFixed(1).padStart(7)} s`];
    if (row.recall !== undefined) parts.push(`found ${(row.recall * 100).toFixed(1)}% of ${row.speechS.toFixed(0)} s speech; short spans ${row.shortSpans}`);
    if (row.gapS !== undefined) parts.push(`in gaps ${row.gapS.toFixed(1)} s`);
    if (row.passedS !== undefined) parts.push(`NEGATIVE passed ${row.passedS.toFixed(1)} s`);
    if (row.byGain) parts.push(JSON.stringify(row.byGain));
    console.log(parts.join(' | '));
  }
}
// Totals per set and variant.
console.log('');
for (const variant of variants) {
  for (const set of [...new Set(rows.map((row) => row.set))]) {
    const mine = rows.filter((row) => row.set === set && row.variant === variant.name);
    const speech = mine.filter((row) => row.speechS !== undefined);
    const negatives = mine.filter((row) => row.passedS !== undefined);
    const bits = [];
    if (speech.length) bits.push(`found ${((speech.reduce((s, r) => s + r.foundS, 0) / speech.reduce((s, r) => s + r.speechS, 0)) * 100).toFixed(1)}% of speech`);
    if (negatives.length) bits.push(`negatives passed ${negatives.reduce((s, r) => s + r.passedS, 0).toFixed(1)} s of ${negatives.reduce((s, r) => s + r.durationS, 0).toFixed(0)} s in ${negatives.filter((r) => r.passedS > 0).length}/${negatives.length} clips`);
    const gaps = mine.filter((row) => row.gapS !== undefined);
    if (gaps.length) bits.push(`gaps passed ${gaps.reduce((s, r) => s + r.gapS, 0).toFixed(1)} s`);
    if (!speech.length && !negatives.length) bits.push(`span time ${mine.reduce((s, r) => s + r.spanS, 0).toFixed(1)} s`);
    console.log(`TOTAL ${set.padEnd(7)} ${variant.name.padEnd(34)} ${bits.join(' | ')}`);
  }
}
const outFile = join(outDir, `vad-lab-${arg('tag', 'last')}.json`);
writeFileSync(outFile, `${JSON.stringify({ createdAt: new Date().toISOString(), variants, rows }, null, 1)}\n`);
console.log(`vad-lab: ${outFile}`);
