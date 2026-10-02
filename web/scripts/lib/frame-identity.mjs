/**
 * Which source frame does each output frame show, for footage that carries
 * no barcode (ADR-033)?
 *
 * Counts and timestamps cannot see a stale frame: on the phone the frames
 * at a kesit's end arrived on time and were counted, but showed an older
 * picture. Here every output frame is compared with an independent ffmpeg
 * reference of the same edit (`buildReference`'s graph: each output instant
 * shows the newest source frame that started by then) and with that
 * reference's neighbours. A frame is WRONG when a neighbour of the reference
 * (up to MATCH_WINDOW frames away) is clearly closer to it than its own
 * reference frame, and the two reference frames clearly differ (more than
 * twice the typical encode difference). Where every neighbouring reference
 * frame looks alike (a still scene) the frame is UNDECIDABLE, never counted
 * right. Checked on the phone's 1 October outputs: it finds the stale ends
 * the side-by-side comparison with the desktop found (I, J, K, L, M, D's
 * last frame) and nothing in the desktop's.
 *
 * Frames are compared small (gray, 36×64 or 64×36), each normalised to zero
 * mean and unit contrast, so an encoder's slight colour or level change (or
 * an HDR source's tone mapping) does not decide the match; motion does.
 *
 *   node scripts/lib/frame-identity.mjs <output.mp4> <source> '[[2,10]]' [--grid]
 */
import { spawnSync } from 'node:child_process';

/** How far (output frames) a wrong frame may have come from. */
export const MATCH_WINDOW = 10;
/** Output frames counted as a kesit's start or end. */
export const EDGE_FRAMES = 15;

const COVER_9_16 = "crop=w='min(iw,ih*9/16)':h='min(ih,iw*16/9)'";

function smallSize(width, height) {
  return width >= height ? [64, 36] : [36, 64];
}

function readGray(args, width, height) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], {
    maxBuffer: 2 * 1024 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${String(result.stderr).slice(0, 300)}`);
  const size = width * height;
  const frames = [];
  for (let at = 0; at + size <= result.stdout.length; at += size) frames.push(normalise(result.stdout.subarray(at, at + size)));
  return frames;
}

/** Zero mean, unit contrast (a floor keeps a flat frame from blowing up noise). */
export function normalise(pixels) {
  let mean = 0;
  for (const v of pixels) mean += v;
  mean /= pixels.length;
  let variance = 0;
  for (const v of pixels) variance += (v - mean) ** 2;
  const scale = Math.max(Math.sqrt(variance / pixels.length), 8);
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

/** Output frames per kesit on the export's 30 fps grid (the render plan's rounding). */
export function kesitFrameCounts(trims, fps = 30) {
  const counts = [];
  let cursorUs = 0;
  for (const [a, b] of trims) {
    const durationUs = Math.round((b - a) * 1e6);
    counts.push(Math.round(((cursorUs + durationUs) * fps) / 1e6) - Math.round((cursorUs * fps) / 1e6));
    cursorUs += durationUs;
  }
  return counts;
}

/** An exported file, small and gray, frame by frame (`gridFps`: a fast cut's own frame times put on the grid). */
export function outputFrames(file, { width, height, gridFps = null }) {
  const [w, h] = smallSize(width, height);
  const grid = gridFps ? `fps=${gridFps}:round=up:start_time=0,` : '';
  return readGray(['-i', file, '-an', '-vf', `${grid}scale=${w}:${h}:flags=area,format=gray`, '-fps_mode', 'passthrough'], w, h);
}

/**
 * The reference of the same edit, small and gray: `buildReference`'s graph
 * (scripts/lib/media-measure.mjs) without the encode. `filter` is the
 * crop/scale the app applies (9:16 cover by default).
 */
export function referenceFrames(source, trims, { width, height, filter = COVER_9_16 }) {
  const [w, h] = smallSize(width, height);
  const parts = trims
    .map(([from, to], index) => {
      const lead = Math.min(1, Math.floor(from * 30) / 30);
      const origin = from - lead;
      return (
        `[0:v]trim=start=${origin}:end=${to},setpts=PTS-${origin}/TB,${filter},scale=${w}:${h}:flags=area,format=gray,` +
        `fps=fps=30:round=up:start_time=0,trim=start=${lead}:end=${lead + (to - from)},setpts=PTS-STARTPTS[v${index}]`
      );
    })
    .join(';');
  const labels = trims.map((_, index) => `[v${index}]`).join('');
  return readGray(['-i', source, '-filter_complex', `${parts};${labels}concat=n=${trims.length}:v=1:a=0[o]`, '-map', '[o]'], w, h);
}

/**
 * Pure part: every output frame against its reference frame and the
 * reference's neighbours (MATCH_WINDOW each way). `counts`: output frames
 * per kesit, in order.
 */
export function matchFrames(out, ref, counts, { window = MATCH_WINDOW } = {}) {
  const own = out.map((frame, i) => (ref[i] ? distance(frame, ref[i]) : Infinity));
  const finite = own.filter(Number.isFinite).sort((a, b) => a - b);
  // The encoders' own noise: what a right frame typically differs by.
  const noise = Math.max(finite[Math.floor(finite.length / 2)] ?? 0, 0.02);
  const wrong = [];
  const byKesit = [];
  let offset = 0;
  for (const [kesit, count] of counts.entries()) {
    const row = { kesit, frames: count, wrong: 0, wrongAtStart: 0, wrongInMiddle: 0, wrongAtEnd: 0, undecidable: 0, unmatched: 0 };
    for (let k = 0; k < count; k += 1) {
      const i = offset + k;
      const frame = out[i];
      if (!frame || !ref[i]) {
        row.unmatched += 1;
        continue;
      }
      let best = i;
      let bestDistance = own[i];
      let distinct = false;
      for (let j = Math.max(0, i - window); j <= Math.min(ref.length - 1, i + window); j += 1) {
        if (j === i) continue;
        const apart = distance(ref[i], ref[j]);
        if (apart <= 2 * noise) continue;
        distinct = true;
        const d = distance(frame, ref[j]);
        if (d + 0.5 * apart < own[i] && d < bestDistance) {
          best = j;
          bestDistance = d;
        }
      }
      if (best !== i) {
        row.wrong += 1;
        if (k >= count - EDGE_FRAMES) row.wrongAtEnd += 1;
        else if (k < EDGE_FRAMES) row.wrongAtStart += 1;
        else row.wrongInMiddle += 1;
        wrong.push({ outputFrame: i, kesit, looksLike: best - i });
      } else if (!distinct) row.undecidable += 1;
      else if (own[i] > 8 * noise) row.unmatched += 1;
    }
    byKesit.push(row);
    offset += count;
  }
  return {
    frames: out.length,
    expectedFrames: offset,
    referenceFrames: ref.length,
    noise: Number(noise.toFixed(4)),
    wrong: wrong.length,
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
 * track) against ffmpeg's reference. Width and height default to the
 * export's own.
 */
export function referenceIdentity({ output, source, trims, width, height, filter, gridFps = null }) {
  const size = width && height ? { width, height } : videoStream(output);
  const ranges = trims && trims.length > 0 ? trims : [[0, Number(videoStream(source).duration)]];
  const out = outputFrames(output, { ...size, gridFps });
  const ref = referenceFrames(source, ranges, { ...size, filter });
  return matchFrames(out, ref, kesitFrameCounts(ranges));
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
