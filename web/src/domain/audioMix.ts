/**
 * Audio mixing maths for the export pipeline.
 *
 * Deliberately pure and Web-Audio-free: the encode pipeline runs in a Worker,
 * where `AudioContext` / `AudioBuffer` do not exist. Everything here operates
 * on planar Float32 PCM so it can be unit-tested in Node and used unchanged in
 * the worker.
 *
 * Limitations that are stated rather than hidden:
 * - resampling is linear interpolation, not a polyphase/sinc resampler;
 * - down-mixing takes channel `i % sourceChannels` rather than a matrixed
 *   down-mix. Both are adequate for the W1 proof and recorded in the ADR.
 */

/** A decoded window of one stream, addressed in that stream's own frames. */
interface PcmBlock {
  startFrame: number;
  frameCount: number;
  channels: Float32Array[];
}

/**
 * Sliding window over one decoded audio stream.
 *
 * Blocks arrive in order; consumed frames are dropped, so memory stays bounded
 * regardless of how long the source is.
 */
export class PcmRingBuffer {
  private blocks: PcmBlock[] = [];

  constructor(readonly channelCount: number) {}

  append(channels: Float32Array[], startFrame: number, frameCount: number): void {
    if (frameCount <= 0) return;
    this.blocks.push({ startFrame, frameCount, channels });
  }

  get firstFrame(): number {
    return this.blocks[0]?.startFrame ?? 0;
  }

  get endFrame(): number {
    const last = this.blocks[this.blocks.length - 1];
    return last ? last.startFrame + last.frameCount : 0;
  }

  get isEmpty(): boolean {
    return this.blocks.length === 0;
  }

  /** Drops every block that ends before `frame`. */
  trimBefore(frame: number): void {
    while (this.blocks.length > 0) {
      const block = this.blocks[0];
      if (!block || block.startFrame + block.frameCount > frame) break;
      this.blocks.shift();
    }
  }

  clear(): void {
    this.blocks = [];
  }

  /** Exact frame value, or 0 outside the buffered range (= silence). */
  frameAt(frame: number, channel: number): number {
    if (frame < 0) return 0;
    for (const block of this.blocks) {
      if (frame < block.startFrame) return 0;
      if (frame < block.startFrame + block.frameCount) {
        const source = block.channels[channel % block.channels.length];
        return source ? (source[frame - block.startFrame] ?? 0) : 0;
      }
    }
    return 0;
  }

  /** Linear interpolation between neighbouring frames. */
  sampleAt(position: number, channel: number): number {
    const base = Math.floor(position);
    const fraction = position - base;
    if (fraction === 0) return this.frameAt(base, channel);
    const a = this.frameAt(base, channel);
    const b = this.frameAt(base + 1, channel);
    return a + (b - a) * fraction;
  }

  /**
   * `destination[i] += sampleAt(positionStart + i·step, channel) · gain[i]`
   * for every output frame whose gain is not 0 — the same arithmetic, in the
   * same order, as calling `sampleAt` and `frameAt` for each frame, so the
   * result is bit for bit the same (tests/unit/audioMix.test.ts compares them).
   *
   * `constantGain` wins over `gainCurve`; past the end of the curve the gain
   * is 0, i.e. the frame is left as it is.
   */
  mixChannelInto(
    destination: Float32Array,
    outFrames: number,
    channel: number,
    positionStart: number,
    positionStep: number,
    constantGain: number | null,
    gainCurve: Float32Array | null,
  ): void {
    if (constantGain !== null) {
      mixFrames(this.blocks, destination, outFrames, channel, positionStart, positionStep, constantGain, null);
    } else if (gainCurve !== null) {
      const frames = Math.min(outFrames, gainCurve.length);
      mixFrames(this.blocks, destination, frames, channel, positionStart, positionStep, 0, gainCurve);
    }
  }
}

/**
 * The loop of `mixChannelInto`, kept free of anything that makes V8 allocate
 * per frame (ADR-029). Before, every output sample went through `sampleAt` →
 * `frameAt` (and a `for…of` over the blocks): measured in the export worker,
 * ~2.3 GiB of short-lived heap objects per 20 minutes of output, about 80 % of
 * everything the worker allocated. That churn is what made the worker's heap,
 * and the browser's memory, grow with the length of the audio.
 *
 * Measured in Chrome (sampling heap profiler, the real `SegmentAudioWriter`
 * in a worker): the per-frame calls 2.3 GiB; one loop that still merged the
 * constant gain and the curve into one value, and read the frames through
 * `0`-initialised values chosen in branches, 0.34 GiB; this form ~1 MiB. So:
 * one gain source per call (`gainCurve` null means `constantGain`), numbers
 * only (`+`), the frame lookup written out twice rather than called.
 */
function mixFrames(
  blocks: readonly PcmBlock[],
  destination: Float32Array,
  frames: number,
  channel: number,
  positionStart: number,
  positionStep: number,
  constantGain: number,
  gainCurve: Float32Array | null,
): void {
  const blockCount = blocks.length;
  const destinationLength = destination.length;
  const fixedGain = +constantGain;
  const step = +positionStep;
  let position = +positionStart;
  for (let i = 0; i < frames; i += 1) {
    const gain = gainCurve === null ? fixedGain : gainCurve[i]!;
    if (gain !== 0) {
      const base = Math.floor(position);
      const fraction = position - base;

      // frameAt(base, channel): the block holding the frame, else silence.
      let a = 0;
      if (base >= 0) {
        for (let k = 0; k < blockCount; k += 1) {
          const block = blocks[k]!;
          if (base < block.startFrame) break;
          if (base < block.startFrame + block.frameCount) {
            const count = block.channels.length;
            const source = count > 0 ? block.channels[channel % count] : undefined;
            const index = base - block.startFrame;
            if (source !== undefined && index < source.length) a = source[index]!;
            break;
          }
        }
      }

      // frameAt(base + 1, channel), only when between two frames.
      let b = 0;
      if (fraction !== 0) {
        const next = base + 1;
        if (next >= 0) {
          for (let k = 0; k < blockCount; k += 1) {
            const block = blocks[k]!;
            if (next < block.startFrame) break;
            if (next < block.startFrame + block.frameCount) {
              const count = block.channels.length;
              const source = count > 0 ? block.channels[channel % count] : undefined;
              const index = next - block.startFrame;
              if (source !== undefined && index < source.length) b = source[index]!;
              break;
            }
          }
        }
      }

      const value = fraction !== 0 ? a + (b - a) * fraction : a;
      const current = i < destinationLength ? destination[i]! : 0;
      destination[i] = current + value * gain;
    }
    position += step;
  }
}

/**
 * Adds one resampled, gain-shaped stream into the output accumulator.
 *
 * `positionStart` / `positionStep` are in source frames, so a 44.1 kHz source
 * feeding a 48 kHz output uses `positionStep = 44100 / 48000`.
 */
export function mixStreamInto(
  out: Float32Array[],
  outFrames: number,
  buffer: PcmRingBuffer,
  positionStart: number,
  positionStep: number,
  gains: Float32Array | number,
): void {
  const constantGain = typeof gains === 'number' ? gains : null;
  if (constantGain === 0) return;
  const gainCurve = constantGain === null ? (gains as Float32Array) : null;

  for (let channel = 0; channel < out.length; channel += 1) {
    const destination = out[channel];
    if (!destination) continue;
    buffer.mixChannelInto(destination, outFrames, channel, positionStart, positionStep, constantGain, gainCurve);
  }
}

/** Hard limiter so a mix that still overshoots cannot wrap around. */
export function clampBuffers(out: Float32Array[], outFrames: number): void {
  for (const channel of out) {
    for (let i = 0; i < outFrames; i += 1) {
      const value = channel[i] ?? 0;
      if (value > 1) channel[i] = 1;
      else if (value < -1) channel[i] = -1;
    }
  }
}

/**
 * Per-output-frame gain envelope for the music track, combining the fade in,
 * the fade out and the "is the music playing at all here" window.
 *
 * Mirrors `mapOutputToMusic` in `timeline.ts` but evaluated on the audio frame
 * grid instead of the video frame grid.
 */
export function musicEnvelope(
  music: {
    sourceInUs: number;
    sourceOutUs: number;
    timelineStartUs: number;
    fadeInUs: number;
    fadeOutUs: number;
    gain: number;
  },
  outFrameStart: number,
  outFrames: number,
  sampleRate: number,
): Float32Array {
  const gains = new Float32Array(outFrames);
  const selectionUs = music.sourceOutUs - music.sourceInUs;
  if (selectionUs <= 0 || music.gain === 0) return gains;

  const usPerFrame = 1_000_000 / sampleRate;
  for (let i = 0; i < outFrames; i += 1) {
    const outputUs = (outFrameStart + i) * usPerFrame;
    const offset = outputUs - music.timelineStartUs;
    if (offset < 0 || offset >= selectionUs) continue;

    let envelope = 1;
    if (music.fadeInUs > 0 && offset < music.fadeInUs) {
      envelope = offset / music.fadeInUs;
    }
    if (music.fadeOutUs > 0 && offset > selectionUs - music.fadeOutUs) {
      envelope = Math.min(envelope, (selectionUs - offset) / music.fadeOutUs);
    }
    gains[i] = music.gain * Math.max(0, Math.min(1, envelope));
  }
  return gains;
}

/** Interleaves planar output into the f32 layout `AudioSample` expects. */
export function interleave(out: Float32Array[], outFrames: number): Float32Array {
  const channelCount = out.length;
  const interleaved = new Float32Array(outFrames * channelCount);
  for (let channel = 0; channel < channelCount; channel += 1) {
    const source = out[channel];
    if (!source) continue;
    for (let i = 0; i < outFrames; i += 1) {
      interleaved[i * channelCount + channel] = source[i] ?? 0;
    }
  }
  return interleaved;
}
