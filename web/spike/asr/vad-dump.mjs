/**
 * Silero VAD over every clip, in Node (same ONNX file, onnxruntime-node), and
 * a sweep of the span settings — no browser, no recogniser. Answers, per
 * setting: how much of the negatives would reach the model, and how many
 * reference words would be cut away. Writes
 * web/spike-results/asr-<tag>-vad-dump.json (probabilities as 0–100).
 *
 *   node vad-dump.mjs [--tag=2026-10-03] [--per-utterance]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AutoModel, Tensor, env } from '@huggingface/transformers';

import { VAD_MODEL } from './models.mjs';
import { DEFAULT_VAD, spansFromProbs } from './segments.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = dirname(dirname(here));
const speechDir = join(webRoot, 'tests', 'media', 'speech');
const outDir = join(webRoot, 'spike-results');
const args = process.argv.slice(2);
const tag = (args.find((a) => a.startsWith('--tag=')) ?? '--tag=2026-10-03').slice(6);
const RATE = 16000;
const HOP = 512;
const CONTEXT = 64;

env.allowRemoteModels = false;
env.localModelPath = join(here, 'models');
// A path that is not a plain "owner/name" id is used as given (the mirror keeps the hub's resolve/<revision>/ layout).
const vad = await AutoModel.from_pretrained(join(here, 'models', VAD_MODEL.id, 'resolve', VAD_MODEL.revision).replaceAll('\\', '/'), { config: { model_type: 'custom' }, dtype: 'fp32' });

function readWav(file) {
  const buf = readFileSync(file);
  let off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'data') {
      const n = Math.floor(Math.min(size, buf.length - off - 8) / 2);
      const out = new Float32Array(n);
      for (let i = 0; i < n; i += 1) out[i] = buf.readInt16LE(off + 8 + i * 2) / 32768;
      return out;
    }
    off += 8 + size + (size % 2);
  }
  throw new Error(`${file}: no data chunk`);
}

async function probsOf(audio, { context = true } = {}) {
  const steps = Math.floor(audio.length / HOP);
  const probs = new Float32Array(steps);
  const sr = new Tensor('int64', BigInt64Array.from([BigInt(RATE)]), []);
  let state = new Tensor('float32', new Float32Array(2 * 128), [2, 1, 128]);
  for (let i = 0; i < steps; i += 1) {
    const at = i * HOP;
    const frame = new Float32Array(context ? CONTEXT + HOP : HOP);
    if (context) {
      if (i > 0) frame.set(audio.subarray(at - CONTEXT, at), 0);
      frame.set(audio.subarray(at, at + HOP), CONTEXT);
    } else frame.set(audio.subarray(at, at + HOP), 0);
    const out = await vad({ input: new Tensor('float32', frame, [1, frame.length]), sr, state });
    state = out.stateN;
    probs[i] = out.output.data[0];
  }
  return probs;
}

const clips = [];
const en = JSON.parse(readFileSync(join(speechDir, 'manifest-en.json'), 'utf8')).clips;
for (const c of en) clips.push(c);
for (const c of JSON.parse(readFileSync(join(speechDir, 'manifest.json'), 'utf8')).clips) {
  if (c.kind !== 'negative') clips.push({ ...c, set: c.lang === 'en' ? 'short' : 'tr', kind: 'speech', file: `clips/${c.file}`, words: null });
}

const frameS = HOP / RATE;
const dump = { tag, frameS, model: VAD_MODEL, clips: [] };
for (const clip of clips) {
  const file = join(speechDir, clip.file);
  if (!existsSync(file)) continue;
  const audio = readWav(file);
  const started = Date.now();
  const probs = await probsOf(audio);
  const entry = { id: clip.id, set: clip.set, kind: clip.kind, durationS: audio.length / RATE, ms: Date.now() - started, probs: Array.from(probs, (v) => Math.round(v * 100)) };
  // FLEURS long file: the same recordings one at a time (fresh state), to tell a level problem from a state problem.
  if (args.includes('--per-utterance') && clip.source?.utterances?.[0]?.text) {
    entry.utterances = [];
    for (const u of clip.source.utterances) {
      const piece = audio.subarray(Math.round(u.start * RATE), Math.round(u.end * RATE));
      let peak = 0;
      let power = 0;
      for (let i = 0; i < piece.length; i += 1) {
        peak = Math.max(peak, Math.abs(piece[i]));
        power += piece[i] * piece[i];
      }
      const alone = await probsOf(piece);
      const inFile = probs.subarray(Math.floor(u.start / frameS), Math.floor(u.end / frameS));
      const share = (p) => Array.from(p).filter((v) => v >= 0.5).length / Math.max(1, p.length);
      entry.utterances.push({ id: u.id, start: u.start, end: u.end, peakDb: Number((20 * Math.log10(peak || 1e-9)).toFixed(1)), rmsDb: Number((10 * Math.log10(power / piece.length || 1e-12)).toFixed(1)), speechShareInFile: Number(share(inFile).toFixed(2)), speechShareAlone: Number(share(alone).toFixed(2)) });
    }
  }
  dump.clips.push(entry);
  console.log(`${clip.id.padEnd(13)} ${entry.durationS.toFixed(1).padStart(7)} s  vad ${entry.ms} ms  frames≥0.5: ${(entry.probs.filter((v) => v >= 50).length / entry.probs.length * 100).toFixed(0)}%`);
}
writeFileSync(join(outDir, `asr-${tag}-vad-dump.json`), JSON.stringify(dump));

// ---- sweep
const byId = new Map(clips.map((c) => [c.id, c]));
const settings = [];
for (const threshold of [0.3, 0.5, 0.7, 0.8, 0.9]) for (const minSpeechS of [0.25, 0.5]) settings.push({ threshold, negThreshold: Math.max(0.05, threshold - 0.15), minSpeechS });
console.log('\n| threshold | min speech | negatives: clips with any span / seconds passed (of total) | held-out negatives | gap seconds passed (pause set) | reference words outside spans (LibriSpeech clean) | … under music 10 dB | … under music 0 dB | FLEURS long (levels evened): passed | FLEURS long (raw levels): passed |');
console.log('|---|---|---|---|---|---|---|---|---|---|');
for (const s of settings) {
  const params = { ...DEFAULT_VAD, ...s };
  const acc = { neg: [0, 0, 0, 0], negh: [0, 0, 0, 0], gap: [0, 0], clean: [0, 0], m10: [0, 0], m0: [0, 0], fleurs: [0, 0], fleursRaw: [0, 0] };
  for (const entry of dump.clips) {
    const clip = byId.get(entry.id);
    const spans = spansFromProbs(entry.probs.map((v) => v / 100), frameS, entry.durationS, params);
    const passed = spans.reduce((a, x) => a + x.end - x.start, 0);
    if (clip.set === 'neg' || clip.set === 'negh') {
      const a = acc[clip.set];
      a[0] += spans.length ? 1 : 0;
      a[1] += 1;
      a[2] += passed;
      a[3] += entry.durationS;
    }
    if (clip.gaps) {
      acc.gap[1] += clip.gaps.reduce((a, g) => a + g.end - g.start, 0);
      acc.gap[0] += clip.gaps.reduce((a, g) => a + spans.reduce((b, x) => b + Math.max(0, Math.min(x.end, g.end) - Math.max(x.start, g.start)), 0), 0);
    }
    if (clip.words) {
      const bucket = clip.id === 'mix-music-10' ? acc.m10 : clip.id === 'mix-music-0' ? acc.m0 : clip.set === 'long' || clip.id === 'mix-clean' || clip.set === 'pause' ? acc.clean : null;
      if (bucket) {
        for (const w of clip.words) {
          if (!w.w) continue;
          bucket[1] += 1;
          const mid = (w.s + w.e) / 2;
          if (!spans.some((x) => mid >= x.start && mid <= x.end)) bucket[0] += 1;
        }
      }
    }
    if (entry.id === 'long-fleurs' || entry.id === 'long-fleurs-raw') {
      const speechS = clip.source.utterances.reduce((a, u) => a + u.end - u.start, 0);
      acc[entry.id === 'long-fleurs' ? 'fleurs' : 'fleursRaw'] = [passed, speechS];
    }
  }
  const f = (x, d = 1) => x.toFixed(d);
  console.log(`| ${s.threshold} | ${s.minSpeechS} s | ${acc.neg[0]}/${acc.neg[1]} / ${f(acc.neg[2])} s (of ${f(acc.neg[3], 0)}) | ${acc.negh[1] ? `${acc.negh[0]}/${acc.negh[1]} / ${f(acc.negh[2])} s (of ${f(acc.negh[3], 0)})` : '—'} | ${f(acc.gap[0])} of ${f(acc.gap[1], 0)} s | ${acc.clean[0]}/${acc.clean[1]} | ${acc.m10[0]}/${acc.m10[1]} | ${acc.m0[0]}/${acc.m0[1]} | ${f(acc.fleurs[0])} s of ${f(acc.fleurs[1], 0)} s of recordings | ${f(acc.fleursRaw[0])} s of ${f(acc.fleursRaw[1], 0)} s |`);
}
