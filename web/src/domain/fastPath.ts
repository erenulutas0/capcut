/**
 * Fast cut ("hızlı kesim", ADR-027): which downloads can keep the source's
 * own compressed pictures instead of re-encoding every frame, and exactly
 * which pictures are copied and which are re-encoded around each cut.
 *
 * Frame accuracy is not negotiable (founder decision 2026-09-23): a range
 * starts and ends exactly on the frames the user marked. A compressed stream
 * can only be entered at an IDR picture, so the frames between the cut and
 * the next IDR are re-encoded ("smart cut"); the rest is copied as is. When
 * that is not possible or not allowed, the normal full encode runs and the
 * result says why.
 *
 * Pure and framework-free: the worker gathers the facts, this module decides.
 */

import type { RenderPlan, RenderSegment } from './renderPlan';

/** How the video of a finished download was produced. */
export type ExportMethod = 'copy' | 'smart' | 'encode';

/** What the caller asked for: `auto` uses the fast cut when it is allowed. */
export type ExportMode = 'auto' | 'encode';

/**
 * Why a download was fully encoded instead of cut. Shown to the user and
 * recorded in the result, never guessed after the fact.
 */
export type FastCutFallbackReason =
  /** The caller asked for a full encode. */
  | 'requested_encode'
  /** Burned-in captions change every picture they cover. */
  | 'captions'
  /** HDR needs tone mapping to SDR (ADR-022): copying would keep HDR pictures. */
  | 'hdr'
  /** Not H.264, or not in MP4/MOV. */
  | 'codec'
  /** H.264 the copy cannot carry safely: not 8-bit 4:2:0, interlaced, unusual NAL framing. */
  | 'bitstream'
  /** Full-range or wide-gamut SDR: seam frames would not match the copied ones. */
  | 'color'
  /** A crop or zoom is set on a moment. */
  | 'crop'
  /** The frame's shape differs from the source's (e.g. vertical video in a 16:9 frame). */
  | 'aspect'
  /** Same shape, different size (e.g. 4K source, 1080p download). */
  | 'resolution'
  /** Non-square pixels. */
  | 'pixel_aspect'
  /** The source is faster than the download's 30 fps (e.g. 50/60 fps, or variable rate above 30). */
  | 'fps'
  /** The source needs the decoder reorder fix (ADR-014 §3). */
  | 'reorder'
  /** No IDR picture inside any range: nothing could be copied. */
  | 'no_keyframe'
  /** Source timestamps are not usable (duplicates, a frame missing at a cut). */
  | 'timing'
  /** This browser cannot encode seam frames that match the source. */
  | 'encoder'
  /** The finished file failed its seam check in this browser's decoder. */
  | 'seam_check'
  /** Something unexpected went wrong in the fast cut; the full encode ran instead. */
  | 'error';

/** What the worker read from the source file, before any packet is copied. */
export interface FastCutSourceFacts {
  /** mediabunny codec id ('avc' for H.264). */
  codec: string | null;
  /** MP4 or QuickTime container. */
  isobmff: boolean;
  hdr: boolean;
  /** SPS from the avcC record; null when unreadable. */
  sps: {
    chromaFormatIdc: number;
    bitDepthLuma: number;
    bitDepthChroma: number;
    frameMbsOnly: boolean;
  } | null;
  /** NAL length prefix size; the copy writes 4-byte prefixes only. */
  lengthSize: number | null;
  displayWidth: number;
  displayHeight: number;
  squarePixels: boolean;
  fullRange: boolean;
  wideGamut: boolean;
  /** The decoder reorder fix (ADR-014 §3) would change the SPS. */
  needsReorderFix: boolean;
}

export type Eligibility = { ok: true } | { ok: false; reason: FastCutFallbackReason };

function isFullFrame(segment: RenderSegment, width: number, height: number): boolean {
  const { crop } = segment;
  return crop.x === 0 && crop.y === 0 && crop.width === width && crop.height === height;
}

/**
 * Whether the plan can be produced without re-encoding the source's pictures.
 * Only checks that need no packet: the frame rate and keyframes are checked
 * against the real packets afterwards (`frameRateWithinPlan`, `planSegmentCut`).
 *
 * The copy keeps the source's own resolution, so it is allowed only when that
 * already IS the download's resolution — "within the 720p/1080p tier" (doc 15,
 * founder decision 2026-09-24) means exactly the sizes the editor offers:
 * 1280x720, 720x1280, 720x720, 1920x1080, 1080x1920, 1080x1080 (after the
 * source's rotation). 1440p, 4K, 480p and odd sizes (e.g. 1920x1088, 592x1280)
 * are encoded to the chosen size, exactly as before.
 */
export function fastCutEligibility(
  plan: Pick<RenderPlan, 'width' | 'height' | 'captions' | 'segments'>,
  source: FastCutSourceFacts,
  mode: ExportMode,
): Eligibility {
  const refuse = (reason: FastCutFallbackReason): Eligibility => ({ ok: false, reason });
  if (mode === 'encode') return refuse('requested_encode');
  if (plan.captions) return refuse('captions');
  if (source.hdr) return refuse('hdr');
  if (source.codec !== 'avc' || !source.isobmff) return refuse('codec');

  const { displayWidth: width, displayHeight: height } = source;
  if (!plan.segments.every((segment) => isFullFrame(segment, width, height))) {
    // A crop on a source whose shape differs from the frame is the framing
    // itself (cover/contain), not a user zoom.
    const sameShape = width * plan.height === height * plan.width;
    return refuse(sameShape ? 'crop' : 'aspect');
  }
  if (width * plan.height !== height * plan.width) return refuse('aspect');
  if (width !== plan.width || height !== plan.height) return refuse('resolution');
  if (!source.squarePixels) return refuse('pixel_aspect');

  const sps = source.sps;
  if (
    !sps ||
    sps.chromaFormatIdc !== 1 ||
    sps.bitDepthLuma !== 8 ||
    sps.bitDepthChroma !== 8 ||
    !sps.frameMbsOnly ||
    source.lengthSize !== 4
  ) {
    return refuse('bitstream');
  }
  if (source.fullRange || source.wideGamut) return refuse('color');
  if (source.needsReorderFix) return refuse('reorder');
  return { ok: true };
}

/**
 * Doc 15 v6 (founder decision 2026-09-24): the download is "en çok 30 fps".
 * A fast-cut copy keeps the source's own frame times, so it is allowed when
 * the source is not faster than the download's rate (`fpsNum/fpsDen`, 30):
 * 24, 25, 29.97, 30 fps and phones' variable rate around 30 are copied at
 * their own rate; 50/60 fps is encoded to 30 fps as before.
 *
 * How "not faster" is judged on a variable-rate source (measured on the real
 * recordings, ADR-027):
 * - Not by the shortest frame interval: nominal 30 fps phone files have
 *   single intervals as short as 1/31.6 s (timestamp jitter), which would
 *   refuse every one of them.
 * - Not by the mean alone: a moment that is 60 fps for a few seconds and slow
 *   elsewhere can average under 30.
 * - Rule: in every stretch of up to one second, the number of frame
 *   intervals may exceed `rate × stretch` by at most ONE frame, and the
 *   moment's mean rate may exceed `rate` by at most 1%. Nominal 30 fps phone
 *   files reach 31 frame starts per second at most; every faster source we
 *   have reaches 47 (a 40 fps VFR file) or 60.
 *
 * `ticks`: presentation times of the moment's frames in source ticks,
 * ascending; `resolution`: ticks per second.
 */
export function frameRateWithinPlan(
  ticks: ArrayLike<number>,
  resolution: number,
  fpsNum: number,
  fpsDen: number,
): boolean {
  const rate = fpsNum / fpsDen;
  const n = ticks.length;
  if (n <= 1) return true;
  const first = ticks[0] ?? 0;
  const last = ticks[n - 1] ?? 0;
  const span = (last - first) / resolution;
  if (!(span > 0)) return false;
  if ((n - 1) / span > rate * 1.01) return false;
  // Slack for timestamps rounded to the source clock.
  const slack = 1e-6 + 2 / resolution;
  let from = 0;
  for (let j = 1; j < n; j += 1) {
    const tj = (ticks[j] ?? 0) / resolution;
    while (tj - (ticks[from] ?? 0) / resolution > 1 + slack) from += 1;
    for (let i = from; i < j; i += 1) {
      const stretch = tj - (ticks[i] ?? 0) / resolution;
      if (j - i > rate * (stretch + slack) + 1) return false;
    }
  }
  return true;
}

/**
 * The reason code for a moment's frame times, or null when they may be
 * copied: `timing` for frames that share a timestamp (nothing to judge a rate
 * on), `fps` for a source faster than the download.
 */
export function frameRateRefusal(
  ticks: ArrayLike<number>,
  resolution: number,
  fpsNum: number,
  fpsDen: number,
): 'fps' | 'timing' | null {
  for (let i = 1; i < ticks.length; i += 1) {
    if ((ticks[i] ?? 0) <= (ticks[i - 1] ?? 0)) return 'timing';
  }
  return frameRateWithinPlan(ticks, resolution, fpsNum, fpsDen) ? null : 'fps';
}

/* ---------------------------------------------------------------- planning */

/**
 * One moment's cut, in the source's packets.
 *
 * - `head`: presentation times (source ticks, ascending) re-encoded before the
 *   copy — from the first marked frame up to the copied IDR's first frame.
 * - `copyFrom`/`copyTo`: packets copied unchanged, as a half-open range in
 *   decode order. `copyFrom` is an IDR; empty when `copyTo === copyFrom`.
 * - `tail`: presentation times re-encoded after the copy, up to the last
 *   marked frame (B-frames: the copy can only stop where every picture shown
 *   so far has been decoded).
 */
export interface SegmentCutPlan {
  head: number[];
  copyFrom: number;
  copyTo: number;
  tail: number[];
  /** Every output frame of the moment, ascending (head, copy, tail). */
  frames: number[];
}

export type SegmentCutResult = { ok: true; cut: SegmentCutPlan } | { ok: false; reason: 'timing' };

/**
 * Packets whose decode order may start a copy: nothing before them is shown
 * after them, and nothing after them is shown before their first picture.
 * Returns their indices, in decode order, whose first picture lies inside
 * [firstTick, lastTick]. Only key packets are candidates; the caller still
 * checks that the one it picks is a real IDR.
 */
export function copyStartCandidates(
  pts: ArrayLike<number>,
  key: ArrayLike<boolean>,
  firstTick: number,
  lastTick: number,
): number[] {
  const n = pts.length;
  const suffixMin = new Float64Array(n + 1);
  suffixMin[n] = Number.POSITIVE_INFINITY;
  for (let i = n - 1; i >= 0; i -= 1) suffixMin[i] = Math.min(pts[i] ?? 0, suffixMin[i + 1] ?? 0);
  const candidates: number[] = [];
  let prefixMax = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < n; i += 1) {
    const first = suffixMin[i] ?? 0;
    if (key[i] && prefixMax < first && first >= firstTick && first <= lastTick) candidates.push(i);
    prefixMax = Math.max(prefixMax, pts[i] ?? 0);
  }
  return candidates;
}

/**
 * The cut of one moment, given the packets around it in decode order
 * (`pts` in source ticks) and the copy start the caller verified as an IDR
 * (`start`, or null when there is none). `firstTick`/`lastTick` are the
 * presentation times of the first and last marked frames.
 *
 * The packet list must cover every packet whose picture lies in the moment,
 * plus the packets decoded right after it (so the end of the copy can be
 * checked); the caller scans one whole GOP past the last frame.
 */
export function planSegmentCut(
  pts: ArrayLike<number>,
  start: number | null,
  firstTick: number,
  lastTick: number,
): SegmentCutResult {
  const n = pts.length;
  const frames: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const t = pts[i] ?? 0;
    if (t >= firstTick && t <= lastTick) frames.push(t);
  }
  frames.sort((a, b) => a - b);
  for (let i = 1; i < frames.length; i += 1) {
    if (frames[i] === frames[i - 1]) return { ok: false, reason: 'timing' };
  }
  if (frames.length === 0 || frames[0] !== firstTick || frames[frames.length - 1] !== lastTick) {
    return { ok: false, reason: 'timing' };
  }

  if (start === null || start < 0 || start >= n) {
    return { ok: true, cut: { head: frames, copyFrom: 0, copyTo: 0, tail: [], frames } };
  }

  const suffixMin = new Float64Array(n + 1);
  suffixMin[n] = Number.POSITIVE_INFINITY;
  for (let i = n - 1; i >= 0; i -= 1) suffixMin[i] = Math.min(pts[i] ?? 0, suffixMin[i + 1] ?? 0);
  const copyFirst = suffixMin[start] ?? 0;

  // The copy may end before packet J when every picture decoded so far is
  // shown before every picture decoded after it, and none is past the end.
  let copyTo = start;
  let maxSoFar = Number.NEGATIVE_INFINITY;
  for (let j = start; j < n; j += 1) {
    maxSoFar = Math.max(maxSoFar, pts[j] ?? 0);
    if (maxSoFar > lastTick) break;
    if (maxSoFar < (suffixMin[j + 1] ?? 0)) copyTo = j + 1;
  }
  if (copyTo === start) {
    return { ok: true, cut: { head: frames, copyFrom: 0, copyTo: 0, tail: [], frames } };
  }
  const copyEnd = copyTo < n ? (suffixMin[copyTo] ?? 0) : Number.POSITIVE_INFINITY;

  const head = frames.filter((t) => t < copyFirst);
  const tail = frames.filter((t) => t >= copyEnd);
  const copied = copyTo - start;
  if (head.length + copied + tail.length !== frames.length) return { ok: false, reason: 'timing' };
  return { ok: true, cut: { head, copyFrom: start, copyTo, tail, frames } };
}
