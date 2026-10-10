/**
 * Sound only: what the harness uploads is never the video file.
 *
 * ffmpeg drops the picture (`-vn`), every subtitle and data track, and the
 * container's metadata (title, GPS, device name), mixes down to mono, resamples
 * to 16 kHz and encodes a compact file the provider accepts (.opus/.ogg and
 * .flac are on its list:
 * https://support.assemblyai.com/articles/2616970375-what-audio-and-video-file-types-are-supported-by-your-api,
 * read on 2026-10-10; the provider resamples everything to 16 kHz itself).
 *
 * Codecs:
 *  - `opus` (default): Ogg Opus, 24 kbit/s, speech tuning — what the browser
 *    can also produce (WebCodecs Opus), so the measurement matches the product.
 *    120 minutes ≈ 21.6 MB.
 *  - `flac`: lossless, to measure what the lossy codec costs in accuracy.
 *    120 minutes ≈ 100–140 MB (content dependent).
 */
import { spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';

export const CODECS = Object.freeze({
  opus: { ext: 'ogg', contentType: 'audio/ogg', bitrate: 24000, args: ['-c:a', 'libopus', '-b:a', '24k', '-vbr', 'on', '-application', 'voip', '-frame_duration', '20'] },
  flac: { ext: 'flac', contentType: 'audio/flac', bitrate: null, args: ['-c:a', 'flac', '-compression_level', '8'] },
});

export const SAMPLE_RATE = 16000;

function run(cmd, argv) {
  const result = spawnSync(cmd, argv, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw new Error(`${cmd} could not be started (${result.error.code ?? result.error.message}); is ffmpeg installed and on PATH?`);
  if (result.status !== 0) throw new Error(`${cmd} failed (exit ${result.status}): ${String(result.stderr).trim().split(/\r?\n/).slice(-3).join(' | ')}`);
  return result.stdout;
}

/** Length of the first audio stream (falls back to the container's length), in seconds. */
export function probeDurationS(file) {
  const out = run('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=duration:format=duration', '-of', 'json', file]);
  const json = JSON.parse(out);
  const stream = Number(json.streams?.[0]?.duration);
  const format = Number(json.format?.duration);
  const duration = Number.isFinite(stream) && stream > 0 ? stream : format;
  if (!Number.isFinite(duration) || duration <= 0) throw new Error(`no audio duration found in ${file}`);
  return duration;
}

/** Does the file have any audio stream at all? */
export function hasAudio(file) {
  const out = run('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'json', file]);
  return (JSON.parse(out).streams ?? []).length > 0;
}

export function extractArgs(input, output, codec) {
  const spec = CODECS[codec];
  if (!spec) throw new Error(`unknown codec "${codec}" (known: ${Object.keys(CODECS).join(', ')})`);
  return [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', input,
    '-map', '0:a:0', // the first audio stream only
    '-vn', '-sn', '-dn', // no picture, no subtitles, no data tracks
    '-map_metadata', '-1', '-map_chapters', '-1', // no title, location, device name
    '-fflags', '+bitexact', '-flags:a', '+bitexact',
    '-ac', '1', '-ar', String(SAMPLE_RATE),
    ...spec.args,
    output,
  ];
}

/** Writes the audio-only file and returns what will be uploaded. */
export function extractAudio(input, output, codec = 'opus') {
  run('ffmpeg', extractArgs(input, output, codec));
  return { file: output, bytes: statSync(output).size, durationS: probeDurationS(output), codec, contentType: CODECS[codec].contentType };
}

/** Streams of the produced file, to prove there is no picture in it. */
export function streamKinds(file) {
  const out = run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'json', file]);
  return (JSON.parse(out).streams ?? []).map((stream) => stream.codec_type);
}
