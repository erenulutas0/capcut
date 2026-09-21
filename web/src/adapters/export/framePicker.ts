/**
 * Picks the source frame shown at each output instant from a sequentially
 * decoded stream.
 *
 * Why not `VideoSampleSink.samplesAtTimestamps`: it flushes the decoder at
 * every GOP boundary. Chromium's software H.264 decoder then lost a whole GOP
 * of a real 59.94 fps camera file, the sink yielded `null` for those frames,
 * and the export silently filled them with black. Decoding a moment in one
 * continuous pass avoids the flushes; this module maps that pass onto the
 * output frame grid and says honestly when a frame was not delivered.
 *
 * Ownership: every yielded frame still belongs to the picker. The consumer
 * draws it and must not close it; the picker closes each frame once a later
 * one replaces it, and the last one when the pass ends.
 */

export interface TimedFrame {
  /** Presentation time in seconds. */
  timestamp: number;
  /** Seconds; 0 when the container did not say. */
  duration: number;
  close(): void;
}

export interface PickedFrame<T> {
  /** The frame to draw, or null when nothing decodable exists yet. */
  frame: T | null;
  /**
   * True when the decoder left a visible gap here: the frame on screen should
   * have been replaced more than `toleranceS` ago, or there is none at all.
   * `frame` is then the last one delivered (a freeze) or null.
   */
  missing: boolean;
}

/** Small float slack; container timestamps are rational numbers in seconds. */
const EPSILON_S = 0.001;

/**
 * A first frame that starts slightly after the requested instant is the
 * container's start offset (camera files often begin at 0.05 s), not a lost
 * frame. Beyond this it is.
 */
export const LEADING_OFFSET_S = 0.1;

function covers(frame: TimedFrame, target: number, toleranceS: number): boolean {
  if (frame.timestamp > target + EPSILON_S) return false;
  // Unknown duration: nothing proves a gap, so the frame stands until the next.
  if (!(frame.duration > 0)) return true;
  // Exclusive end: the instant a frame ends belongs to the next frame. Hardware
  // decoders drop a single frame now and then; holding its neighbour for less
  // than one output frame is invisible, so only a longer staleness counts.
  return target < frame.timestamp + frame.duration + toleranceS - EPSILON_S;
}

export async function* pickFrames<T extends TimedFrame>(
  frames: AsyncIterable<T>,
  targets: readonly number[],
  /** How stale a held frame may be before it counts as missing; one output frame. */
  toleranceS: number,
): AsyncGenerator<PickedFrame<T>> {
  let current: T | null = null;
  let index = 0;
  // Past the end reads as +Infinity, which ends every "before this frame" loop.
  const target = (): number => targets[index] ?? Number.POSITIVE_INFINITY;

  try {
    for await (const frame of frames) {
      if (current === null) {
        // Targets just before the very first frame are the start offset.
        while (index < targets.length && target() < frame.timestamp - EPSILON_S) {
          const lead = frame.timestamp - target();
          if (lead <= LEADING_OFFSET_S) break;
          yield { frame: null, missing: true };
          index += 1;
        }
        while (index < targets.length && target() < frame.timestamp - EPSILON_S) {
          yield { frame, missing: false };
          index += 1;
        }
      } else {
        // Every target before this frame starts is served by the current one.
        while (index < targets.length && target() < frame.timestamp - EPSILON_S) {
          yield { frame: current, missing: !covers(current, target(), toleranceS) };
          index += 1;
        }
        current.close();
      }
      current = frame;
      if (index >= targets.length) break;
    }

    while (index < targets.length) {
      yield { frame: current, missing: current === null || !covers(current, target(), toleranceS) };
      index += 1;
    }
  } finally {
    (current as T | null)?.close();
  }
}
