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
export function buildReference(sourceFile, { filter, trims }, width, height, outFile, preInput = []) {
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
    ['-y', '-hide_banner', '-loglevel', 'error', ...preInput, '-i', sourceFile,
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
 * Domain files the caption measurements load, i.e. the runtime import
 * closure of `captionLayout.ts` and `captions.ts`. When a new runtime import
 * appears in them, it must be listed here: the loader then fails loudly on
 * the unresolved path instead of measuring with stale rules.
 */
const CAPTION_DOMAIN_FILES = ['captions', 'captionLayout', 'timeline'];

/**
 * Transpiles the caption domain files (types stripped only) into `workDir`
 * and returns the path of the folder. Relative imports get the `.mjs`
 * extension Node needs; type-only imports are gone after transpiling.
 */
async function transpileCaptionDomain(workDir) {
  const ts = (await import('typescript')).default;
  const domain = fileURLToPath(new URL('../../src/domain/', import.meta.url));
  const target = join(workDir, '.caption-layout');
  mkdirSync(target, { recursive: true });
  for (const name of CAPTION_DOMAIN_FILES) {
    const source = readFileSync(join(domain, `${name}.ts`), 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    });
    writeFileSync(join(target, `${name}.mjs`), outputText.replace(/from '\.\/([A-Za-z]+)'/g, "from './$1.mjs'"));
  }
  return target;
}

/**
 * Loads the app's own caption layout (`src/domain/captionLayout.ts`) into
 * Node, so the regions measured below come from the numbers the worker drew
 * with — not from a second copy of the rules that could drift.
 */
export async function loadCaptionLayoutModule(workDir) {
  const target = await transpileCaptionDomain(workDir);
  return import(pathToFileURL(join(target, 'captionLayout.mjs')).href);
}

/**
 * The app's `captions.ts` (incl. `outputCues`). Used only to CROSS-CHECK an
 * expectation that the matrix computes on its own; never as the expectation.
 */
export async function loadCaptionsModule(workDir) {
  const target = await transpileCaptionDomain(workDir);
  return import(pathToFileURL(join(target, 'captions.mjs')).href);
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

/* ------------------------------------------- which caption, frame by frame */

/**
 * The exact box a `box`-preset caption occupies, from the app's own layout
 * and a text measure taken in the browser with the bundled caption font (so
 * the width is the one the worker drew with, not a guess).
 */
export function captionBox(layoutModule, text, style, frame, measure) {
  const result = layoutModule.layoutCaption(text, style, frame, measure);
  if (!result.ok) throw new Error(`layout refused: ${text}`);
  const { box, lines } = result.layout;
  return { ...box, lines: lines.length };
}

/**
 * Says, for every frame of an export, WHICH caption is burned in (or none),
 * by comparing it with a caption-free reference of the same edit.
 *
 * Presence alone cannot follow a source-anchored track: two different lines
 * can sit back to back in the same place (a cut from "üç-beş" straight into
 * "bir"), which looks like one long caption. Each candidate line has its own
 * box (width from its text, height from its line count), so each frame is
 * labelled by the box whose EDGES are really there: just inside each edge
 * the picture must differ from the reference, just outside it must not.
 *
 *   contrast(box) = min over left, right and top edge of
 *                   mean |diff| in a strip just inside − just outside
 *
 * A narrower box than the one drawn has both strips inside the drawn box and
 * a wider one has both outside, so either scores near zero; only the drawn
 * box scores high. The strips start `gap` px from the edge to stay clear of
 * the rounded corners' anti-aliasing and of codec blur. Every value is
 * relative to the same frame, so encoder noise (which differs per browser)
 * cancels out and no absolute level has to be tuned.
 *
 * `presence` is a second, box-independent signal: mean |diff| inside the
 * smallest candidate box minus a caption-free strip above the band. It
 * catches a caption that matches no candidate (labelled '?').
 *
 * @param {{ label: string, box: {x:number,y:number,width:number,height:number} }[]} candidates
 */
export function measureCaptionIdentity(
  outputFile,
  referenceFile,
  { candidates, frameWidth, frameHeight, minContrast, gap = 3, strip = 6, margin = 16 },
) {
  const even = (value) => value - (value % 2);
  const top = even(Math.max(0, Math.min(...candidates.map((c) => c.box.y)) - margin - 40));
  const bottom = Math.min(frameHeight, Math.max(...candidates.map((c) => c.box.y + c.box.height)) + margin);
  const left = even(Math.max(0, Math.min(...candidates.map((c) => c.box.x)) - margin));
  const right = Math.min(frameWidth, Math.max(...candidates.map((c) => c.box.x + c.box.width)) + margin);
  const band = { x: left, y: top, width: even(right - left), height: even(bottom - top) };

  const a = lumaRegionFrames(outputFile, band);
  const b = lumaRegionFrames(referenceFile, band);
  const count = Math.min(a.length, b.length);

  // Rectangle mean of |a - b| in band coordinates.
  const rectMean = (fa, fb, x0, y0, x1, y1) => {
    let sum = 0;
    let n = 0;
    for (let y = Math.max(0, y0); y < Math.min(band.height, y1); y += 1) {
      const row = y * band.width;
      for (let x = Math.max(0, x0); x < Math.min(band.width, x1); x += 1) {
        sum += Math.abs(fa[row + x] - fb[row + x]);
        n += 1;
      }
    }
    return n ? sum / n : NaN;
  };

  const local = candidates.map((c) => ({
    label: c.label,
    x: c.box.x - band.x,
    y: c.box.y - band.y,
    w: c.box.width,
    h: c.box.height,
  }));
  const smallest = [...local].sort((p, q) => p.w * p.h - q.w * q.h)[0];
  // Caption-free control strip: the 32 rows at the top of the band, above
  // every candidate box by at least `margin` px.
  const controlRows = [0, 32];

  const frames = [];
  for (let n = 0; n < count; n += 1) {
    const fa = a[n];
    const fb = b[n];
    const scores = {};
    for (const c of local) {
      const y0 = c.y + gap;
      const y1 = c.y + c.h - gap;
      const leftEdge =
        rectMean(fa, fb, c.x + gap, y0, c.x + gap + strip, y1) - rectMean(fa, fb, c.x - gap - strip, y0, c.x - gap, y1);
      const rightEdge =
        rectMean(fa, fb, c.x + c.w - gap - strip, y0, c.x + c.w - gap, y1) -
        rectMean(fa, fb, c.x + c.w + gap, y0, c.x + c.w + gap + strip, y1);
      const topEdge =
        rectMean(fa, fb, c.x + gap, c.y + gap, c.x + c.w - gap, c.y + gap + strip) -
        rectMean(fa, fb, c.x + gap, c.y - gap - strip, c.x + c.w - gap, c.y - gap);
      scores[c.label] = Math.min(leftEdge, rightEdge, topEdge);
    }
    const presence =
      rectMean(fa, fb, smallest.x + gap, smallest.y + gap, smallest.x + smallest.w - gap, smallest.y + smallest.h - gap) -
      rectMean(fa, fb, 0, controlRows[0], band.width, controlRows[1]);
    let best = null;
    for (const [label, score] of Object.entries(scores)) {
      if (best === null || score > best.score) best = { label, score };
    }
    let label = 'none';
    if (best && best.score >= minContrast) label = best.label;
    else if (presence >= minContrast) label = '?';
    frames.push({ label, best: best?.label ?? null, bestScore: best?.score ?? NaN, presence, scores });
  }
  return { band, frames, framesA: a.length, framesB: b.length };
}

/** Frame-by-frame label runs: [{ label, first, last }]. */
export function labelRuns(labels) {
  const runs = [];
  for (const [frame, label] of labels.entries()) {
    const current = runs[runs.length - 1];
    if (current && current.label === label) current.last = frame;
    else runs.push({ label, first: frame, last: frame });
  }
  return runs;
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
