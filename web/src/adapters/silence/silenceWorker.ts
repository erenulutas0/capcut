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

import { ENVELOPE_FRAME_US, LoudnessMeter, splitMeterRange, type MeterPart } from '@/domain/loudness';
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

/**
 * A long range is decoded as up to this many parts at once (ADR-028). The
 * reads below are exact and each one waits on the disk; several parts keep
 * several reads in flight. Parts start on the range's own 10 ms grid, so the
 * joined envelope is the whole range's (unit tested).
 */
const PARALLEL_PARTS = 4;
/** Shorter parts are not worth a second decoder. */
const MIN_PART_US = 30_000_000;

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

/** Decodes one part of a range into its own meter; `planes` is this part's scratch. */
async function measurePart(
  sink: AudioSampleSink,
  part: MeterPart,
  fallbackRate: number,
  onSample: () => void,
  stopped: () => boolean,
): Promise<LoudnessMeter | null> {
  let meter: LoudnessMeter | null = null;
  // One reusable buffer per channel: a chunk is copied, measured, dropped.
  const planes: Float32Array[] = [];
  for await (const sample of sink.samples(
    (part.startUs - PREROLL_US) / US_PER_SECOND,
    part.endUs / US_PER_SECOND,
  )) {
    try {
      // The decoded rate can differ from the declared one (HE-AAC doubles
      // it), so the grid is set from what the decoder really outputs.
      meter ??= new LoudnessMeter(part.startUs, part.endUs, sample.sampleRate);
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
    onSample();
    if (stopped()) break;
  }
  // No sample at all in this part: the track has no audio there, which is
  // silence as far as the output is concerned (nothing will play).
  return meter ?? new LoudnessMeter(part.startUs, part.endUs, fallbackRate);
}

async function analyze(request: SilenceWorkerRequest): Promise<void> {
  const { requestId, ranges } = request;
  // Exact reads (ADR-028): mediabunny's default stream reader opens a new
  // read-ahead stream to the end of the file whenever a read lands more than
  // 128 KiB away from the last one. Audio alone, read out of a high-bitrate
  // file where it sits between large video chunks, does that at every chunk;
  // measured on a 10.5 Mbit/s source it cost +520 MiB, most of it kept after
  // the dialog closed.
  const input = new Input({
    formats: ALL_FORMATS,
    source: new BlobSource(request.file, { useStreamReader: false }),
  });
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

    for (const range of ranges) {
      const parts = splitMeterRange(range.startUs, range.endUs, PARALLEL_PARTS, MIN_PART_US);
      const meters: (LoudnessMeter | null)[] = parts.map(() => null);
      let failed = false;
      const reportProgress = () => {
        const now = performance.now();
        if (now - lastPost < PROGRESS_INTERVAL_MS) return;
        lastPost = now;
        let done = 0;
        for (const meter of meters) done += meter?.framesDone ?? 0;
        post({ type: 'progress', requestId, framesDone: framesBefore + done, framesTotal });
      };
      try {
        await Promise.all(
          parts.map(async (part, index) => {
            try {
              meters[index] = await measurePart(
                sink,
                part,
                track.sampleRate || 48_000,
                reportProgress,
                () => failed,
              );
            } catch (error) {
              failed = true;
              throw error;
            }
          }),
        );
      } catch (error) {
        if (error instanceof AnalysisError) throw error;
        throw new AnalysisError('undecodable');
      }
      // The parts' envelopes end to end are the range's envelope.
      let frameCount = 0;
      const values: number[] = [];
      for (const meter of meters) {
        if (!meter) throw new AnalysisError('undecodable');
        frameCount += meter.frameCount;
        values.push(...meter.finish().db);
      }
      const db = Float32Array.from(values);
      post(
        { type: 'envelope', requestId, key: range.key, startUs: range.startUs, frameUs: ENVELOPE_FRAME_US, db },
        [db.buffer],
      );
      framesBefore += frameCount;
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
