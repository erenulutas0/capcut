/**
 * "Küçült": a download that must come out at or under a file size (ADR-035).
 *
 * Pure and framework-free. Given the output's length, frame and frame rate,
 * whether it has sound, which H.264 encoder the browser has, and a target in
 * bytes, the planner says — before a single frame is encoded — which
 * resolution, video bitrate and audio bitrate to use and how large the file
 * is expected to be, or refuses with the smallest size that is still
 * acceptable. The worker executes the decision, measures the produced file
 * and, when it came out over the target, asks `correctTargetSize` for the
 * next attempt. A file over the target is never reported as fitting.
 *
 * Every constant below is a measurement, not a taste (ADR-035 has the
 * tables): the bit-per-pixel floors come from SSIM against the source on real
 * recordings, the overshoot factors from the real/asked size ratio of each
 * encoder class, the container overhead from the produced files.
 */

import { outputPixelSize, type AspectRatio } from './edl';
import { encoderVideoBitrate, type VideoEncoderKind } from './encoderBitrate';
import { videoBitrateFor, type RenderPlan } from './renderPlan';
import { US_PER_SECOND, type Micros } from './time';

/* ------------------------------------------------------------------ presets */

export type SizePresetId = 'share' | 'whatsapp' | 'email';

export interface SizePreset {
  id: SizePresetId;
  /** The file must be at most this many bytes. */
  bytes: number;
}

/**
 * Targets as data (sources in ADR-035):
 *
 * - `share`: 52 428 800 bytes (50 MiB) — the most a Chromium browser hands to
 *   the share sheet at once; measured, ADR-031.
 * - `whatsapp`: 16 MB for video — Meta's WhatsApp media documentation and the
 *   WhatsApp help centre. The documents do not say whether "MB" is 10^6 or
 *   2^20 bytes, so the smaller reading is used: 16 000 000 bytes.
 * - `email`: 25 MB — Gmail's attachment limit for personal accounts (Google's
 *   help page). Same unit question, same answer: 25 000 000 bytes.
 */
export const SIZE_PRESETS: readonly SizePreset[] = [
  { id: 'share', bytes: 52_428_800 },
  { id: 'email', bytes: 25_000_000 },
  { id: 'whatsapp', bytes: 16_000_000 },
];

export function sizePreset(id: SizePresetId): SizePreset {
  const preset = SIZE_PRESETS.find((item) => item.id === id);
  if (!preset) throw new Error(`unknown size preset: ${id}`);
  return preset;
}

/* ------------------------------------------------------------------- ladder */

/**
 * Short edges the planner may use, best first. 480p is left out on purpose:
 * in every measurement 540p gave a better picture for the same bytes, and
 * 360p an equal or better one up to the end of the measured range (ADR-035).
 */
export const TARGET_SHORT_EDGES = [1080, 720, 540, 360] as const;

/**
 * AAC bitrates, best first; lowered only when nothing fits at the one before.
 * There is no step under 96 kbit/s: Chrome, Edge and Chromium on Windows
 * accept exactly 96, 128, 160 and 192 kbit/s for AAC and refuse 32–80 and
 * 112 (`AudioEncoder.isConfigSupported`, measured; ADR-035).
 */
export const TARGET_AUDIO_BITRATES = [128_000, 96_000] as const;

/** The lowest short edge unless the caller asks for a higher floor (e.g. 720). */
export const DEFAULT_MIN_SHORT_EDGE = 360;

/**
 * The fewest bits per pixel (per frame) a resolution is used at while a
 * smaller one exists (ADR-035, per encoder class).
 *
 * - hardware (Chrome/Edge with a GPU encoder): below it the next smaller
 *   resolution gives the same or a better picture for the same bytes — SSIM
 *   against the source, compared at the download's own top size. The
 *   crossover depends on the footage: 0.02–0.05 bit/pixel on ordinary phone
 *   recordings, above 0.07 on very detailed ones; the median of the 1080p ->
 *   720p crossovers is 0.04.
 * - software (OpenH264: Playwright's Chromium, browsers without a hardware
 *   encoder): this encoder cannot go under a rate that depends on the
 *   footage (0.027 / 0.052 / 0.14 bit/pixel on the three 1080p recordings
 *   measured) — asked for less, it writes the same bytes. 0.055 is the middle
 *   one: under it a typical phone recording does not fit at this size at all.
 */
export const STEP_DOWN_BITS_PER_PIXEL: Record<VideoEncoderKind, number> = {
  hardware: 0.04,
  software: 0.055,
};

/**
 * The fewest bits per pixel at the SMALLEST allowed resolution; below it the
 * download is refused (ADR-035).
 *
 * - hardware: the knee of the measured quality curve — from 0.025 down to
 *   0.015 bit/pixel SSIM falls two to three times as fast as from 0.035 to
 *   0.025, and the encoder starts to miss its bitrate (up to 1.47x).
 * - software: 0.03, just above the lowest rate the encoder reached on the
 *   easiest recording measured (0.027); under it no measured footage fits.
 */
export const REFUSE_BITS_PER_PIXEL: Record<VideoEncoderKind, number> = {
  hardware: 0.025,
  software: 0.03,
};

/**
 * Real/asked video size the first attempt allows for: the video bitrate
 * handed to the encoder is the budget divided by this (ADR-035 overshoot
 * table). A target-size encode asks for a CONSTANT bitrate; a file that still
 * comes out over the target is encoded again.
 */
export const VIDEO_OVERSHOOT: Record<VideoEncoderKind, number> = {
  // Constant bitrate, Chrome and Edge: 0.98–1.02 on four recordings, 1.04–1.09
  // on the fifth (very detailed). The phone's encoder: 1.00. (Variable
  // bitrate measured 1.07–1.30 on the desktop and 1.97 on the phone.)
  hardware: 1.1,
  // Measured 0.98–1.00 wherever the encoder is not at its lowest rate.
  software: 1.02,
};

/** What an encoder is expected to produce of the bitrate it is asked for (for the "≈ 48 MB" shown up front). */
export const VIDEO_EXPECTED_RATIO: Record<VideoEncoderKind, number> = {
  hardware: 1,
  software: 0.99,
};

/** Kept free under the target on every attempt. */
export const TARGET_SAFETY_FRACTION = 0.01;

/** A retry aims this far under the target per attempt already made (it knows the encoder's real ratio by then). */
export const RETRY_SAFETY_FRACTION = 0.03;

/**
 * A real/asked ratio above this is not rate-control error: the encoder is at
 * its coarsest quantiser and cannot go lower at this resolution, so the retry
 * steps the resolution down instead of asking for fewer bits again.
 */
export const SATURATION_RATIO = 1.3;

/** Headroom on the pixel-count prediction when a saturated encoder is stepped down (ADR-035). */
export const SATURATED_STEP_MARGIN = 1.2;

/** Encodes per target-size download, the first one included. */
export const MAX_TARGET_ATTEMPTS = 3;

/**
 * MP4 bytes that are not picture or sound (ADR-035, measured on produced
 * files): a fixed part (ftyp, moov headers, track boxes) and the sample
 * tables, which grow with every video frame and every AAC packet.
 */
export const CONTAINER_FIXED_BYTES = 1500;
export const CONTAINER_BYTES_PER_VIDEO_FRAME = 5;
export const CONTAINER_BYTES_PER_AUDIO_PACKET = 4;
const AAC_FRAME_SAMPLES = 1024;

export function containerOverheadBytes(input: {
  durationUs: Micros;
  fps: number;
  audioSampleRate: number | null;
}): number {
  const seconds = input.durationUs / US_PER_SECOND;
  const videoFrames = Math.ceil(seconds * input.fps);
  const audioPackets =
    input.audioSampleRate === null ? 0 : Math.ceil((seconds * input.audioSampleRate) / AAC_FRAME_SAMPLES) + 3;
  return Math.ceil(
    CONTAINER_FIXED_BYTES +
      videoFrames * CONTAINER_BYTES_PER_VIDEO_FRAME +
      audioPackets * CONTAINER_BYTES_PER_AUDIO_PACKET,
  );
}

/* ------------------------------------------------------------------ planner */

/** What the caller asks for. */
export interface TargetSizeRequest {
  /** The file must be at most this many bytes. */
  targetBytes: number;
  /** Never go below this short edge (default 360). Pass 720 to stay inside doc 15's 720p/1080p row. */
  minShortEdge?: number;
}

/** What the planner needs to know about the download. */
export interface TargetSizeFacts {
  durationUs: Micros;
  aspect: AspectRatio;
  fpsNum: number;
  fpsDen: number;
  /** The largest short edge worth encoding: the project's quality, or less for a small source. */
  maxShortEdge: number;
  /** Null when the download has no sound. */
  audioSampleRate: number | null;
  /**
   * The AAC bitrates this browser can really write, best first (default:
   * `TARGET_AUDIO_BITRATES`). The worker leaves out a bitrate whose encoder
   * delay it cannot measure (ADR-032): Chrome on Android accepted 96 kbit/s
   * and then failed that check, so there only 128 kbit/s is used.
   */
  audioBitrates?: readonly number[];
  /** Which encoder the browser has for a frame of this size. */
  encoderKind: (width: number, height: number) => VideoEncoderKind;
}

export interface TargetSizeDecision {
  ok: true;
  targetBytes: number;
  shortEdge: number;
  width: number;
  height: number;
  /** The bitrate handed to the encoder (no further factor is applied, ADR-024 included). */
  videoBitrate: number;
  /** 0 when the download has no sound. */
  audioBitrate: number;
  encoderKind: VideoEncoderKind;
  /**
   * `normal`: the ordinary download already fits, nothing was lowered.
   * `reduced`: bitrate (and perhaps resolution, audio) lowered to fit.
   */
  mode: 'normal' | 'reduced';
  /** The size the file is expected to have ("≈ 48 MB"). At most `targetBytes`. */
  plannedBytes: number;
  /** 1 for the plan made up front; 2, 3 for corrections after a measured file. */
  attempt: number;
}

export interface TargetSizeRefusal {
  ok: false;
  reason: 'target_too_small';
  targetBytes: number;
  /** The smallest target this download can meet at the lowest acceptable quality. */
  minBytes: number;
  /** The longest output that fits `targetBytes` at the lowest acceptable quality (0: none). */
  maxDurationUs: Micros;
  /** The resolution `minBytes` is for. */
  shortEdge: number;
}

export type TargetSizePlan = TargetSizeDecision | TargetSizeRefusal;

/** The rungs a download may use, best first: never above `maxShortEdge`, never below the floor. */
export function targetShortEdges(maxShortEdge: number, minShortEdge: number = DEFAULT_MIN_SHORT_EDGE): number[] {
  const rungs = TARGET_SHORT_EDGES.filter((edge) => edge <= maxShortEdge && edge >= minShortEdge);
  if (rungs.length > 0) return rungs;
  // Nothing in between (e.g. floor 720 and a 480p cap): the floor itself.
  const floor = TARGET_SHORT_EDGES.filter((edge) => edge >= minShortEdge).pop() ?? TARGET_SHORT_EDGES[0];
  return [floor];
}

/**
 * The largest rung worth encoding for a source: the project's quality, but not
 * a rung larger than the first one that already holds the whole source
 * picture (a 480p recording is not blown up to 1080p to be squeezed again).
 */
export function maxTargetShortEdge(exportShortEdge: number, sourceShortEdge: number | null): number {
  const quality = TARGET_SHORT_EDGES.find((edge) => edge <= exportShortEdge) ?? TARGET_SHORT_EDGES[TARGET_SHORT_EDGES.length - 1];
  if (sourceShortEdge === null || !(sourceShortEdge > 0)) return quality as number;
  const holding = [...TARGET_SHORT_EDGES].reverse().find((edge) => edge >= sourceShortEdge) ?? TARGET_SHORT_EDGES[0];
  return Math.min(quality as number, holding);
}

interface Rung {
  shortEdge: number;
  width: number;
  height: number;
  kind: VideoEncoderKind;
  /** The fewest video bits per second this rung is used at. */
  floorBitrate: number;
  /** The ordinary download's encoder bitrate at this size: never exceeded. */
  normalBitrate: number;
}

function rungOf(facts: TargetSizeFacts, shortEdge: number, smallest: boolean): Rung {
  const { width, height } = outputPixelSize(facts.aspect, shortEdge);
  const fps = facts.fpsNum / facts.fpsDen;
  const kind = facts.encoderKind(width, height);
  const floor = smallest ? REFUSE_BITS_PER_PIXEL[kind] : STEP_DOWN_BITS_PER_PIXEL[kind];
  return {
    shortEdge,
    width,
    height,
    kind,
    floorBitrate: Math.ceil(width * height * fps * floor),
    normalBitrate: encoderVideoBitrate(videoBitrateFor(width, height, fps), kind),
  };
}

/** The download's rungs, best first; the last one carries the refusal floor. */
function rungsOf(request: TargetSizeRequest, facts: TargetSizeFacts): Rung[] {
  const edges = targetShortEdges(facts.maxShortEdge, request.minShortEdge);
  return edges.map((edge, index) => rungOf(facts, edge, index === edges.length - 1));
}

function overheadOf(facts: TargetSizeFacts): number {
  return containerOverheadBytes({
    durationUs: facts.durationUs,
    fps: facts.fpsNum / facts.fpsDen,
    audioSampleRate: facts.audioSampleRate,
  });
}

/** Bytes of `bitrate` over the download's length. */
function bytesAt(bitrate: number, durationUs: Micros): number {
  return (bitrate * (durationUs / US_PER_SECOND)) / 8;
}

function expectedBytes(facts: TargetSizeFacts, rung: Rung, videoBitrate: number, audioBitrate: number): number {
  return Math.ceil(
    bytesAt(videoBitrate * VIDEO_EXPECTED_RATIO[rung.kind] + audioBitrate, facts.durationUs) + overheadOf(facts),
  );
}

/**
 * The plan for a target, made before anything is encoded.
 *
 * The audio keeps 128 kbit/s as long as any resolution fits with it; it is
 * lowered to 96 only when nothing does. For each audio bitrate the
 * largest resolution whose bits per pixel stay above the measured floor wins.
 * The video bitrate never exceeds the ordinary download's: when that already
 * fits, the plan is the ordinary download (`mode: 'normal'`).
 */
export function planTargetSize(request: TargetSizeRequest, facts: TargetSizeFacts): TargetSizePlan {
  const fitting = fit(request, facts);
  if (fitting) return fitting;

  // Refused: say what would work instead.
  const targetBytes = Math.floor(request.targetBytes);
  const rungs = rungsOf(request, facts);
  const last = rungs[rungs.length - 1] as Rung;
  const ladder = audioLadderOf(facts);
  const lowestAudio = ladder[ladder.length - 1] ?? 0;
  const minRate = last.floorBitrate * VIDEO_OVERSHOOT[last.kind] + lowestAudio;
  let minBytes = Math.ceil((bytesAt(minRate, facts.durationUs) + overheadOf(facts)) / (1 - TARGET_SAFETY_FRACTION));
  // Rounding inside the plan can leave the formula a few bytes short.
  while (!fit({ ...request, targetBytes: minBytes }, facts)) minBytes += 64;

  // The longest output that fits the target: the same planner, asked about
  // shorter and shorter lengths (fitting is monotonic in the length).
  let low = 0;
  let high = facts.durationUs;
  while (high - low > 1000) {
    const middle = Math.floor((low + high) / 2);
    if (middle > 0 && fit(request, { ...facts, durationUs: middle })) low = middle;
    else high = middle;
  }
  return {
    ok: false,
    reason: 'target_too_small',
    targetBytes,
    minBytes,
    maxDurationUs: low,
    shortEdge: last.shortEdge,
  };
}

/** The audio bitrates to try, best first; `[0]` for a download without sound. */
function audioLadderOf(facts: TargetSizeFacts): readonly number[] {
  if (facts.audioSampleRate === null) return [0];
  const usable = facts.audioBitrates ?? TARGET_AUDIO_BITRATES;
  return usable.length > 0 ? usable : TARGET_AUDIO_BITRATES;
}

/** The plan when the target can be met, or null. */
function fit(request: TargetSizeRequest, facts: TargetSizeFacts): TargetSizeDecision | null {
  const targetBytes = Math.floor(request.targetBytes);
  const seconds = Math.max(facts.durationUs / US_PER_SECOND, 0.001);
  const rungs = rungsOf(request, facts);
  const overhead = overheadOf(facts);
  const audioLadder = audioLadderOf(facts);
  /** Bits per second left for picture and sound together. */
  const totalBitrate = ((targetBytes * (1 - TARGET_SAFETY_FRACTION) - overhead) * 8) / seconds;

  for (const audioBitrate of audioLadder) {
    for (const [index, rung] of rungs.entries()) {
      const budget = (totalBitrate - audioBitrate) / VIDEO_OVERSHOOT[rung.kind];
      // The ordinary download at the best size, when it fits as it is.
      if (index === 0 && audioBitrate === audioLadder[0] && budget >= rung.normalBitrate) {
        return decision(facts, rung, targetBytes, rung.normalBitrate, audioBitrate, 'normal', 1);
      }
      if (budget >= rung.floorBitrate) {
        const videoBitrate = Math.floor(Math.min(budget, rung.normalBitrate));
        return decision(facts, rung, targetBytes, videoBitrate, audioBitrate, 'reduced', 1);
      }
    }
  }
  return null;
}

function decision(
  facts: TargetSizeFacts,
  rung: Rung,
  targetBytes: number,
  videoBitrate: number,
  audioBitrate: number,
  mode: TargetSizeDecision['mode'],
  attempt: number,
): TargetSizeDecision {
  return {
    ok: true,
    targetBytes,
    shortEdge: rung.shortEdge,
    width: rung.width,
    height: rung.height,
    videoBitrate,
    audioBitrate,
    encoderKind: rung.kind,
    mode,
    plannedBytes: Math.min(targetBytes, expectedBytes(facts, rung, videoBitrate, audioBitrate)),
    attempt,
  };
}

/* --------------------------------------------------------------- correction */

/** What an attempt really produced. */
export interface TargetSizeMeasurement {
  /** The whole file (or, for an attempt stopped early, what it would have been). */
  fileBytes: number;
  /** The encoded video packets of that file. */
  videoBytes: number;
}

/**
 * The next attempt after a file that came out over the target, or null when
 * there is none left (then the real size is reported, never "fits").
 *
 * The encoder's real ratio is now known. Slightly over: the same resolution
 * with the bitrate scaled to the bytes the video may have. Far over
 * (`SATURATION_RATIO`), or scaled below the floor: the next resolution down,
 * with what was learned about the ratio. Audio is left as planned.
 */
export function correctTargetSize(
  request: TargetSizeRequest,
  facts: TargetSizeFacts,
  previous: TargetSizeDecision,
  measured: TargetSizeMeasurement,
): TargetSizeDecision | null {
  if (measured.fileBytes <= previous.targetBytes) return null;
  if (previous.attempt >= MAX_TARGET_ATTEMPTS) return null;

  const seconds = Math.max(facts.durationUs / US_PER_SECOND, 0.001);
  const rungs = rungsOf(request, facts);
  const index = rungs.findIndex((rung) => rung.shortEdge === previous.shortEdge);
  const current = rungs[index];
  if (!current) return null;

  // Everything in the file that was not video stays as it was.
  const otherBytes = Math.max(0, measured.fileBytes - measured.videoBytes);
  // 3% under the target on the second attempt, 6% on the third.
  const videoBudgetBytes = previous.targetBytes * (1 - RETRY_SAFETY_FRACTION * previous.attempt) - otherBytes;
  if (videoBudgetBytes <= 0) return null;
  const askedBytes = bytesAt(previous.videoBitrate, facts.durationUs);
  const ratio = askedBytes > 0 ? measured.videoBytes / askedBytes : Number.POSITIVE_INFINITY;
  const attempt = previous.attempt + 1;

  const scaled = Math.floor(((videoBudgetBytes * 8) / seconds / ratio));
  if (ratio <= SATURATION_RATIO && scaled >= current.floorBitrate) {
    return {
      ...previous,
      videoBitrate: scaled,
      mode: 'reduced',
      plannedBytes: Math.min(previous.targetBytes, Math.ceil(videoBudgetBytes + otherBytes)),
      attempt,
    };
  }

  // The next resolution down. The encoder's ratio there is not known; an
  // encoder that overshot keeps at least the planner's allowance.
  let lower = rungs[index + 1];
  if (!lower) {
    // Already the smallest size: one more try with the scaled bitrate, even
    // under the floor — a file that fits a little rougher, or the honest size.
    if (!(scaled > 0) || ratio > SATURATION_RATIO) return null;
    return { ...previous, videoBitrate: scaled, mode: 'reduced', plannedBytes: previous.targetBytes, attempt };
  }
  if (ratio > SATURATION_RATIO) {
    // A saturated encoder's bytes follow the pixel count (measured, ADR-035):
    // the largest smaller size whose predicted bytes fit, not just the next.
    const perPixel = measured.videoBytes / (current.width * current.height);
    lower =
      rungs
        .slice(index + 1)
        .find((rung) => perPixel * rung.width * rung.height * SATURATED_STEP_MARGIN <= videoBudgetBytes) ??
      (rungs[rungs.length - 1] as Rung);
  }
  const allowance = Math.max(VIDEO_OVERSHOOT[lower.kind], Math.min(ratio, SATURATION_RATIO));
  const budget = Math.floor((videoBudgetBytes * 8) / seconds / allowance);
  const videoBitrate = Math.max(1, Math.min(budget, lower.normalBitrate));
  return {
    ...previous,
    shortEdge: lower.shortEdge,
    width: lower.width,
    height: lower.height,
    encoderKind: lower.kind,
    videoBitrate,
    mode: 'reduced',
    plannedBytes: Math.min(previous.targetBytes, Math.ceil(bytesAt(videoBitrate, facts.durationUs) + otherBytes)),
    attempt,
  };
}

/* ---------------------------------------------------------------- estimate */

/**
 * Output pixels a full encode gets through per second of wall clock, by
 * encoder class (ADR-035: measured on one desktop; a phone is slower). Only
 * for the rough "about a minute" shown before a download starts — never for
 * progress, which is counted in real frames.
 */
export const ENCODE_PIXELS_PER_SECOND: Record<VideoEncoderKind, number> = {
  hardware: 300_000_000,
  software: 120_000_000,
};

/** A rough wall-clock estimate for encoding `totalFrames` at the decided size, in seconds. */
export function estimateEncodeSeconds(
  decision: Pick<TargetSizeDecision, 'width' | 'height' | 'encoderKind'>,
  totalFrames: number,
): number {
  const pixels = decision.width * decision.height * Math.max(0, totalFrames);
  return Math.max(1, Math.ceil(pixels / ENCODE_PIXELS_PER_SECOND[decision.encoderKind]));
}

/* ------------------------------------------------------------- plan helpers */

/**
 * The short edge the plan's frame would have if the source pixels it shows
 * were not scaled at all: a 1080p landscape recording cropped to 9:16 has
 * only 608 real pixels across, whatever the download's quality says. The
 * largest value over the kesitler, or null for a plan without segments.
 */
export function nativeShortEdge(plan: Pick<RenderPlan, 'width' | 'height' | 'segments'>): number | null {
  let best: number | null = null;
  for (const segment of plan.segments) {
    const { width, height } = segment.crop;
    if (!(width > 0) || !(height > 0)) continue;
    const scaleX = plan.width / width;
    const scaleY = plan.height / height;
    const scale = segment.fit === 'cover' ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);
    const edge = Math.min(plan.width, plan.height) / scale;
    best = best === null ? edge : Math.max(best, edge);
  }
  return best === null ? null : Math.round(best);
}

/** The planner's facts for a compiled plan. */
export function targetSizeFacts(
  plan: Pick<RenderPlan, 'expectedDurationUs' | 'aspect' | 'fpsNum' | 'fpsDen' | 'audio'>,
  options: {
    maxShortEdge: number;
    hasAudio: boolean;
    encoderKind: (width: number, height: number) => VideoEncoderKind;
    audioBitrates?: readonly number[];
  },
): TargetSizeFacts {
  return {
    durationUs: plan.expectedDurationUs,
    aspect: plan.aspect,
    fpsNum: plan.fpsNum,
    fpsDen: plan.fpsDen,
    maxShortEdge: options.maxShortEdge,
    audioSampleRate: options.hasAudio ? plan.audio.sampleRate : null,
    ...(options.audioBitrates ? { audioBitrates: options.audioBitrates } : {}),
    encoderKind: options.encoderKind,
  };
}

/**
 * The plan the worker encodes for a decision: the same frames, cuts, crop and
 * captions, at the decided size and bitrates. The fingerprint changes with
 * the size, so a finished target-size file is never taken for the ordinary
 * download of the same kesit.
 */
export function planForTargetSize(plan: RenderPlan, decision: TargetSizeDecision): RenderPlan {
  return {
    ...plan,
    width: decision.width,
    height: decision.height,
    videoBitrate: decision.videoBitrate,
    audioBitrate: decision.audioBitrate > 0 ? decision.audioBitrate : plan.audioBitrate,
    fingerprint: `${baseFingerprint(plan.fingerprint)}.ts${decision.targetBytes}`,
  };
}

/** A plan's fingerprint without the target-size / audio-only suffix. */
export function baseFingerprint(fingerprint: string): string {
  const dot = fingerprint.indexOf('.');
  return dot < 0 ? fingerprint : fingerprint.slice(0, dot);
}

/** What the result of a target-size download carries: planned against measured. */
export interface TargetSizeOutcome {
  targetBytes: number;
  /** What the planner expected for the attempt that produced the file. */
  plannedBytes: number;
  /** The first plan's expectation (what was shown up front). */
  firstPlannedBytes: number;
  /** The produced file. */
  actualBytes: number;
  /** `actualBytes <= targetBytes`, from the file itself. */
  fits: boolean;
  /** Encodes it took (1: no correction). 0 when the source's pictures were copied. */
  attempts: number;
  shortEdge: number;
  videoBitrate: number;
  audioBitrate: number;
  encoderKind: VideoEncoderKind;
  mode: TargetSizeDecision['mode'] | 'copy';
}
