/**
 * Pull-based reader over one decoded audio stream.
 *
 * Decoding is sequential and lazy: the reader only pulls far enough ahead of
 * the mixer to satisfy the current output chunk, and drops frames it has
 * already passed. That is the bounded queue doc 11 asks for — the whole track
 * is never held in memory.
 */

import type { AudioSample, AudioSampleSink } from 'mediabunny';
import { PcmRingBuffer } from '@/domain/audioMix';

export class AudioStreamReader {
  private iterator: AsyncGenerator<AudioSample, void, unknown> | null = null;
  private done = false;
  private buffer: PcmRingBuffer | null = null;

  sampleRate = 0;
  channelCount = 0;

  constructor(private readonly sink: AudioSampleSink) {}

  /**
   * Starts a new source range. Any previous range is discarded.
   *
   * Priming here is not an optimisation: `sampleRate` and `pcm` must both be
   * valid the moment `open()` resolves. Leaving a stale `sampleRate` behind
   * from a previous range once made the second moment export silently.
   */
  async open(startSeconds: number, endSeconds: number): Promise<void> {
    await this.close();
    this.iterator = this.sink.samples(startSeconds, endSeconds);
    this.done = false;
    this.buffer = null;
    this.sampleRate = 0;
    this.channelCount = 0;
    // Pull the first sample so the stream's rate and layout are known.
    await this.ensure(0);
  }

  /**
   * Buffers forward until `untilFrame` (absolute frames in the SOURCE clock,
   * i.e. `sourceSeconds * sampleRate`) is available or the range runs out.
   */
  async ensure(untilFrame: number): Promise<void> {
    if (!this.iterator) return;
    while (!this.done && (!this.buffer || this.buffer.endFrame < untilFrame)) {
      const next = await this.iterator.next();
      if (next.done) {
        this.done = true;
        break;
      }
      this.push(next.value);
    }
  }

  private push(sample: AudioSample): void {
    try {
      if (!this.buffer) {
        this.sampleRate = sample.sampleRate;
        this.channelCount = sample.numberOfChannels;
        this.buffer = new PcmRingBuffer(sample.numberOfChannels);
      }

      const channels: Float32Array[] = [];
      for (let channel = 0; channel < sample.numberOfChannels; channel += 1) {
        const bytes = sample.allocationSize({ format: 'f32-planar', planeIndex: channel });
        const data = new Float32Array(bytes / Float32Array.BYTES_PER_ELEMENT);
        sample.copyTo(data, { format: 'f32-planar', planeIndex: channel });
        channels.push(data);
      }

      const startFrame = Math.round(sample.timestamp * sample.sampleRate);
      this.buffer.append(channels, startFrame, sample.numberOfFrames);
    } finally {
      sample.close();
    }
  }

  /** Frees everything before `frame`; call once a chunk has been mixed. */
  release(frame: number): void {
    this.buffer?.trimBefore(frame);
  }

  get pcm(): PcmRingBuffer | null {
    return this.buffer;
  }

  get hasData(): boolean {
    return this.buffer !== null && !this.buffer.isEmpty;
  }

  async close(): Promise<void> {
    const iterator = this.iterator;
    this.iterator = null;
    this.buffer?.clear();
    this.buffer = null;
    this.done = true;
    this.sampleRate = 0;
    this.channelCount = 0;
    if (iterator) {
      // Lets mediabunny tear the decoder down instead of leaking it.
      await iterator.return().catch(() => undefined);
    }
  }
}
