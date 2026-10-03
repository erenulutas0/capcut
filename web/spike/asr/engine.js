/**
 * The part that would ship: load a speech model with Transformers.js and
 * transcribe 16 kHz float audio. Runs identically inside a Web Worker
 * (worker.js) or on the main thread (bench.js with ?worker=0).
 *
 * Model files come from the local mirror on this same origin, laid out like
 * the Hugging Face hub (`{model}/resolve/{revision}/…`), so `env.remoteHost`
 * is the only difference from a hub download.
 *
 * October 2026 additions (docs/spikes/2026-10-03-asr-on-device-english.md):
 *  - a speech pre-filter: Silero VAD (run here) or spans handed in by the
 *    driver (our own ADR-018 detector), packed into ≤ 30 s windows of speech
 *    only; what is not speech never reaches the recogniser;
 *  - Whisper's own guards, measured rather than applied: the no-speech
 *    probability of every window (one extra decoder step) and the mean token
 *    log-probability (a logits recorder). Transformers.js 4.3.0 has neither
 *    threshold built in and never conditions on previous text;
 *  - Moonshine and English-only models.
 */
import { AutoModel, LogitsProcessor, LogitsProcessorList, Tensor, env, pipeline } from './node_modules/@huggingface/transformers/dist/transformers.js';

import { DEFAULT_VAD, packWindows, spansFromProbs, toSourceTime, windowAudio } from './segments.mjs';

const origin = self.location.origin;
env.allowLocalModels = false;
env.remoteHost = `${origin}/models/`;
env.remotePathTemplate = '{model}/resolve/{revision}/';
env.backends.onnx.wasm.wasmPaths = `${origin}/node_modules/onnxruntime-web/dist/`;

const SAMPLE_RATE = 16000;
/** Silero v5 at 16 kHz: 512 new samples per step, the last 64 of the previous step in front. */
const VAD_HOP = 512;
const VAD_CONTEXT = 64;

let transcriber = null;
let current = null;
let vad = null;

/** Parses a RIFF WAV (16-bit PCM or 32-bit float, mono, 16 kHz) to Float32. */
function decodeWav(buffer) {
  const view = new DataView(buffer);
  const tag = (o) => String.fromCharCode(view.getUint8(o), view.getUint8(o + 1), view.getUint8(o + 2), view.getUint8(o + 3));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a WAV file');
  let off = 12;
  let fmt = null;
  while (off + 8 <= buffer.byteLength) {
    const id = tag(off);
    const size = view.getUint32(off + 4, true);
    if (id === 'fmt ') {
      fmt = {
        format: view.getUint16(off + 8, true),
        channels: view.getUint16(off + 10, true),
        sampleRate: view.getUint32(off + 12, true),
        bits: view.getUint16(off + 22, true),
      };
    } else if (id === 'data') {
      if (!fmt) throw new Error('WAV data before fmt');
      if (fmt.sampleRate !== SAMPLE_RATE) throw new Error(`expected 16 kHz, got ${fmt.sampleRate}`);
      const start = off + 8;
      const frames = Math.floor(Math.min(size, buffer.byteLength - start) / (fmt.channels * (fmt.bits / 8)));
      const out = new Float32Array(frames);
      for (let i = 0; i < frames; i += 1) {
        let sum = 0;
        for (let c = 0; c < fmt.channels; c += 1) {
          const idx = start + (i * fmt.channels + c) * (fmt.bits / 8);
          sum += fmt.format === 3 ? view.getFloat32(idx, true) : view.getInt16(idx, true) / 32768;
        }
        out[i] = sum / fmt.channels;
      }
      return out;
    }
    off += 8 + size + (size % 2);
  }
  throw new Error('WAV without data chunk');
}

export async function load({ model, revision, device, dtype, threads = null }) {
  await dispose();
  if (threads) env.backends.onnx.wasm.numThreads = threads;
  const files = new Map();
  const started = performance.now();
  transcriber = await pipeline('automatic-speech-recognition', model, {
    revision,
    device,
    dtype,
    progress_callback: (p) => {
      if (p.status === 'progress' || p.status === 'done') {
        const entry = files.get(p.file) ?? { file: p.file, bytes: 0 };
        if (p.total) entry.bytes = p.total;
        if (p.loaded) entry.bytes = Math.max(entry.bytes, p.loaded);
        files.set(p.file, entry);
      }
    },
  });
  const loadMs = performance.now() - started;
  const type = transcriber.model.config.model_type;
  current = { model, revision, device, dtype, type, threads: env.backends.onnx.wasm.numThreads ?? null };
  return { loadMs, files: [...files.values()], type };
}

export async function loadVad({ model, revision }) {
  if (vad) return { loadMs: 0, cached: true };
  const started = performance.now();
  vad = await AutoModel.from_pretrained(model, { revision, config: { model_type: 'custom' }, dtype: 'fp32', device: 'wasm' });
  return { loadMs: performance.now() - started, cached: false };
}

/** One speech probability per 32 ms. */
async function vadProbs(audio) {
  if (!vad) throw new Error('VAD not loaded');
  const steps = Math.floor(audio.length / VAD_HOP);
  const probs = new Float32Array(steps);
  const sr = new Tensor('int64', BigInt64Array.from([BigInt(SAMPLE_RATE)]), []);
  let state = new Tensor('float32', new Float32Array(2 * 1 * 128), [2, 1, 128]);
  const frame = new Float32Array(VAD_CONTEXT + VAD_HOP);
  for (let i = 0; i < steps; i += 1) {
    const at = i * VAD_HOP;
    if (i === 0) frame.fill(0, 0, VAD_CONTEXT);
    else frame.set(audio.subarray(at - VAD_CONTEXT, at), 0);
    frame.set(audio.subarray(at, at + VAD_HOP), VAD_CONTEXT);
    const out = await vad({ input: new Tensor('float32', frame, [1, frame.length]), sr, state });
    state = out.stateN;
    probs[i] = out.output.data[0];
  }
  return probs;
}

/**
 * Sits in the logits processor list and keeps what Transformers.js does not
 * return: the log-probability of every token the decoder went on to pick.
 * It sees the logits after `suppress_tokens` and before the timestamp rules.
 */
class Recorder extends LogitsProcessor {
  constructor(eosId) {
    super();
    this.eosId = eosId;
    this.pending = null;
    this.lastLen = 0;
    this.sum = 0;
    this.count = 0;
    this.firstStep = null;
  }
  account(token) {
    if (!this.pending) return;
    const data = this.pending;
    let max = -Infinity;
    for (let i = 0; i < data.length; i += 1) if (data[i] > max) max = data[i];
    let acc = 0;
    for (let i = 0; i < data.length; i += 1) acc += Math.exp(data[i] - max);
    const logProb = data[token] - max - Math.log(acc);
    if (Number.isFinite(logProb)) {
      this.sum += logProb;
      this.count += 1;
    }
    this.pending = null;
  }
  _call(inputIds, logits) {
    const ids = inputIds[0];
    // A shorter prefix than last time means a new generate() call (the seek loop): the old one ended.
    if (ids.length <= this.lastLen) this.account(this.eosId);
    else if (this.pending) this.account(Number(ids[ids.length - 1]));
    this.pending = Float32Array.from(logits.data);
    this.firstStep ??= this.pending;
    this.lastLen = ids.length;
    return logits;
  }
  finish() {
    this.account(this.eosId);
    return { avgLogprob: this.count ? this.sum / this.count : null, tokens: this.count };
  }
}

/** A fresh list every call: Whisper's generate() pushes its own processors onto the list it is given. */
function listOf(processor) {
  const list = new LogitsProcessorList();
  list.push(processor);
  return list;
}

function eosOf(config) {
  return Array.isArray(config.eos_token_id) ? config.eos_token_id[0] : config.eos_token_id;
}

/**
 * Whisper's no-speech probability: softmax of the first decoder step after
 * <|startoftranscript|> alone, at the <|nospeech|> token (the id just below
 * <|notimestamps|> in every Whisper vocabulary). Costs one encoder pass and
 * one decoder step; timed separately from the transcription.
 */
async function noSpeechProb(samples) {
  const model = transcriber.model;
  const gen = model.generation_config;
  const sot = gen.decoder_start_token_id;
  const noSpeechId = gen.no_timestamps_token_id - 1;
  const { input_features: features } = await transcriber.processor(samples);
  const recorder = new Recorder(eosOf(gen));
  await model.generate({
    inputs: features,
    decoder_input_ids: [sot],
    max_new_tokens: 1,
    suppress_tokens: null,
    begin_suppress_tokens: null,
    return_timestamps: false,
    logits_processor: listOf(recorder),
  });
  const data = recorder.firstStep;
  if (!data) return null;
  let max = -Infinity;
  for (let i = 0; i < data.length; i += 1) if (data[i] > max) max = data[i];
  let acc = 0;
  for (let i = 0; i < data.length; i += 1) acc += Math.exp(data[i] - max);
  const p = Math.exp(data[noSpeechId] - max) / acc;
  return Number.isFinite(p) ? p : null;
}

const round3 = (v) => (v === null || v === undefined ? null : Math.round(v * 1000) / 1000);

/** One window (≤ 30 s of samples) through the recogniser. Times are relative to the samples. */
async function recognise(samples, { language, wordTimestamps, probe }) {
  const isWhisper = current.type === 'whisper' || current.type === 'lite-whisper';
  const started = performance.now();
  if (!isWhisper) {
    const out = await transcriber(samples);
    return { text: out.text ?? '', chunks: [], ms: performance.now() - started, probeMs: 0, noSpeechProb: null, avgLogprob: null, tokens: null };
  }
  const multilingual = transcriber.model.generation_config.is_multilingual !== false;
  const recorder = new Recorder(eosOf(transcriber.model.generation_config));
  const options = {
    ...(multilingual ? { language: language ?? null, task: 'transcribe' } : {}),
    return_timestamps: wordTimestamps ? 'word' : true,
    logits_processor: listOf(recorder),
  };
  const out = await transcriber(samples, options);
  const ms = performance.now() - started;
  const stats = recorder.finish();
  let probeMs = 0;
  let nsp = null;
  if (probe) {
    const probeStart = performance.now();
    nsp = await noSpeechProb(samples);
    probeMs = performance.now() - probeStart;
  }
  return {
    text: out.text ?? '',
    chunks: (out.chunks ?? []).map((c) => ({ text: c.text, start: c.timestamp?.[0] ?? null, end: c.timestamp?.[1] ?? null })),
    ms,
    probeMs,
    noSpeechProb: nsp,
    avgLogprob: stats.avgLogprob,
    tokens: stats.tokens,
  };
}

/**
 * `pre`:
 *  - 'none'   the whole file goes to the recogniser. Up to 30 s as one window
 *             (the September path); longer files through the library's own
 *             long-form path (30 s chunks, 5 s stride, merged by overlap).
 *  - 'silero' Silero VAD here → speech windows.
 *  - 'given'  `spans` from the driver (our own detector) → speech windows.
 */
export async function transcribe({ url, language, wordTimestamps = true, pre = 'none', spans = null, vadParams = null, probe = true, maxWindowS = 30 }) {
  if (!transcriber) throw new Error('no model loaded');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  const audio = decodeWav(await res.arrayBuffer());
  const audioS = audio.length / SAMPLE_RATE;
  const isWhisper = current.type === 'whisper' || current.type === 'lite-whisper';
  const started = performance.now();
  const result = { pre, audioS, vadMs: 0, probeMs: 0, windows: [], spans: null };
  const chunks = [];
  const texts = [];

  if (pre === 'none' && isWhisper && audioS > maxWindowS) {
    const multilingual = transcriber.model.generation_config.is_multilingual !== false;
    const out = await transcriber(audio, {
      ...(multilingual ? { language: language ?? null, task: 'transcribe' } : {}),
      return_timestamps: wordTimestamps ? 'word' : true,
      chunk_length_s: 30,
      stride_length_s: 5,
    });
    texts.push(out.text ?? '');
    for (const c of out.chunks ?? []) chunks.push({ text: c.text, start: c.timestamp?.[0] ?? null, end: c.timestamp?.[1] ?? null });
    result.longForm = 'pipeline chunk_length_s=30 stride_length_s=5';
  } else {
    let windows;
    if (pre === 'none') {
      // Fixed cuts with nothing removed (Moonshine has no long-form path of its own).
      windows = [];
      for (let from = 0; from < audioS; from += maxWindowS) windows.push({ pieces: [{ start: from, end: Math.min(audioS, from + maxWindowS) }] });
    } else {
      let speech = spans;
      let quietestAt = null;
      if (pre === 'silero') {
        const vadStart = performance.now();
        const probs = await vadProbs(audio);
        const frameS = VAD_HOP / SAMPLE_RATE;
        speech = spansFromProbs(probs, frameS, audioS, { ...DEFAULT_VAD, ...(vadParams ?? {}) });
        result.vadMs = performance.now() - vadStart;
        quietestAt = (from, to) => {
          let best = Math.floor(from / frameS);
          for (let i = best; i <= Math.min(probs.length - 1, Math.floor(to / frameS)); i += 1) if (probs[i] < probs[best]) best = i;
          return best * frameS;
        };
      }
      if (!speech) throw new Error(`pre=${pre} needs spans`);
      result.spans = speech.map((s) => ({ start: round3(s.start), end: round3(s.end) }));
      windows = packWindows(speech, { maxS: maxWindowS, quietestAt });
    }
    for (const window of windows) {
      const { samples, offsets, durationS } = windowAudio(audio, SAMPLE_RATE, window);
      if (samples.length < SAMPLE_RATE * 0.1) continue;
      const r = await recognise(samples, { language, wordTimestamps, probe });
      const first = window.pieces[0];
      const last = window.pieces[window.pieces.length - 1];
      const mapped = r.chunks.map((c) => ({
        text: c.text,
        start: c.start === null ? null : round3(toSourceTime(window, offsets, c.start)),
        end: c.end === null ? null : round3(toSourceTime(window, offsets, Math.min(c.end, durationS), true)),
      }));
      // No timestamps from the model (Moonshine): the window is the only time there is.
      if (mapped.length === 0 && r.text.trim()) mapped.push({ text: r.text, start: round3(first.start), end: round3(last.end), windowLevel: true });
      chunks.push(...mapped);
      texts.push(r.text);
      result.probeMs += r.probeMs;
      result.windows.push({
        pieces: window.pieces.map((p) => ({ start: round3(p.start), end: round3(p.end) })),
        speechS: round3(durationS),
        text: r.text,
        firstChunk: chunks.length - mapped.length,
        chunkCount: mapped.length,
        ms: Math.round(r.ms),
        probeMs: Math.round(r.probeMs),
        noSpeechProb: r.noSpeechProb === null ? null : Number(r.noSpeechProb.toFixed(4)),
        avgLogprob: r.avgLogprob === null ? null : Number(r.avgLogprob.toFixed(4)),
        tokens: r.tokens,
      });
    }
  }
  // The probe is a measurement of ours, not part of what would ship: keep it out of the speed figure.
  const ms = performance.now() - started - result.probeMs;
  return { ...result, text: texts.join(' ').replace(/\s+/g, ' ').trim(), chunks, ms, rtf: ms / 1000 / audioS };
}

export async function dispose() {
  if (transcriber) {
    try {
      await transcriber.dispose();
    } catch {
      // ORT sessions may already be released; nothing to clean.
    }
  }
  transcriber = null;
  current = null;
}

export function status() {
  return { loaded: current, version: env.version, vadLoaded: Boolean(vad) };
}
