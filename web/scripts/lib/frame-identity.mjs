/**
 * Which source frame does each output frame show, for footage that carries
 * no barcode (ADR-033)?
 *
 * Counts and timestamps cannot see a stale frame: on the phone the frames
 * at a kesit's end arrived on time and were counted, but showed an older
 * picture. Here every output frame is compared with the SOURCE's own frames
 * (decoded by ffmpeg at their native rate, with their timestamps). The frame
 * it should show is the newest source frame that started by its instant
 * (kesit start + k/30 s, 1 ms slack: the export's frame picker, ADR-014, and
 * what a player shows). A frame is WRONG when another source frame (within
 * WINDOW_S) is clearly closer to it than the expected one, and the two source
 * frames clearly differ (more than twice the typical encode difference).
 * Where the neighbours look alike (a still scene) or the expected frame is
 * flat (nearly one colour, e.g. a dark shot) the frame is UNDECIDABLE, never
 * counted right.
 *
 * An ffmpeg `fps` resample is NOT used as the reference: on a VFR recording a
 * source frame starting 1.3 ms after an output instant fell on the other
 * side of ffmpeg's rounding than the player rule, and two right frames read
 * as wrong (R06, measured). Frames are compared small (gray, 36×64 or
 * 64×36), each normalised to zero mean and unit contrast, so an encoder's
 * slight colour or level change (or an HDR source's tone mapping) does not
 * decide the match; the picture does.
 *
 *   node scripts/lib/frame-identity.mjs <output.mp4> <source> '[[2,10]]' [--grid]
 */
import { spawnSync } from 'node:child_process';

/** How far (seconds of source) a wrong frame may have come from. */
export const WINDOW_S = 0.4;
/** Output frames counted as a kesit's start or end. */
export const EDGE_FRAMES = 15;
/** Below this contrast (gray levels at 36×64) a frame is too flat to tell apart from its neighbours. */
export const FLAT_STD = 3;

const COVER_9_16 = "crop=w='min(iw,ih*9/16)':h='min(ih,iw*16/9)'";

function smallSize(width, height) {
  return width >= height ? [64, 36] : [36, 64];
}

/** Contrast of raw gray pixels (gray levels). */
export function contrast(pixels) {
  let mean = 0;
  for (const v of pixels) mean += v;
  mean /= pixels.length;
  let variance = 0;
  for (const v of pixels) variance += (v - mean) ** 2;
  return Math.sqrt(variance / pixels.length);
}

/** Zero mean, unit contrast (a floor keeps a flat frame from blowing up noise). */
export function normalise(pixels) {
  let mean = 0;
  for (const v of pixels) mean += v;
  mean /= pixels.length;
  const scale = Math.max(contrast(pixels), 8);
  const out = new Float32Array(pixels.length);
  for (let i = 0; i < pixels.length; i += 1) out[i] = (pixels[i] - mean) / scale;
  return out;
}

/** Mean absolute difference of two normalised frames. */
export function distance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

function ffmpegGray(args, width, height, { withTimes = false } = {}) {
  const result = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-loglevel', withTimes ? 'info' : 'error', ...args, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
    { maxBuffer: 4 * 1024 * 1024 * 1024 },
  );
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${String(result.stderr).slice(-300)}`);
  const size = width * height;
  const frames = [];
  for (let at = 0; at + size <= result.stdout.length; at += size) frames.push(result.stdout.subarray(at, at + size));
  const times = withTimes ? [...String(result.stderr).matchAll(/showinfo.*?pts_time:\s*(-?[0-9.]+)/g)].map((m) => Number(m[1])) : [];
  return { frames, times };
}

/**
 * The output frame's instants and the source frame each should show:
 * kesitler back to back on the 30 fps grid (the render plan's rounding),
 * the newest source frame with a start at or before the instant + 1 ms.
 */
export function expectedFromSource(sourceTimes, trims, fps = 30) {
  const expected = [];
  let cursorUs = 0;
  for (const [kesit, [a, b]] of trims.entries()) {
    const durationUs = Math.round((b - a) * 1e6);
    const count = Math.round(((cursorUs + durationUs) * fps) / 1e6) - Math.round((cursorUs * fps) / 1e6);
    for (let k = 0; k < count; k += 1) {
      const t = a + Math.round((k * 1e6) / fps) / 1e6;
      let index = -1;
      for (let s = 0; s < sourceTimes.length; s += 1) if (sourceTimes[s] <= t + 0.001) index = s;
      expected.push({ kesit, k, count, t, index });
    }
    cursorUs += durationUs;
  }
  return expected;
}

/**
 * Pure part. `out`: normalised output frames; `source`: { time, frame
 * (normalised), contrast } in presentation order; `expected`: from
 * `expectedFromSource`.
 */
export function matchFrames(out, source, expected, { windowS = WINDOW_S } = {}) {
  const own = expected.map((e, i) => (out[i] && source[e.index] ? distance(out[i], source[e.index].frame) : Infinity));
  const finite = own.filter(Number.isFinite).sort((a, b) => a - b);
  // The encoders' own noise: what a right frame typically differs by.
  const noise = Math.max(finite[Math.floor(finite.length / 2)] ?? 0, 0.02);
  const wrong = [];
  const rows = new Map();
  for (const [i, e] of expected.entries()) {
    if (!rows.has(e.kesit)) {
      rows.set(e.kesit, { kesit: e.kesit, frames: e.count, wrong: 0, wrongAtStart: 0, wrongInMiddle: 0, wrongAtEnd: 0, undecidable: 0, unmatched: 0 });
    }
    const row = rows.get(e.kesit);
    const shown = out[i];
    const mine = source[e.index];
    if (!shown || !mine) {
      row.unmatched += 1;
      continue;
    }
    if (mine.contrast < FLAT_STD) {
      row.undecidable += 1;
      continue;
    }
    let best = null;
    let bestDistance = own[i];
    let distinct = false;
    for (let j = 0; j < source.length; j += 1) {
      const other = source[j];
      if (j === e.index || Math.abs(other.time - mine.time) > windowS) continue;
      const apart = distance(mine.frame, other.frame);
      if (apart <= 2 * noise) continue;
      distinct = true;
      const d = distance(shown, other.frame);
      if (d + 0.5 * apart < own[i] && d < bestDistance) {
        best = j;
        bestDistance = d;
      }
    }
    if (best !== null) {
      row.wrong += 1;
      if (e.k >= e.count - EDGE_FRAMES) row.wrongAtEnd += 1;
      else if (e.k < EDGE_FRAMES) row.wrongAtStart += 1;
      else row.wrongInMiddle += 1;
      wrong.push({
        outputFrame: i,
        kesit: e.kesit,
        sourceOffset: best - e.index,
        looksLikeMs: Math.round((source[best].time - mine.time) * 1000),
      });
    } else if (!distinct) row.undecidable += 1;
    else if (own[i] > 8 * noise) row.unmatched += 1;
  }
  const byKesit = [...rows.values()];
  return {
    frames: out.length,
    expectedFrames: expected.length,
    noise: Number(noise.toFixed(4)),
    wrong: wrong.length,
    // Frames like nothing near their instant, or missing from the output: never right either.
    unmatched: byKesit.reduce((sum, row) => sum + row.unmatched, 0),
    undecidable: byKesit.reduce((sum, row) => sum + row.undecidable, 0),
    byKesit,
    firstWrong: wrong.slice(0, 8),
    lastWrong: wrong.length > 8 ? wrong.slice(-4) : [],
  };
}

function videoStream(file) {
  const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,duration', '-of', 'json', file], {
    encoding: 'utf8',
  });
  return JSON.parse(probe.stdout || '{}').streams?.[0] ?? {};
}

/**
 * The whole check: an export of `source`'s `trims` (none: the whole video
 * track) against the source's own frames. Width and height default to the
 * export's own; `filter` is the crop the app applies (9:16 cover by
 * default); `gridFps` puts a fast cut's own frame times on the 30 fps grid.
 */
export function referenceIdentity({ output, source, trims, width, height, filter = COVER_9_16, gridFps = null }) {
  const size = width && height ? { width, height } : videoStream(output);
  const ranges = trims && trims.length > 0 ? trims : [[0, Number(videoStream(source).duration)]];
  const [w, h] = smallSize(size.width, size.height);
  const grid = gridFps ? `fps=${gridFps}:round=up:start_time=0,` : '';
  const out = ffmpegGray(['-i', output, '-an', '-vf', `${grid}scale=${w}:${h}:flags=area,format=gray`, '-fps_mode', 'passthrough'], w, h).frames.map(
    normalise,
  );
  // The source at its own rate, every frame with its time (edit lists applied, as the app reads it).
  const decoded = ffmpegGray(
    ['-i', source, '-an', '-vf', `${filter},scale=${w}:${h}:flags=area,format=gray,showinfo`, '-fps_mode', 'passthrough'],
    w,
    h,
    { withTimes: true },
  );
  if (decoded.times.length !== decoded.frames.length) {
    throw new Error(`source frames ${decoded.frames.length} but times ${decoded.times.length}`);
  }
  const keep = (time) => ranges.some(([a, b]) => time >= a - 1 && time <= b + WINDOW_S + 0.1);
  const sourceFrames = [];
  decoded.frames.forEach((pixels, i) => {
    const time = decoded.times[i];
    if (keep(time)) sourceFrames.push({ time, frame: normalise(pixels), contrast: contrast(pixels) });
  });
  sourceFrames.sort((p, q) => p.time - q.time);
  const expected = expectedFromSource(
    sourceFrames.map((s) => s.time),
    ranges,
  );
  return matchFrames(out, sourceFrames, expected);
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/lib/frame-identity.mjs')) {
  const [output, source, trimsJson] = process.argv.slice(2);
  if (!output || !source) {
    console.error("usage: node scripts/lib/frame-identity.mjs <output.mp4> <source> '[[a,b],…]' [--grid]");
    process.exit(2);
  }
  const trims = JSON.parse(trimsJson ?? '[]');
  console.log(JSON.stringify(referenceIdentity({ output, source, trims, gridFps: process.argv.includes('--grid') ? 30 : null })));
}
