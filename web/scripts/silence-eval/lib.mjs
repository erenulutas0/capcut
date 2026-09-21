/**
 * Shared helpers for the silence-detector evaluation (ADR-018 measurement gate).
 *
 * Everything here is local: ffmpeg/ffprobe on PATH, Node built-ins, and the
 * app's own `src/domain/silence.ts` transpiled on the fly (the detector under
 * test is the real one, not a copy).
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const here = dirname(fileURLToPath(import.meta.url));
export const webRoot = join(here, '..', '..');
export const speechDir = join(webRoot, 'tests', 'media', 'speech');
export const poolDir = join(speechDir, '.pool');
export const evalDir = join(speechDir, 'silence-eval');
export const resultsDir = join(webRoot, 'spike-results');

export const RATE = 48_000;

export function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { maxBuffer: 1024 * 1024 * 1024, ...opts });
  if (r.status !== 0 && !opts.allowFail) {
    throw new Error(`${cmd} ${args.join(' ')} failed:\n${r.stderr?.toString()}`);
  }
  return r;
}

/** Decodes any audio input to mono Float32 samples at 48 kHz with ffmpeg. */
export function decodeMono(inputArgs) {
  const r = sh('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...inputArgs, '-ac', '1', '-ar', String(RATE), '-f', 'f32le', '-']);
  const buf = r.stdout;
  const out = new Float32Array(buf.length / 4);
  for (let i = 0; i < out.length; i += 1) out[i] = buf.readFloatLE(i * 4);
  return out;
}

/** Writes mono 16-bit PCM WAV (digital zero stays exactly zero). */
export function writeWav16(path, samples, rate = RATE) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i += 1) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    data.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.concat([header, data]));
}

export function readWav16(path) {
  const buf = readFileSync(path);
  let off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'data') {
      const n = size / 2;
      const out = new Float32Array(n);
      for (let i = 0; i < n; i += 1) out[i] = buf.readInt16LE(off + 8 + i * 2) / 32767;
      return out;
    }
    off += 8 + size + (size % 2);
  }
  throw new Error(`no data chunk in ${path}`);
}

export const toDb = (power) => (power > 0 ? 10 * Math.log10(power) : -120);
export const fromDb = (db) => 10 ** (db / 20);

export function rmsDb(samples, from = 0, to = samples.length) {
  let sum = 0;
  for (let i = from; i < to; i += 1) sum += samples[i] * samples[i];
  return toDb(sum / Math.max(1, to - from));
}

/**
 * Sliding RMS (10 ms window) at 1 ms hop, in dB. Entry i covers
 * [i ms, i ms + 10 ms). Used only to build the ground truth from the CLEAN
 * speech stems, never as detector input.
 */
export function slidingRms1ms(samples) {
  const hop = RATE / 1000;
  const win = hop * 10;
  const hops = Math.floor(samples.length / hop);
  const hopPower = new Float64Array(hops);
  for (let h = 0; h < hops; h += 1) {
    let sum = 0;
    for (let i = h * hop; i < (h + 1) * hop; i += 1) sum += samples[i] * samples[i];
    hopPower[h] = sum / hop;
  }
  const out = new Float64Array(Math.max(0, hops - (win / hop) + 1));
  for (let h = 0; h < out.length; h += 1) {
    let sum = 0;
    for (let k = 0; k < 10; k += 1) sum += hopPower[h + k];
    out[h] = toDb(sum / 10);
  }
  return out;
}

export function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return NaN;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[index];
}

/**
 * Loudness envelope measured by ffmpeg: RMS of the mono mix per frame of
 * `frameSamples` samples at 48 kHz, -inf clamped to -120 dB. Only whole
 * frames are kept (the detector assumes equal frames).
 */
export function ffmpegEnvelope(file, frameSamples = 480, totalSamples = 0, workDir = evalDir) {
  mkdirSync(workDir, { recursive: true });
  const out = `env-${process.pid}-${frameSamples}.txt`;
  const filter = [
    `aresample=${RATE}`,
    'aformat=channel_layouts=mono',
    `asetnsamples=n=${frameSamples}:p=0`,
    'astats=metadata=1:reset=1',
    `ametadata=print:key=lavfi.astats.Overall.RMS_level:file=${out}`,
  ].join(',');
  sh('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-af', filter, '-f', 'null', '-'], { cwd: workDir });
  const text = readFileSync(join(workDir, out), 'utf8');
  const db = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /RMS_level=(.+)$/.exec(line);
    if (m) {
      const value = Number(m[1]);
      db.push(Number.isFinite(value) ? Math.max(-120, value) : -120);
    }
  }
  const whole = totalSamples ? Math.floor(totalSamples / frameSamples) : db.length;
  return db.slice(0, Math.min(db.length, whole));
}

/** Transpiles `src/domain/silence.ts` (type-only imports vanish) and imports it. */
export async function loadDetector(sourcePath = join(webRoot, 'src', 'domain', 'silence.ts'), workDir = join(evalDir, '.detector')) {
  const ts = (await import('typescript')).default;
  const source = readFileSync(sourcePath, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  if (/from '\.\//.test(outputText)) throw new Error('silence.ts gained a runtime import; extend loadDetector');
  mkdirSync(workDir, { recursive: true });
  const target = join(workDir, `silence-${Date.now()}.mjs`);
  writeFileSync(target, outputText);
  return import(pathToFileURL(target).href);
}

/** Small deterministic PRNG (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
