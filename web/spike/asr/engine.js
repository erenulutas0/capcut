/**
 * The part that would ship: load a Whisper pipeline with Transformers.js and
 * transcribe 16 kHz float audio. Runs identically inside a Web Worker
 * (worker.js) or on the main thread (bench.js with ?worker=0).
 *
 * Model files come from the local mirror on this same origin, laid out like
 * the Hugging Face hub (`{model}/resolve/{revision}/…`), so `env.remoteHost`
 * is the only difference from a hub download.
 */
import { env, pipeline } from './node_modules/@huggingface/transformers/dist/transformers.js';

const origin = self.location.origin;
env.allowLocalModels = false;
env.remoteHost = `${origin}/models/`;
env.remotePathTemplate = '{model}/resolve/{revision}/';
env.backends.onnx.wasm.wasmPaths = `${origin}/node_modules/onnxruntime-web/dist/`;

let transcriber = null;
let current = null;

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
      if (fmt.sampleRate !== 16000) throw new Error(`expected 16 kHz, got ${fmt.sampleRate}`);
      const start = off + 8;
      const frames = size / (fmt.channels * (fmt.bits / 8));
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

export async function load({ model, revision, device, dtype }) {
  await dispose();
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
  current = { model, revision, device, dtype };
  return { loadMs, files: [...files.values()] };
}

export async function transcribe({ url, language, wordTimestamps }) {
  if (!transcriber) throw new Error('no model loaded');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  const audio = decodeWav(await res.arrayBuffer());
  const audioS = audio.length / 16000;
  const started = performance.now();
  const options = {
    language: language ?? null,
    task: 'transcribe',
    return_timestamps: wordTimestamps ? 'word' : true,
  };
  const out = await transcriber(audio, options);
  const ms = performance.now() - started;
  return {
    text: out.text ?? '',
    chunks: (out.chunks ?? []).map((c) => ({ text: c.text, start: c.timestamp?.[0] ?? null, end: c.timestamp?.[1] ?? null })),
    ms,
    audioS,
    rtf: ms / 1000 / audioS,
  };
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
  return { loaded: current, version: env.version };
}
