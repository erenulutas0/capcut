/**
 * Measurement helpers. Everything here shells out to ffmpeg/ffprobe, so the
 * numbers come from a tool that knows nothing about our encoder.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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

/* ------------------------------------------------------------- captions */

/**
 * Loads the app's own caption layout (`src/domain/captionLayout.ts`) into
 * Node, so the regions measured below come from the numbers the worker drew
 * with — not from a second copy of the rules that could drift.
 *
 * The TypeScript is only transpiled (types stripped); the two files it needs
 * have no runtime imports beyond each other.
 */
export async function loadCaptionLayoutModule(workDir) {
  const ts = (await import('typescript')).default;
  const domain = fileURLToPath(new URL('../../src/domain/', import.meta.url));
  const target = join(workDir, '.caption-layout');
  mkdirSync(target, { recursive: true });
  for (const name of ['captions', 'captionLayout']) {
    const source = readFileSync(join(domain, `${name}.ts`), 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    });
    writeFileSync(join(target, `${name}.mjs`), outputText.replace(/from '\.\/captions'/g, "from './captions.mjs'"));
  }
  return import(pathToFileURL(join(target, 'captionLayout.mjs')).href);
}

/**
 * The rectangle a cue may occupy on the output frame.
 *
 * Vertical extent: exactly the app's layout (font size, line height,
 * padding, safe margins, line count). Horizontal extent: the whole safe band,
 * because the true width needs the Inter metrics only a browser has; the
 * band contains every possible box, so nothing drawn can fall outside it.
 * `pad` widens it by a few pixels for the outline stroke and codec blur.
 */
export function captionRegion(layoutModule, text, style, frame, pad = 4) {
  const result = layoutModule.layoutCaption(text, style, frame, () => 0);
  if (!result.ok) throw new Error(`layout refused: ${text}`);
  const { box, outlinePx } = result.layout;
  const bandX = Math.round(frame.width * 0.08);
  const extra = pad + (style.preset === 'outline' ? outlinePx : 0);
  const y = Math.max(0, box.y - extra);
  const bottom = Math.min(frame.height, box.y + box.height + extra);
  // yuv420p crops are cleanest on even coordinates.
  const even = (value) => value - (value % 2);
  const x = even(Math.max(0, bandX - extra));
  const top = even(y);
  return {
    x,
    y: top,
    width: even(Math.min(frame.width, frame.width - bandX + extra) - x),
    height: even(bottom - top + 1),
    lines: result.layout.lines.length,
  };
}

/** Every frame of a region as 8-bit luma, decoded by ffmpeg. */
export function lumaRegionFrames(file, region) {
  const { x, y, width, height } = region;
  const result = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-loglevel', 'error', '-i', file, '-vf', `crop=${width}:${height}:${x}:${y},format=gray`,
     '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
    { maxBuffer: 1024 * 1024 * 1024 },
  );
  if (result.status !== 0 || !result.stdout) {
    throw new Error(`luma decode failed: ${String(result.stderr ?? '').slice(0, 200)}`);
  }
  const size = width * height;
  const frames = [];
  for (let offset = 0; offset + size <= result.stdout.length; offset += size) {
    frames.push(result.stdout.subarray(offset, offset + size));
  }
  return frames;
}

/** Per-frame mean absolute luma difference of one region in two files. */
export function regionMeanAbsDiff(fileA, fileB, region) {
  const a = lumaRegionFrames(fileA, region);
  const b = lumaRegionFrames(fileB, region);
  const count = Math.min(a.length, b.length);
  const out = [];
  for (let n = 0; n < count; n += 1) {
    const fa = a[n];
    const fb = b[n];
    let sum = 0;
    for (let i = 0; i < fa.length; i += 1) sum += Math.abs(fa[i] - fb[i]);
    out.push(sum / fa.length);
  }
  return { values: out, framesA: a.length, framesB: b.length };
}

/** Per-frame SSIM (All), optionally over a cropped region only. */
export function perFrameSsim(fileA, fileB, region = null) {
  const crop = region ? `crop=${region.width}:${region.height}:${region.x}:${region.y},` : '';
  const graph = `[0:v]${crop}null[a];[1:v]${crop}null[b];[a][b]ssim=stats_file=-`;
  const result = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-loglevel', 'error', '-i', fileA, '-i', fileB, '-lavfi', graph, '-f', 'null', '-'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  const values = [];
  for (const match of (result.stdout ?? '').matchAll(/n:(\d+)[^\n]*All:([0-9.]+)/g)) {
    values[Number(match[1]) - 1] = Number(match[2]);
  }
  return values;
}

function median(values) {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((p, q) => p - q);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Measures one burned-in export against a caption-free reference of the same
 * edit.
 *
 * For every cue, the luma difference inside the cue's region is split into
 * frames inside and outside its window. Frames are called "showing" when the
 * difference sits above the midpoint between the caption-free noise floor and
 * the level inside the window, which gives the first and last frame the
 * caption really appears on. A full-frame SSIM over frames where no cue is
 * planned checks nothing leaks outside the windows.
 *
 * @param {{ cues: {startFrame:number,endFrame:number,region:object,text:string}[] }} plan
 */
export function measureCaptionBurnIn(outputFile, referenceFile, { cues, totalFrames }) {
  const planned = (frame) => cues.some((cue) => frame >= cue.startFrame && frame < cue.endFrame);
  // Frames right next to a window edge are left out of the "clean" set: an
  // encoder may smear one frame of change across a boundary.
  const nearEdge = (frame) =>
    cues.some((cue) => Math.abs(frame - cue.startFrame) <= 1 || Math.abs(frame - cue.endFrame) <= 1);

  const full = perFrameSsim(outputFile, referenceFile);
  const cleanFrames = [];
  for (let frame = 0; frame < totalFrames; frame += 1) {
    if (!planned(frame) && !nearEdge(frame) && Number.isFinite(full[frame])) cleanFrames.push(frame);
  }
  const cleanSsim = cleanFrames.map((frame) => full[frame]);

  const perCue = cues.map((cue) => {
    const { values } = regionMeanAbsDiff(outputFile, referenceFile, cue.region);
    const regionSsim = perFrameSsim(outputFile, referenceFile, cue.region);
    const insideFrames = [];
    const outsideFrames = [];
    for (let frame = 0; frame < values.length; frame += 1) {
      if (frame >= cue.startFrame + 1 && frame < cue.endFrame - 1) insideFrames.push(frame);
      else if (!planned(frame) && !nearEdge(frame)) outsideFrames.push(frame);
    }
    const inside = median(insideFrames.map((frame) => values[frame]));
    const noise = median(outsideFrames.map((frame) => values[frame]));
    const threshold = (inside + noise) / 2;

    // Showing frames that belong to THIS cue: search its window plus a margin,
    // so another cue drawn in the same place does not count as this one.
    const lo = Math.max(0, cue.startFrame - 8);
    const hi = Math.min(values.length - 1, cue.endFrame + 7);
    let first = null;
    let last = null;
    for (let frame = lo; frame <= hi; frame += 1) {
      if (values[frame] > threshold) {
        if (first === null) first = frame;
        last = frame;
      }
    }
    const missingInside = insideFrames.filter((frame) => !(values[frame] > threshold)).length;
    const leakedFrames = outsideFrames.filter((frame) => values[frame] > threshold);
    const round = (value, digits = 2) => (Number.isFinite(value) ? Number(value.toFixed(digits)) : null);
    return {
      text: cue.text,
      region: cue.region,
      plannedFirst: cue.startFrame,
      plannedLast: cue.endFrame - 1,
      first,
      last,
      insideDiff: round(inside),
      noiseDiff: round(noise),
      minInsideDiff: round(Math.min(...insideFrames.map((frame) => values[frame]))),
      maxOutsideDiff: round(Math.max(...outsideFrames.map((frame) => values[frame]))),
      missingInside,
      leakedFrames: leakedFrames.length,
      regionSsimInside: round(median(insideFrames.map((frame) => regionSsim[frame])), 4),
      regionSsimOutside: round(median(outsideFrames.map((frame) => regionSsim[frame])), 4),
    };
  });

  return {
    frames: full.length,
    cleanFrames: cleanFrames.length,
    cleanSsimMean: cleanSsim.length ? cleanSsim.reduce((s, v) => s + v, 0) / cleanSsim.length : NaN,
    cleanSsimMin: cleanSsim.length ? Math.min(...cleanSsim) : NaN,
    perCue,
  };
}

/** One output frame as PNG, for a human to look at. */
export function extractFramePng(file, frameIndex, outFile) {
  const result = spawnSync(
    'ffmpeg',
    ['-y', '-hide_banner', '-loglevel', 'error', '-i', file, '-vf', `select=eq(n\\,${frameIndex})`,
     '-frames:v', '1', outFile],
    { encoding: 'utf8' },
  );
  return result.status === 0;
}
