/// <reference lib="webworker" />

/**
 * The recogniser of "Yazıya dök" (ADR-036): the October spike's shipping
 * combination (docs/spikes/2026-10-03-asr-on-device-english.md §1), ported
 * from `web/spike/asr/engine.js` step for step:
 *
 *  1. Silero VAD with its published defaults → speech spans;
 *  2. every span recognised ON ITS OWN (a span over 30 s is cut at its
 *     quietest point);
 *  3. a span whose mean token log-probability is under −0.75, or whose text
 *     is a repetition loop (zlib ratio over 2.4), is not shown: it becomes
 *     an "(anlaşılamadı)" span — never deleted, never replaced by a guess;
 *  4. the decoder cache Transformers.js leaks is released after every span;
 *  5. the constant lateness of the word times is taken out.
 *
 * Loaded only by the transcript worker, and only when a transcription
 * starts: Transformers.js and onnxruntime-web are in a chunk of their own.
 *
 * NOTHING here talks to the network. The library's `fetch` is replaced by a
 * reader of the verified files in the model store; a file that is not there
 * answers 404, it is not looked for anywhere else. The WebAssembly binary of
 * onnxruntime-web is handed over as bytes from the same store.
 */

import { US_PER_SECOND } from '@/domain/time';
import {
  VAD_CONTEXT,
  VAD_FRAME_S,
  VAD_HOP,
  VAD_SAMPLE_RATE,
  quietestFrameTime,
  spansFromProbs,
  splitLongSpans,
  type SpeechSpan,
} from '@/domain/speechSpans';
import { LevelNormaliser, atFullLevel } from '@/domain/levelNormalise';
import { buildSegment, spanVerdict, type RecognisedChunk, type SpanEvidence, type TranscriptSegment } from '@/domain/transcript';
import { settingsFromProbe, type EngineProbe } from '@/domain/transcriptSettings';
import {
  MODEL_RUNTIME,
  filesFor,
  type ModelManifest,
  type StoredFileRef,
  type TranscriptModelId,
} from '@/domain/transcriptModels';
import { AudioFeedError, openAudio, streamMono16k } from './audioFeed';
import { EngineError, type EngineSink } from './engine.types';
import { readModelFile } from './modelStore';
import type { AttemptTrace, SpanTrace, TranscribeStats } from './protocol';
import { SlidingAudio } from './slidingAudio';

/** The library reads model files from this made-up host; nothing is ever sent to it. */
const STORE_HOST = 'https://clip-model-store.invalid/';

/** Shorter than this a span is not worth a recogniser call (the spike's rule). */
const MIN_SPAN_SAMPLES = VAD_SAMPLE_RATE * 0.1;

/** Progress is posted at most this often while listening. */
const PROGRESS_INTERVAL_MS = 150;

// The parts of Transformers.js this file uses, typed as far as it relies on them.
interface TfTensor {
  data: Float32Array;
}
interface TfModule {
  env: {
    allowLocalModels: boolean;
    allowRemoteModels: boolean;
    useBrowserCache: boolean;
    useCustomCache: boolean;
    useWasmCache: boolean;
    remoteHost: string;
    remotePathTemplate: string;
    fetch: (input: string | URL, init?: RequestInit) => Promise<Response>;
    backends: { onnx: { wasm: { numThreads?: number; wasmBinary?: ArrayBuffer; wasmPaths?: unknown; proxy?: boolean } } };
  };
  Tensor: new (type: string, data: unknown, dims: number[]) => TfTensor;
  LogitsProcessor: new () => object;
  LogitsProcessorList: new () => { push(processor: object): void };
  AutoModel: { from_pretrained(id: string, options: Record<string, unknown>): Promise<VadModel> };
  pipeline(task: string, id: string, options: Record<string, unknown>): Promise<Transcriber>;
}
type VadModel = ((inputs: Record<string, TfTensor>) => Promise<{ stateN: TfTensor; output: TfTensor }>) & {
  dispose?: () => Promise<unknown>;
};
interface WhisperOutput {
  text?: string;
  chunks?: { text: string; timestamp?: [number | null, number | null] }[];
}
interface Transcriber {
  (samples: Float32Array, options: Record<string, unknown>): Promise<WhisperOutput>;
  model: { generation_config: { eos_token_id: number | number[] } };
  tokenizer: { decode(ids: number[]): string };
  dispose(): Promise<unknown>;
}

/**
 * Transformers.js 4.3.0 keeps the decoder's key/value cache alive whenever
 * `return_dict_in_generate` is set — which Whisper's generate() sets for word
 * timestamps — and nothing downstream ever disposes it; on WebGPU those are
 * GPU buffers, one leaked per generate() call (spike §6.5: 10 GiB on 13
 * minutes). The base generate() is wrapped once so the caches it hands back
 * are remembered and released after each span.
 */
const leakedCaches: { dispose(): Promise<unknown> }[] = [];
function trackDecoderCaches(model: object): void {
  let proto = Object.getPrototypeOf(model) as Record<string, unknown> | null;
  let base: Record<string, unknown> | null = null;
  while (proto) {
    if (Object.prototype.hasOwnProperty.call(proto, 'generate')) base = proto;
    proto = Object.getPrototypeOf(proto) as Record<string, unknown> | null;
  }
  if (!base || base.clipTracksCaches) return;
  const original = base.generate as (...args: unknown[]) => Promise<unknown>;
  base.generate = async function generate(this: unknown, ...args: unknown[]) {
    const out = (await original.apply(this, args)) as { past_key_values?: { dispose?: () => Promise<unknown> } } | null;
    const cache = out && typeof out === 'object' ? out.past_key_values : undefined;
    if (cache && typeof cache.dispose === 'function') leakedCaches.push(cache as { dispose(): Promise<unknown> });
    return out;
  };
  base.clipTracksCaches = true;
}
async function freeDecoderCaches(): Promise<void> {
  for (const cache of leakedCaches.splice(0)) await cache.dispose().catch(() => undefined);
}

/** UTF-8 bytes of the text / bytes after zlib (Whisper's own loop test). */
async function compressionRatio(text: string): Promise<number | null> {
  if (!text) return null;
  const bytes = new TextEncoder().encode(text);
  if (bytes.length === 0) return null;
  const packed = await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer();
  return bytes.length / packed.byteLength;
}

function isOutOfMemory(error: unknown): boolean {
  const text = `${(error as { message?: unknown } | null)?.message ?? error}`;
  return error instanceof RangeError || /out of memory|bad_alloc|allocation failed|OOM/i.test(text);
}

/** WebGPU with half-precision shaders: what the large model's files need. */
async function hasWebGpuF16(): Promise<boolean> {
  try {
    const gpu = (navigator as { gpu?: { requestAdapter(): Promise<{ features: { has(name: string): boolean } } | null> } }).gpu;
    const adapter = await gpu?.requestAdapter();
    return Boolean(adapter?.features.has('shader-f16'));
  } catch {
    return false;
  }
}

export async function transcribeFile(
  file: File,
  model: TranscriptModelId,
  manifest: ModelManifest,
  sink: EngineSink,
  probe?: EngineProbe,
): Promise<TranscribeStats> {
  const started = performance.now();
  const runtime = MODEL_RUNTIME[model];
  const settings = settingsFromProbe(probe);

  // ---- the sound first: a video without sound needs no model at all
  let audio;
  try {
    audio = await openAudio(file);
  } catch (error) {
    throw new EngineError(error instanceof AudioFeedError ? error.reason : 'unreadable');
  }

  let transcriber: Transcriber | null = null;
  let vad: VadModel | null = null;
  try {
    // ---- the model files, from this browser's store only
    sink.progress({ phase: 'loading' });
    const files = filesFor(model, manifest);
    const blobs = new Map<string, Blob>();
    for (const ref of files) {
      const blob = await readModelFile(ref, manifest);
      if (!blob) throw new EngineError('model_missing');
      blobs.set(ref.key, blob);
    }
    const runtimeRef = files.find((ref: StoredFileRef) => ref.group === 'runtime' && ref.path.endsWith('.wasm'));
    if (!runtimeRef) throw new EngineError('model_missing');
    if (typeof WebAssembly === 'undefined') throw new EngineError('engine_unavailable');
    if (runtime.device === 'webgpu' && !(await hasWebGpuF16())) throw new EngineError('engine_unavailable');

    const tf = (await import('@huggingface/transformers')) as unknown as TfModule;
    const { env } = tf;
    env.allowLocalModels = false;
    env.allowRemoteModels = true;
    env.useBrowserCache = false;
    env.useCustomCache = false;
    env.useWasmCache = false;
    env.remoteHost = STORE_HOST;
    env.remotePathTemplate = '{model}/';
    env.fetch = async (input) => {
      const url = String(input);
      const blob = url.startsWith(STORE_HOST) ? blobs.get(url.slice(STORE_HOST.length)) : undefined;
      if (!blob) return new Response(null, { status: 404, statusText: 'Not in the model store' });
      return new Response(blob, { status: 200, headers: { 'Content-Length': String(blob.size) } });
    };
    const wasm = env.backends.onnx.wasm;
    wasm.wasmBinary = await (blobs.get(runtimeRef.key) as Blob).arrayBuffer();
    // The glue code is part of the app's own bundle; no address to load it from.
    wasm.wasmPaths = undefined;
    // GitHub Pages cannot send the headers threads need; one thread is what was measured (spike §6.6).
    wasm.numThreads = 1;
    wasm.proxy = false;

    const loadStart = performance.now();
    try {
      vad = await tf.AutoModel.from_pretrained(manifest.groups.vad.dir, {
        config: { model_type: 'custom' },
        dtype: 'fp32',
        device: 'wasm',
      });
      transcriber = await tf.pipeline('automatic-speech-recognition', manifest.groups[model].dir, {
        device: runtime.device,
        dtype: runtime.dtype,
      });
    } catch (error) {
      if (error instanceof EngineError) throw error;
      throw new EngineError(isOutOfMemory(error) ? 'out_of_memory' : 'engine_unavailable');
    }
    trackDecoderCaches(transcriber.model);
    const loadMs = performance.now() - loadStart;

    // ---- pass 1: where is the speech? (only the probabilities are kept: 31 numbers per second)
    const listenStart = performance.now();
    const totalUs = Math.max(0, Math.round(audio.durationS * US_PER_SECOND));
    const probs: number[] = [];
    const sr = new tf.Tensor('int64', BigInt64Array.from([BigInt(VAD_SAMPLE_RATE)]), []);
    let state = new tf.Tensor('float32', new Float32Array(2 * 1 * 128), [2, 1, 128]);
    const frame = new Float32Array(VAD_CONTEXT + VAD_HOP);
    const hop = new Float32Array(VAD_HOP);
    let hopFill = 0;
    let lastPost = 0;
    const vadModel = vad;
    const vadStep = async () => {
      // The last 64 samples of the previous step in front (zeros before the first).
      frame.copyWithin(0, VAD_HOP, VAD_HOP + VAD_CONTEXT);
      frame.set(hop, VAD_CONTEXT);
      const out = await vadModel({ input: new tf.Tensor('float32', frame, [1, frame.length]), sr, state });
      state = out.stateN;
      probs.push(out.output.data[0] as number);
    };
    const hear = async (samples: Float32Array) => {
      let at = 0;
      while (at < samples.length) {
        const take = Math.min(VAD_HOP - hopFill, samples.length - at);
        hop.set(samples.subarray(at, at + take), hopFill);
        hopFill += take;
        at += take;
        if (hopFill === VAD_HOP) {
          await vadStep();
          hopFill = 0;
        }
      }
    };
    // The detector hears a level-normalised copy (quiet speech after loud sound is not skipped);
    // what the recogniser is given later is cut from the sound as decoded.
    const leveller = settings.level ? new LevelNormaliser(VAD_SAMPLE_RATE, settings.level) : null;
    sink.progress({ phase: 'listening', doneUs: 0, totalUs });
    const totalSamples = await streamMono16k(audio.track, async (samples) => {
      await hear(leveller ? leveller.push(samples) : samples);
      const now = performance.now();
      if (now - lastPost >= PROGRESS_INTERVAL_MS) {
        lastPost = now;
        const doneUs = Math.round(probs.length * VAD_FRAME_S * US_PER_SECOND);
        sink.progress({ phase: 'listening', doneUs: Math.min(doneUs, totalUs || doneUs), totalUs: totalUs || doneUs });
      }
    });
    if (leveller) await hear(leveller.flush());
    const audioS = totalSamples / VAD_SAMPLE_RATE;
    const audioUs = Math.round(audioS * US_PER_SECOND);
    const spans = spansFromProbs(probs, VAD_FRAME_S, audioS, settings.vad);
    const pieces = splitLongSpans(spans, (from, to) => quietestFrameTime(probs, VAD_FRAME_S, from, to)).filter(
      (piece) => Math.round(piece.end * VAD_SAMPLE_RATE) - Math.round(piece.start * VAD_SAMPLE_RATE) >= MIN_SPAN_SAMPLES,
    );
    const listenMs = performance.now() - listenStart;
    sink.progress({ phase: 'listening', doneUs: audioUs, totalUs: audioUs });

    // ---- pass 2: every span on its own through the recogniser
    const writeStart = performance.now();
    const eosRaw = transcriber.model.generation_config.eos_token_id;
    const eosId = Array.isArray(eosRaw) ? (eosRaw[0] as number) : eosRaw;

    /**
     * Sits in the logits processor list and keeps what Transformers.js does
     * not return: the log-probability of every token the decoder went on to
     * pick. It sees the logits after `suppress_tokens` and before the
     * timestamp rules (the spike's Recorder).
     */
    class Recorder extends tf.LogitsProcessor {
      pending: Float32Array | null = null;
      lastLen = 0;
      sum = 0;
      count = 0;
      ids: number[] = [];
      logprobs: number[] = [];
      account(token: number): void {
        const data = this.pending;
        if (!data) return;
        let max = -Infinity;
        for (let i = 0; i < data.length; i += 1) if ((data[i] as number) > max) max = data[i] as number;
        let acc = 0;
        for (let i = 0; i < data.length; i += 1) acc += Math.exp((data[i] as number) - max);
        const logProb = (data[token] as number) - max - Math.log(acc);
        if (Number.isFinite(logProb)) {
          this.sum += logProb;
          this.count += 1;
          this.ids.push(token);
          this.logprobs.push(logProb);
        }
        this.pending = null;
      }
      _call(inputIds: ArrayLike<number | bigint>[], logits: TfTensor): TfTensor {
        const ids = inputIds[0] as ArrayLike<number | bigint>;
        // A shorter prefix than last time means a new generate() call: the old one ended.
        if (ids.length <= this.lastLen) this.account(eosId);
        else if (this.pending) this.account(Number(ids[ids.length - 1]));
        this.pending = Float32Array.from(logits.data);
        this.lastLen = ids.length;
        return logits;
      }
      finish(): number | null {
        this.account(eosId);
        return this.count ? this.sum / this.count : null;
      }
    }

    const speaker = transcriber;
    interface Heard {
      chunks: RecognisedChunk[];
      evidence: SpanEvidence;
      tokens: { ids: number[]; logprobs: number[] };
    }
    /** One call of the recogniser on one stretch of sound. */
    const recognise = async (samples: Float32Array): Promise<Heard> => {
      const recorder = new Recorder();
      // A fresh list every call: Whisper's generate() pushes its own processors onto the list it is given.
      const list = new tf.LogitsProcessorList();
      list.push(recorder);
      let out: WhisperOutput;
      try {
        out = await speaker(settings.spanLevel ? atFullLevel(samples, VAD_SAMPLE_RATE) : samples, {
          language: 'en',
          task: 'transcribe',
          return_timestamps: 'word',
          logits_processor: list,
        });
      } catch (error) {
        throw new EngineError(isOutOfMemory(error) ? 'out_of_memory' : 'internal_error');
      } finally {
        await freeDecoderCaches();
      }
      const text = out.text ?? '';
      const chunks: RecognisedChunk[] = (out.chunks ?? []).map((chunk) => ({
        text: chunk.text,
        start: chunk.timestamp?.[0] ?? null,
        end: chunk.timestamp?.[1] ?? null,
      }));
      const avgLogprob = recorder.finish();
      return {
        chunks,
        evidence: { text, avgLogprob, compressionRatio: await compressionRatio(text) },
        tokens: { ids: recorder.ids, logprobs: recorder.logprobs },
      };
    };

    /** The sound between the oldest sample still needed and the newest decoded. */
    const sound = new SlidingAudio();
    const labPads = (probe?.lab?.padS ?? []).filter((value) => Number.isFinite(value) && value > 0);
    const reachSamples = Math.round(Math.max(0, ...labPads) * VAD_SAMPLE_RATE);
    const trace: SpanTrace[] = [];
    const tracing = probe?.trace === true;
    const tokenText = (id: number): string => {
      try {
        return speaker.tokenizer.decode([id]);
      } catch {
        return '';
      }
    };
    const traced = (kind: string, span: SpeechSpan, heard: Heard): AttemptTrace => ({
      kind,
      startS: span.start,
      endS: span.end,
      text: heard.evidence.text,
      avgLogprob: heard.evidence.avgLogprob,
      compressionRatio: heard.evidence.compressionRatio,
      verdict: spanVerdict(heard.evidence),
      words: heard.chunks.map((chunk) => ({ text: chunk.text, start: chunk.start, end: chunk.end })),
      tokens: heard.tokens.ids.map((id, k) => ({ text: tokenText(id), logprob: Number((heard.tokens.logprobs[k] as number).toFixed(4)) })),
    });
    const cut = (span: SpeechSpan): Float32Array => {
      const from = Math.max(0, Math.round(span.start * VAD_SAMPLE_RATE));
      const to = Math.min(totalSamples, Math.round(span.end * VAD_SAMPLE_RATE));
      const samples = sound.slice(from, to);
      return samples.length > 0 ? samples : new Float32Array(1);
    };
    const unclearOver = (span: SpeechSpan): TranscriptSegment => {
      const startUs = Math.round(span.start * US_PER_SECOND);
      return { startUs, endUs: Math.max(startUs, Math.round(span.end * US_PER_SECOND)), state: 'unclear', words: [] };
    };

    let spansDone = 0;
    let unclearSpans = 0;
    let unclearUs = 0;
    let speechUs = 0;
    let secondLooks = 0;
    let rescuedUs = 0;
    const emit = (segment: TranscriptSegment) => {
      if (segment.state === 'unclear') {
        unclearSpans += 1;
        unclearUs += segment.endUs - segment.startUs;
      }
      speechUs += segment.endUs - segment.startUs;
      sink.segment(segment);
    };

    /**
     * A span the guard dropped, looked at again: cut in two at its quietest
     * point, each half recognised and judged ON ITS OWN by the same guard. A
     * half that passes is written; a half that does not stays
     * "(anlaşılamadı)". Nothing is accepted on a weaker test than the first
     * attempt's.
     */
    const lookAgain = async (span: SpeechSpan, depth: number, attempts: AttemptTrace[]): Promise<TranscriptSegment[]> => {
      const rule = settings.secondLook;
      if (!rule || depth >= rule.maxDepth || span.end - span.start < rule.splitMinS) return [unclearOver(span)];
      const quarter = (span.end - span.start) / 4;
      const at = quietestFrameTime(probs, VAD_FRAME_S, span.start + quarter, span.end - quarter);
      if (!(at > span.start && at < span.end)) return [unclearOver(span)];
      const out: TranscriptSegment[] = [];
      for (const half of [
        { start: span.start, end: at },
        { start: at, end: span.end },
      ]) {
        if (Math.round((half.end - half.start) * VAD_SAMPLE_RATE) < MIN_SPAN_SAMPLES) {
          out.push(unclearOver(half));
          continue;
        }
        secondLooks += 1;
        const heard = await recognise(cut(half));
        if (tracing) attempts.push(traced(`look:${depth + 1}`, half, heard));
        const segment = buildSegment(half, heard.chunks, heard.evidence, runtime.timingOffset);
        if (segment.state === 'ok') {
          rescuedUs += segment.endUs - segment.startUs;
          out.push(segment);
        } else {
          out.push(...(await lookAgain(half, depth + 1, attempts)));
        }
      }
      // Neighbouring halves that both stayed unclear are one unclear stretch again.
      const joined: TranscriptSegment[] = [];
      for (const segment of out) {
        const last = joined[joined.length - 1];
        if (last && last.state === 'unclear' && segment.state === 'unclear' && segment.startUs <= last.endUs) {
          last.endUs = Math.max(last.endUs, segment.endUs);
        } else {
          joined.push(segment);
        }
      }
      return joined;
    };

    /** Lab only: what other second attempts WOULD have said about a dropped span. Recorded, never used. */
    const labAttempts = async (span: SpeechSpan, attempts: AttemptTrace[]) => {
      for (const pad of labPads) {
        const wide = { start: Math.max(0, span.start - pad), end: Math.min(audioS, span.end + pad) };
        attempts.push(traced(`lab-pad:${pad}`, wide, await recognise(cut(wide))));
      }
      if (!probe?.lab?.split || settings.secondLook) return;
      const walk = async (part: SpeechSpan, depth: number): Promise<void> => {
        if (depth >= 2 || part.end - part.start < 2) return;
        const quarter = (part.end - part.start) / 4;
        const at = quietestFrameTime(probs, VAD_FRAME_S, part.start + quarter, part.end - quarter);
        if (!(at > part.start && at < part.end)) return;
        for (const half of [
          { start: part.start, end: at },
          { start: at, end: part.end },
        ]) {
          const again = await recognise(cut(half));
          attempts.push(traced(`lab-split:${depth + 1}`, half, again));
          if (spanVerdict(again.evidence) === 'unclear') await walk(half, depth + 1);
        }
      };
      await walk(span, 0);
    };

    const handle = async (span: SpeechSpan) => {
      const heard = await recognise(cut(span));
      const attempts: AttemptTrace[] = tracing ? [traced('first', span, heard)] : [];
      const segment = buildSegment(span, heard.chunks, heard.evidence, runtime.timingOffset);
      if (segment.state === 'ok') {
        emit(segment);
      } else {
        for (const part of await lookAgain(span, 0, attempts)) emit(part);
        if (tracing && probe?.lab) await labAttempts(span, attempts);
      }
      if (tracing) trace.push({ startS: span.start, endS: span.end, attempts });
      spansDone += 1;
      sink.progress({ phase: 'writing', spansDone, spansTotal: pieces.length });
    };

    sink.progress({ phase: 'writing', spansDone: 0, spansTotal: pieces.length });
    if (pieces.length > 0) {
      let index = 0;
      const startOf = (k: number) => Math.max(0, Math.round((pieces[k] as SpeechSpan).start * VAD_SAMPLE_RATE) - reachSamples);
      const endOf = (k: number) => Math.min(totalSamples, Math.round((pieces[k] as SpeechSpan).end * VAD_SAMPLE_RATE) + reachSamples);
      sound.dropBefore(startOf(0));
      const work = async (atEnd: boolean) => {
        while (index < pieces.length && (atEnd || sound.end >= endOf(index))) {
          await handle(pieces[index] as SpeechSpan);
          index += 1;
          sound.dropBefore(index < pieces.length ? startOf(index) : sound.end);
        }
      };
      await streamMono16k(audio.track, async (samples, first) => {
        sound.append(samples, first);
        await work(false);
      });
      // The second decode came up short of the first (it should not): what was collected is still recognised.
      await work(true);
    }
    const writeMs = performance.now() - writeStart;

    return {
      model,
      device: runtime.device,
      audioUs,
      speechUs,
      spans: pieces.length,
      unclearSpans,
      unclearUs,
      secondLooks,
      rescuedUs,
      loadMs: Math.round(loadMs),
      listenMs: Math.round(listenMs),
      writeMs: Math.round(writeMs),
      totalMs: Math.round(performance.now() - started),
      ...(tracing ? { trace: { settings, probs: probs.map((value) => Number(value.toFixed(3))), spans: trace } } : {}),
    };
  } catch (error) {
    if (error instanceof EngineError) throw error;
    if (error instanceof AudioFeedError) throw new EngineError(error.reason);
    throw new EngineError(isOutOfMemory(error) ? 'out_of_memory' : 'internal_error');
  } finally {
    await freeDecoderCaches();
    await transcriber?.dispose().catch(() => undefined);
    await vad?.dispose?.().catch(() => undefined);
    audio.input.dispose();
  }
}
