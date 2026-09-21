/// <reference lib="webworker" />

/**
 * Loudness worker (ADR-018): decodes ONLY the source ranges of the moments
 * and turns them into 10 ms loudness envelopes.
 *
 * Decoding is streamed through `AudioSampleSink`: each decoded chunk is
 * measured and closed at once, so memory stays at one chunk plus the
 * envelope, whatever the file length. Runs off the UI thread so the editor
 * stays responsive; cancel is a `terminate()` from the client, which stops
 * the decode wherever it is.
 */

import { ALL_FORMATS, AudioSampleSink, BlobSource, Input, type InputAudioTrack } from 'mediabunny';

import { ENVELOPE_FRAME_US, LoudnessMeter } from '@/domain/loudness';
import { US_PER_SECOND } from '@/domain/time';
import type { AnalysisFailure, SilenceWorkerRequest, SilenceWorkerResponse } from './protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;

/**
 * Decoding starts this far before each range. A transform codec (AAC, Opus)
 * needs the previous packet to rebuild the first one: started cold, the first
 * ~20 ms come out faded in, which read as a quiet frame at every moment's
 * start. The meter drops the pre-roll samples.
 */
const PREROLL_US = 100_000;

/** Progress is posted at most this often; the UI does not need more. */
const PROGRESS_INTERVAL_MS = 100;

class AnalysisError extends Error {
  constructor(readonly reason: AnalysisFailure) {
    super(reason);
    this.name = 'AnalysisError';
  }
}

function post(message: SilenceWorkerResponse, transfer?: Transferable[]): void {
  if (transfer) scope.postMessage(message, transfer);
  else scope.postMessage(message);
}

async function openTrack(input: Input): Promise<InputAudioTrack> {
  let track: InputAudioTrack | null;
  try {
    track = await input.getPrimaryAudioTrack();
  } catch {
    throw new AnalysisError('unreadable');
  }
  if (!track) throw new AnalysisError('no_audio');
  if (!(await track.canDecode().catch(() => false))) throw new AnalysisError('undecodable');
  return track;
}

async function analyze(request: SilenceWorkerRequest): Promise<void> {
  const { requestId, ranges } = request;
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(request.file) });
  try {
    const track = await openTrack(input);
    const sink = new AudioSampleSink(track);
    const framesTotal = ranges.reduce(
      (sum, range) => sum + Math.max(0, Math.ceil((range.endUs - range.startUs) / ENVELOPE_FRAME_US)),
      0,
    );
    let framesBefore = 0;
    let lastPost = 0;
    post({ type: 'progress', requestId, framesDone: 0, framesTotal });

    // One reusable buffer per channel: a chunk is copied, measured, dropped.
    const planes: Float32Array[] = [];

    for (const range of ranges) {
      let meter: LoudnessMeter | null = null;
      try {
        for await (const sample of sink.samples(
          (range.startUs - PREROLL_US) / US_PER_SECOND,
          range.endUs / US_PER_SECOND,
        )) {
          try {
            // The decoded rate can differ from the declared one (HE-AAC doubles
            // it), so the grid is set from what the decoder really outputs.
            meter ??= new LoudnessMeter(range.startUs, range.endUs, sample.sampleRate);
            const frames = sample.numberOfFrames;
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
            meter.push(channels, Math.round(sample.timestamp * meter.sampleRate), frames);
          } finally {
            sample.close();
          }
          const now = performance.now();
          if (now - lastPost >= PROGRESS_INTERVAL_MS) {
            lastPost = now;
            post({ type: 'progress', requestId, framesDone: framesBefore + meter.framesDone, framesTotal });
          }
        }
      } catch (error) {
        if (error instanceof AnalysisError) throw error;
        throw new AnalysisError('undecodable');
      }
      // No sample at all for this range: the track has no audio there, which
      // is silence as far as the output is concerned (nothing will play).
      meter ??= new LoudnessMeter(range.startUs, range.endUs, track.sampleRate || 48_000);
      const envelope = meter.finish();
      const db = Float32Array.from(envelope.db);
      post(
        { type: 'envelope', requestId, key: range.key, startUs: envelope.startUs, frameUs: envelope.frameUs, db },
        [db.buffer],
      );
      framesBefore += meter.frameCount;
      post({ type: 'progress', requestId, framesDone: framesBefore, framesTotal });
    }
    post({ type: 'done', requestId });
  } finally {
    input.dispose();
  }
}

scope.onmessage = (message: MessageEvent<SilenceWorkerRequest>) => {
  const request = message.data;
  if (request.type !== 'analyze') return;
  analyze(request).catch((error: unknown) => {
    post({
      type: 'failed',
      requestId: request.requestId,
      // Never forward a raw error message: it can contain file paths.
      reason: error instanceof AnalysisError ? error.reason : 'internal_error',
    });
  });
};
