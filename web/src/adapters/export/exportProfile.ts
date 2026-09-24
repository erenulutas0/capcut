/**
 * Where an export's time goes, per stage (ADR-028).
 *
 * The encode worker marks the boundaries of each step of the frame loop
 * (waiting for the decoder, drawing, handing the frame to the encoder, ...)
 * and the clock adds the time between two marks to the named stage. Nothing
 * is kept per frame: a 60-minute export has 108000 frames, and the summary
 * only needs totals, counts and the longest single step.
 *
 * Off by default. The measurement scripts switch it on with the test hook
 * `window.__clipExportProfile` (read by `exportClient` when the worker is
 * created); the app never does. A disabled clock does no work at all.
 */

export type ExportStage =
  /** Opening the source, reorder scan, output preparation, encoder probing. */
  | 'setup'
  /** Waiting for the next decoded frame (demux + decode + frame picking). */
  | 'decodeWait'
  /** Background fill and drawing the source frame (crop/fit/rotation). */
  | 'draw'
  /** HDR only (ADR-022): reading the float16 canvas back. */
  | 'hdrRead'
  /** HDR only: the highlight soft clip into 8-bit RGBA. */
  | 'hdrClip'
  /** HDR only: writing the 8-bit picture into the encoder's canvas. */
  | 'hdrWrite'
  /** Burning in the caption on top of the frame. */
  | 'captions'
  /** Snapshotting the picture into a `VideoFrame`. */
  | 'frameCapture'
  /** Handing the frame to the encoder, including its queue and muxer backpressure. */
  | 'encode'
  /** Posting progress to the page. */
  | 'progress'
  /**
   * Audio stages run alongside the frame loop (ADR-028), on their own lane:
   * their time overlaps the video stages (mostly the encoder wait), so the
   * shares of all stages can add up to more than the wall time.
   */
  /** Audio: decoding source/music audio forward. */
  | 'audioDecode'
  /** Audio: resampling, mixing, gain, limiter, interleaving. */
  | 'audioMix'
  /** Audio: handing mixed chunks to the AAC encoder (and muxer). */
  | 'audioEncode'
  /** Flushing the encoders and closing the file. */
  | 'finalize'
  /** Re-opening the produced file for verification. */
  | 'probe';

export interface StageTotals {
  totalMs: number;
  count: number;
  maxMs: number;
}

export interface ExportProfileSummary {
  wallMs: number;
  frames: number;
  /** Output frames per wall-clock second over the whole export. */
  framesPerSecond: number | null;
  /** Wall time not attributed to any stage (bookkeeping between marks). */
  unattributedMs: number;
  stages: Partial<Record<ExportStage, StageTotals & { meanMs: number; share: number }>>;
}

/** An independent mark/lap pair, for work that interleaves with the main loop. */
export interface StageLane {
  mark(): void;
  lap(stage: ExportStage): void;
}

export interface StageClock {
  readonly enabled: boolean;
  /** A second mark/lap pair adding into the same totals. */
  lane(): StageLane;
  /** Starts (or restarts) the interval measured by the next `lap`. */
  mark(): void;
  /** Adds the time since the last mark to `stage` and marks again. */
  lap(stage: ExportStage): void;
  /** Adds a duration measured elsewhere. */
  add(stage: ExportStage, ms: number): void;
  summary(frames: number): ExportProfileSummary | null;
}

const DISABLED_LANE: StageLane = { mark() {}, lap() {} };

const DISABLED: StageClock = {
  enabled: false,
  lane: () => DISABLED_LANE,
  mark() {},
  lap() {},
  add() {},
  summary: () => null,
};

const round = (value: number): number => Math.round(value * 100) / 100;

export function createStageClock(enabled: boolean, now: () => number = () => performance.now()): StageClock {
  if (!enabled) return DISABLED;

  const startedAt = now();
  let last = startedAt;
  const totals = new Map<ExportStage, StageTotals>();

  const add = (stage: ExportStage, ms: number): void => {
    const value = Math.max(0, ms);
    const entry = totals.get(stage);
    if (entry) {
      entry.totalMs += value;
      entry.count += 1;
      if (value > entry.maxMs) entry.maxMs = value;
    } else {
      totals.set(stage, { totalMs: value, count: 1, maxMs: value });
    }
  };

  return {
    enabled: true,
    lane() {
      let laneLast = now();
      return {
        mark() {
          laneLast = now();
        },
        lap(stage) {
          const at = now();
          add(stage, at - laneLast);
          laneLast = at;
        },
      };
    },
    mark() {
      last = now();
    },
    lap(stage) {
      const at = now();
      add(stage, at - last);
      last = at;
    },
    add,
    summary(frames) {
      const wallMs = now() - startedAt;
      let attributed = 0;
      const stages: ExportProfileSummary['stages'] = {};
      for (const [stage, entry] of totals) {
        attributed += entry.totalMs;
        stages[stage] = {
          totalMs: round(entry.totalMs),
          count: entry.count,
          maxMs: round(entry.maxMs),
          meanMs: round(entry.count > 0 ? entry.totalMs / entry.count : 0),
          share: wallMs > 0 ? Math.round((entry.totalMs / wallMs) * 1000) / 1000 : 0,
        };
      }
      return {
        wallMs: round(wallMs),
        frames,
        framesPerSecond: wallMs > 0 ? round((frames * 1000) / wallMs) : null,
        unattributedMs: round(Math.max(0, wallMs - attributed)),
        stages,
      };
    },
  };
}

/** Prefix of the console line the measurement scripts read. */
export const EXPORT_PROFILE_LOG_PREFIX = '[clip-export-profile]';

/** Worker name suffix that switches profiling on (see `exportClient`). */
export const EXPORT_PROFILE_WORKER_SUFFIX = ':profile';
