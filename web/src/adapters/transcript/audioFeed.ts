/// <reference lib="webworker" />

/**
 * The video's sound as a 16 kHz mono stream on the video's own clock
 * (ADR-036), for the transcript worker.
 *
 * Decoding is streamed through mediabunny's `AudioSampleSink` exactly as the
 * loudness worker does (ADR-018): one decoded chunk at a time, measured and
 * closed. Each chunk is placed by its own timestamp — a gap in the track
 * becomes silence, an overlap is dropped — so sample `n` of the stream is the
 * instant `n / 16000` s of the video, whatever the codec's priming or the
 * track's start offset.
 */

import { ALL_FORMATS, AudioSampleSink, BlobSource, Input, type InputAudioTrack } from 'mediabunny';

import { MonoResampler, downmixToMono } from '@/domain/resample';
import { VAD_SAMPLE_RATE } from '@/domain/speechSpans';

export type AudioOpenFailure = 'no_audio' | 'undecodable' | 'unreadable';

export class AudioFeedError extends Error {
  constructor(readonly reason: AudioOpenFailure) {
    super(reason);
    this.name = 'AudioFeedError';
  }
}

class ConsumerError extends Error {
  constructor(readonly inner: unknown) {
    super('consumer');
  }
}

export interface OpenedAudio {
  input: Input;
  track: InputAudioTrack;
  /** The track's length in seconds, as the container states it. */
  durationS: number;
}

export async function openAudio(file: File): Promise<OpenedAudio> {
  // Exact reads, as in the loudness worker (ADR-028): no read-ahead stream to the end of the file.
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file, { useStreamReader: false }) });
  let track: InputAudioTrack | null;
  try {
    track = await input.getPrimaryAudioTrack();
  } catch {
    input.dispose();
    throw new AudioFeedError('unreadable');
  }
  if (!track) {
    input.dispose();
    throw new AudioFeedError('no_audio');
  }
  if (!(await track.canDecode().catch(() => false))) {
    input.dispose();
    throw new AudioFeedError('undecodable');
  }
  const durationS = await track.computeDuration().catch(() => 0);
  return { input, track, durationS };
}

/**
 * Calls `onChunk` with consecutive 16 kHz mono samples of the whole track, in
 * order. `onChunk` may be async: the decoder waits for it (nothing piles up).
 * Returns the number of 16 kHz samples delivered.
 */
export async function streamMono16k(
  track: InputAudioTrack,
  onChunk: (samples: Float32Array, firstIndex: number) => Promise<void> | void,
): Promise<number> {
  const sink = new AudioSampleSink(track);
  let resampler: MonoResampler | null = null;
  let rate = 0;
  /** Input-rate samples placed so far (the next sample's index on the source clock). */
  let placed = 0;
  let delivered = 0;
  const planes: Float32Array[] = [];
  let mono = new Float32Array(0);

  const emit = async (out: Float32Array) => {
    if (out.length === 0) return;
    const first = delivered;
    delivered += out.length;
    try {
      await onChunk(out, first);
    } catch (error) {
      // The consumer's own failure (the recogniser), not a decode problem.
      throw new ConsumerError(error);
    }
  };

  try {
    for await (const sample of sink.samples()) {
      let frames = 0;
      let at = 0;
      try {
        if (!resampler) {
          rate = sample.sampleRate;
          resampler = new MonoResampler(rate, VAD_SAMPLE_RATE);
        } else if (sample.sampleRate !== rate) {
          // A track that changes its rate half-way is not something to guess about.
          throw new AudioFeedError('undecodable');
        }
        frames = sample.numberOfFrames;
        at = Math.round(sample.timestamp * rate);
        const channels: Float32Array[] = [];
        for (let channel = 0; channel < sample.numberOfChannels; channel += 1) {
          let plane = planes[channel];
          if (!plane || plane.length < frames) {
            plane = new Float32Array(frames);
            planes[channel] = plane;
          }
          const view = plane.subarray(0, frames);
          sample.copyTo(view, { format: 'f32-planar', planeIndex: channel });
          channels.push(view);
        }
        if (mono.length < frames) mono = new Float32Array(frames);
        downmixToMono(channels, frames, mono);
      } finally {
        sample.close();
      }
      // Before the video's zero (codec priming) or over what is already placed: dropped.
      let skip = 0;
      if (at < placed) skip = Math.min(frames, placed - at);
      if (at > placed) {
        // A hole in the track: silence, so later sound keeps its place on the clock.
        const gap = at - placed;
        const zeros = new Float32Array(Math.min(gap, rate));
        for (let left = gap; left > 0; left -= zeros.length) {
          await emit(resampler.push(left >= zeros.length ? zeros : zeros.subarray(0, left)));
        }
        placed = at;
      }
      if (skip < frames) {
        await emit(resampler.push(mono.subarray(skip, frames)));
        placed += frames - skip;
      }
    }
  } catch (error) {
    if (error instanceof ConsumerError) throw error.inner;
    if (error instanceof AudioFeedError) throw error;
    throw new AudioFeedError('undecodable');
  }
  if (resampler) {
    try {
      await emit(resampler.flush());
    } catch (error) {
      throw error instanceof ConsumerError ? error.inner : error;
    }
  }
  return delivered;
}
