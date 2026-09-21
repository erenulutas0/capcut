/**
 * Measurement helpers. Everything here shells out to ffmpeg/ffprobe, so the
 * numbers come from a tool that knows nothing about our encoder.
 */
import { spawnSync } from 'node:child_process';

export function runFfmpeg(args) {
  const result = spawnSync('ffmpeg', ['-hide_banner', ...args], { encoding: 'utf8' });
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

export function ffprobeJson(file) {
  const result = spawnSync(
    'ffprobe',
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) return null;
  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

/**
 * RMS level (dB) inside a narrow band, over the whole file or a slice.
 *
 * `width` matters: a bandpass has finite rolloff, so a loud tone 100 Hz away
 * still shows up 20 dB down. Measurements that must separate two nearby tones
 * pass a narrow `width`, and measurements sitting next to a much louder tone
 * pass `notch` to remove it first. Getting this wrong produces confident,
 * completely wrong readings.
 */
export function bandRmsDb(
  file,
  frequency,
  { start = null, duration = null, width = 25, notch = null, notchWidth = 80 } = {},
) {
  const args = [];
  if (start !== null) args.push('-ss', String(start));
  if (duration !== null) args.push('-t', String(duration));

  const chain = [];
  if (notch !== null) chain.push(`bandreject=f=${notch}:width_type=h:w=${notchWidth}`);
  chain.push(`bandpass=f=${frequency}:width_type=h:w=${width}`);
  chain.push('astats=metadata=1:reset=0');

  args.push('-i', file, '-af', chain.join(','), '-f', 'null', '-');
  const output = runFfmpeg(args);
  const matches = [...output.matchAll(/RMS level dB:\s*(-?[0-9.]+|-inf)/g)];
  const values = matches.map((m) => (m[1] === '-inf' ? -Infinity : Number(m[1])));
  return values.length > 0 ? Math.max(...values) : NaN;
}

/** Highest sample peak (dB) across the file; used for clipping checks. */
export function peakDb(file) {
  const output = runFfmpeg(['-i', file, '-af', 'astats=metadata=1:reset=0', '-f', 'null', '-']);
  const matches = [...output.matchAll(/Peak level dB:\s*(-?[0-9.]+|-inf)/g)];
  const values = matches.map((m) => (m[1] === '-inf' ? -Infinity : Number(m[1])));
  return values.length > 0 ? Math.max(...values) : NaN;
}

export function ssim(fileA, fileB) {
  const output = runFfmpeg(['-i', fileA, '-i', fileB, '-lavfi', '[0:v][1:v]ssim', '-f', 'null', '-']);
  const match = /SSIM[^\n]*All:\s*([0-9.]+)/.exec(output);
  return match ? Number(match[1]) : NaN;
}

/**
 * Builds the same edit independently with ffmpeg, so the browser's picture can
 * be compared against something our code had no hand in producing.
 */
export function buildReference(sourceFile, { filter, trims }, width, height, outFile) {
  // Each output instant must show the frame a player shows there: the latest
  // source frame that started at or before it. The old `trim=from,setpts=
  // PTS-STARTPTS` dropped the frame covering `from` and restarted the clock on
  // the NEXT frame, which shifted every reference frame of an odd-rate or VFR
  // recording by one — a measurement error, not an app error.
  //
  // So: keep a little lead-in, anchor the clock on `from` itself, let
  // `fps=round=up` hold each frame until the next one starts, and only then
  // cut the moment out. The lead-in is a whole number of output frames so the
  // grid stays aligned with the app's `from + k/30`.
  const parts = trims
    .map(([from, to], index) => {
      const lead = Math.min(1, Math.floor(from * 30) / 30);
      const origin = from - lead;
      const length = to - from;
      return (
        `[0:v]trim=start=${origin}:end=${to},setpts=PTS-${origin}/TB,${filter},` +
        `fps=fps=30:round=up:start_time=0,` +
        `trim=start=${lead}:end=${lead + length},setpts=PTS-STARTPTS[v${index}]`
      );
    })
    .join(';');
  const labels = trims.map((_, index) => `[v${index}]`).join('');
  const graph = `${parts};${labels}concat=n=${trims.length}:v=1:a=0[outv]`;

  const result = spawnSync(
    'ffmpeg',
    ['-y', '-hide_banner', '-loglevel', 'error', '-i', sourceFile,
     '-filter_complex', graph, '-map', '[outv]', '-an',
     '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-s', `${width}x${height}`, outFile],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(`reference build failed: ${(result.stderr || '').slice(0, 300)}`);
  }
  return outFile;
}
