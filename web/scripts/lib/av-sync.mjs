/**
 * Sound-against-picture measurements of exported files (ADR-032).
 *
 * Every read decodes the way a player that starts at the beginning does:
 * ffmpeg, edit lists applied, and NO input seek near the start. ffmpeg's
 * `-ss` before `-i`, on a file whose audio edit list hides encoder priming
 * (every Android export: 2048 frames; ffmpeg's own AAC files: 1024), drops
 * the priming a second time when the seek lands inside it (`-ss 0` up to
 * the priming's length): the sound then reads 42.67 ms early although the
 * file is in sync. That is what the first phone run of the live ADR-032
 * build showed.
 *
 * The sync clip: black 1080×1920 30 fps video with one white frame at each
 * event, and a short chirp whose first sample falls on that frame's start.
 * Events are irregular (6–13 frames apart) so neither a picture nor a sound
 * search can lock onto the wrong one. `avSync(file)` pairs every white frame
 * of an export with the nearest sound onset: in sync, the offset is a
 * fraction of a millisecond; sound late is positive.
 *
 *   node scripts/lib/av-sync.mjs <out.mp4>              # writes the sync clip
 *   node scripts/lib/av-sync.mjs --measure <export.mp4> # avSync + audioLayout
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

export const SYNC_FPS = 30;
export const SYNC_RATE = 48_000;
export const SYNC_SECONDS = 12;

const GAPS = [7, 11, 8, 13, 9, 6, 12, 10];

/** Event frame indices (at 30 fps) of the source clip. */
export function syncEventFrames() {
  const frames = [];
  for (let frame = 9, i = 0; frame < SYNC_SECONDS * SYNC_FPS - 6; frame += GAPS[i % GAPS.length], i += 1) frames.push(frame);
  return frames;
}

/** One chirp, 30 ms, 800 Hz → 5 kHz, a 0.5 ms rise (a sharp onset) and a 10 ms fade. */
function chirp(rate) {
  const n = Math.round(0.03 * rate);
  const rise = Math.round(0.0005 * rate);
  const fall = Math.round(0.01 * rate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const t = i / rate;
    const phase = 2 * Math.PI * (800 * t + ((5000 - 800) * t * t) / (2 * 0.03));
    const envelope = Math.min(1, i / rise, (n - i) / fall);
    out[i] = 0.6 * envelope * Math.sin(phase);
  }
  return out;
}

function wav(samples, rate, channels) {
  const frames = samples.length;
  const data = Buffer.alloc(frames * channels * 2);
  for (let i = 0; i < frames; i += 1) {
    const v = Math.max(-1, Math.min(1, samples[i])) * 32767;
    for (let c = 0; c < channels; c += 1) data.writeInt16LE(Math.round(v), (i * channels + c) * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** Writes the source clip (H.264 High, keyframe every second, AAC 192 kbit/s). */
export function writeSyncClip(path) {
  const pcm = new Float32Array(SYNC_SECONDS * SYNC_RATE);
  const burst = chirp(SYNC_RATE);
  for (const frame of syncEventFrames()) pcm.set(burst, Math.round((frame * SYNC_RATE) / SYNC_FPS));
  const dir = join(tmpdir(), `sync-clicks-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  const audio = join(dir, 'clicks.wav');
  writeFileSync(audio, wav(pcm, SYNC_RATE, 2));
  const enable = syncEventFrames()
    .map((frame) => `eq(n\\,${frame})`)
    .join('+');
  mkdirSync(dirname(path), { recursive: true });
  const result = spawnSync(
    'ffmpeg',
    [
      '-v', 'error', '-y',
      '-f', 'lavfi', '-i', `color=c=black:s=1080x1920:r=${SYNC_FPS}:d=${SYNC_SECONDS}`,
      '-i', audio,
      '-vf', `drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='${enable}'`,
      '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-g', String(SYNC_FPS), '-keyint_min', String(SYNC_FPS),
      '-sc_threshold', '0', '-crf', '23',
      '-c:a', 'aac', '-b:a', '192k',
      '-movflags', '+faststart', '-shortest',
      path,
    ],
    { encoding: 'utf8' },
  );
  rmSync(dir, { recursive: true, force: true });
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${result.stderr}`);
  return path;
}

/** Mean luma of every frame (16×16 grey), in decode order with pts. */
function frameLumas(file) {
  const probe = spawnSync(
    'ffprobe',
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'frame=pts_time', '-of', 'csv=p=0', file],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  const times = probe.stdout.trim().split(/\r?\n/).map(Number);
  const raw = spawnSync(
    'ffmpeg',
    ['-v', 'error', '-i', file, '-map', '0:v:0', '-fps_mode', 'passthrough', '-vf', 'scale=16:16,format=gray', '-f', 'rawvideo', '-'],
    { maxBuffer: 256 * 1024 * 1024 },
  ).stdout;
  const lumas = [];
  for (let i = 0; i * 256 < raw.length; i += 1) {
    let sum = 0;
    for (let j = 0; j < 256; j += 1) sum += raw[i * 256 + j];
    lumas.push({ timeS: times[i], luma: sum / 256 });
  }
  return lumas;
}

/** The audio stream's start (s) after its edit list: where its first decoded sample plays. */
function audioStartS(file) {
  const out = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=start_time', '-of', 'csv=p=0', file], {
    encoding: 'utf8',
  });
  const value = Number(out.stdout.trim());
  return Number.isFinite(value) ? value : 0;
}

/**
 * Mono 48 kHz PCM of `seconds` (all when null) from `startS` on the file's
 * timeline, edit lists applied. Starts before 1 s are decoded from the
 * beginning and cut here, so ffmpeg's input seek never lands inside the
 * priming (see the top); a stream that starts after 0 (a phone recording's
 * audio can start 2 ms in) is placed at its start time, as `-ss` does.
 */
export function pcm48(file, startS = 0, seconds = null) {
  const fromStart = startS < 1;
  const seek = fromStart ? [] : ['-ss', String(startS)];
  const length = seconds === null ? [] : ['-t', String(seconds + (fromStart ? startS : 0))];
  const out =
    spawnSync('ffmpeg', ['-v', 'error', ...seek, ...length, '-i', file, '-map', '0:a:0', '-ac', '1', '-ar', String(SYNC_RATE), '-f', 'f32le', '-'], {
      maxBuffer: 1024 * 1024 * 1024,
    }).stdout ?? Buffer.alloc(0);
  const decoded = new Float32Array(out.buffer, out.byteOffset, Math.floor(out.length / 4));
  if (!fromStart) return decoded;
  // Index 0 = file time 0, then cut at startS.
  const lead = Math.round(audioStartS(file) * SYNC_RATE) - Math.round(startS * SYNC_RATE);
  if (lead >= 0) {
    const padded = new Float32Array(lead + decoded.length);
    padded.set(decoded, lead);
    return seconds === null ? padded : padded.subarray(0, Math.round(seconds * SYNC_RATE));
  }
  return decoded.subarray(-lead);
}

/** Mono PCM at 48 kHz, decoded from the start like a player (no input seek). */
export function decodeFromStart(file) {
  return pcm48(file, 0, null);
}

/**
 * The audio track as written: first packets' times, the stream start and
 * the priming skip ffmpeg reads from the edit list, and the frames a player
 * decodes from the start.
 */
export function audioLayout(file) {
  const packets = spawnSync(
    'ffprobe',
    ['-v', 'error', '-select_streams', 'a:0', '-show_packets', '-read_intervals', '%+#3', '-show_entries', 'packet=pts,duration:packet_side_data=skip_samples', '-of', 'json', file],
    { encoding: 'utf8' },
  );
  const stream = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=start_time,duration,nb_frames', '-of', 'json', file], {
    encoding: 'utf8',
  });
  const first = JSON.parse(packets.stdout || '{}').packets ?? [];
  const info = JSON.parse(stream.stdout || '{}').streams?.[0] ?? {};
  return {
    startTime: Number(info.start_time),
    packets: Number(info.nb_frames),
    firstPts: first.map((p) => Number(p.pts)),
    skipSamples: Number(first[0]?.side_data_list?.find((d) => 'skip_samples' in d)?.skip_samples ?? 0),
    decodedFrames: decodeFromStart(file).length,
  };
}

/**
 * Where the export's sound sits against the source's: a 1 s window of the
 * source (0.2 s into the first kesit) looked for in the export's first 2 s,
 * ±4096 frames; positive = the sound is late. null for a silent source,
 * `ambiguous` for a steady tone (it matches at every period).
 */
export function audioSync(source, startS, output) {
  const ref = pcm48(source, startS, 2);
  const out = pcm48(output, 0, 2);
  const from = 9600;
  const length = 48000;
  const window = ref.subarray(from, from + length);
  let energy = 0;
  for (const v of window) energy += v * v;
  if (window.length < length || Math.sqrt(energy / length) < 1e-4) return null;
  const correlations = [];
  let best = { lagFrames: 0, correlation: -1 };
  for (let lag = -4096; lag <= 4096; lag += 1) {
    let dot = 0;
    let outEnergy = 0;
    for (let i = 0; i < length; i += 1) {
      const v = out[from + lag + i] ?? 0;
      dot += window[i] * v;
      outEnergy += v * v;
    }
    const correlation = outEnergy > 0 ? dot / Math.sqrt(energy * outEnergy) : 0;
    correlations.push({ lag, correlation });
    if (correlation > best.correlation) best = { lagFrames: lag, correlation };
  }
  const runnerUp = Math.max(...correlations.filter((c) => Math.abs(c.lag - best.lagFrames) > 20).map((c) => c.correlation));
  if (runnerUp >= best.correlation - 0.02) return { ambiguous: true, correlation: Number(best.correlation.toFixed(4)) };
  return { lagMs: Number(((best.lagFrames / SYNC_RATE) * 1000).toFixed(2)), correlation: Number(best.correlation.toFixed(4)) };
}

/**
 * Sound onsets (s): the first sample above 0.05 after at least 100 ms of
 * near silence. The chirp's 0.5 ms rise makes the threshold land within a
 * few samples of its first one.
 */
export function onsets(pcm, rate = SYNC_RATE) {
  const found = [];
  let quiet = 0;
  for (let i = 0; i < pcm.length; i += 1) {
    if (Math.abs(pcm[i]) >= 0.05) {
      if (quiet >= 0.1 * rate) found.push(i / rate);
      quiet = 0;
    } else quiet += 1;
  }
  return found;
}

/**
 * Every white frame of `file` against the nearest sound onset. Returns
 * offsets in ms (sound minus picture; + = sound late) and their summary.
 */
export function avSync(file) {
  const lumas = frameLumas(file);
  const flashes = lumas.filter((frame, i) => frame.luma > 128 && !(lumas[i - 1]?.luma > 128)).map((frame) => frame.timeS);
  const heard = onsets(decodeFromStart(file));
  const offsets = [];
  for (const at of flashes) {
    let nearest = null;
    for (const t of heard) if (nearest === null || Math.abs(t - at) < Math.abs(nearest - at)) nearest = t;
    if (nearest !== null && Math.abs(nearest - at) < 0.15) offsets.push((nearest - at) * 1000);
  }
  const sorted = [...offsets].sort((a, b) => a - b);
  const round = (v) => (v === undefined ? null : Number(v.toFixed(2)));
  return {
    flashes: flashes.length,
    onsets: heard.length,
    paired: offsets.length,
    medianMs: round(sorted[Math.floor(sorted.length / 2)]),
    minMs: round(sorted[0]),
    maxMs: round(sorted[sorted.length - 1]),
  };
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/lib/av-sync.mjs')) {
  const target = process.argv[2];
  if (target === '--measure') console.log(JSON.stringify({ avSync: avSync(process.argv[3]), audioLayout: audioLayout(process.argv[3]) }));
  else if (target) console.log(writeSyncClip(target), syncEventFrames().length, 'events');
  else console.error('usage: node scripts/lib/av-sync.mjs <out.mp4> | --measure <file>');
}
