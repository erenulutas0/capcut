/// <reference lib="webworker" />

/**
 * Makes the ONLY thing the cloud transcript route ever sends (ADR-039): a
 * sound-only file of the video, built on this device, off the UI thread.
 *
 * - The sound is decoded exactly as the on-device recogniser reads it
 *   (`streamMono16k`): 16 kHz, one channel, on the video's own clock — sample
 *   `n` is the instant `n / 16000` s of the video, so the word times that
 *   come back are video times.
 * - It is encoded again from those samples into a NEW file with one audio
 *   track and nothing else. The picture is never read; the source's other
 *   tracks, its metadata (title, location, device, creation time) and its
 *   file name are not copied, because nothing of the source container is
 *   copied at all.
 * - Opus at 24 kbit/s in WebM (what the measurement of 11 Oct 2026 sent:
 *   ≈ 0,18 MB per minute). Where the browser has no Opus encoder: AAC at
 *   32 kbit/s in MP4. Where it has neither, this fails and says so — the
 *   on-device route is the way forward. Both containers and both rates are
 *   inside what the proxy accepts (first bytes checked, ≤ 64 kbit/s, ≤ 95 MB).
 *
 * Cancel is a `terminate()` from the page.
 */

import { AudioSample, AudioSampleSource, BufferTarget, Mp4OutputFormat, Output, WebMOutputFormat, canEncodeAudio } from 'mediabunny';

import { originOf, stageOf, staged } from '@/adapters/export/failureStage';
import { AudioFeedError, openAudio, streamMono16k } from '@/adapters/transcript/audioFeed';
import { applyWorkerFault } from '@/adapters/workerFault';
import { caughtFailureDetail, stalledFailureDetail, type ExportStage } from '@/domain/exportFailureDetail';
import type { CloudAudioRequest, CloudAudioResponse } from './cloudAudio.types';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const RATE = 16_000;
/** Samples handed to the encoder at a time (one second): fewer, larger steps than the decoder's frames. */
const BLOCK = RATE;

/** '1' only in a test build (`CLIP_TEST_HOOKS=1`); the published site is built with ''. */
const TEST_HOOKS = process.env.NEXT_PUBLIC_CLIP_TEST_HOOKS === '1';

const FORMATS = [
  { codec: 'opus', bitrate: 24_000, mime: 'audio/webm', make: () => new WebMOutputFormat() },
  { codec: 'aac', bitrate: 32_000, mime: 'audio/mp4', make: () => new Mp4OutputFormat({ fastStart: 'in-memory' }) },
] as const;

const post = (message: CloudAudioResponse, transfer: Transferable[] = []) => scope.postMessage(message, transfer);

/** Where the running work is, for the day it fails or stands still (ADR-042): one of our own words, nothing of the video. */
let stage: ExportStage = 'unknown';

async function extract(request: Extract<CloudAudioRequest, { type: 'extract' }>): Promise<void> {
  const { requestId } = request;
  stage = 'setup';
  // Test builds only: lets a test ask for the fallback container on a browser that has both encoders.
  const only = TEST_HOOKS ? request.testCodec : undefined;
  let format: (typeof FORMATS)[number] | null = null;
  for (const candidate of FORMATS) {
    if (only && candidate.codec !== only) continue;
    if (await canEncodeAudio(candidate.codec, { numberOfChannels: 1, sampleRate: RATE, bitrate: candidate.bitrate }).catch(() => false)) {
      format = candidate;
      break;
    }
  }
  if (!format) {
    post({ type: 'failed', requestId, reason: 'encoder_unavailable' });
    return;
  }

  stage = 'open_source';
  const opened = await openAudio(request.file);
  try {
    stage = 'mux';
    const target = new BufferTarget();
    const output = new Output({ format: format.make(), target });
    const source = new AudioSampleSource({ codec: format.codec, bitrate: format.bitrate });
    output.addAudioTrack(source);
    await output.start();
    stage = 'audio';
    if (TEST_HOOKS && request.testFault) {
      // A test asked this run to break (test builds only): after its first sign of life, as a real one would.
      post({ type: 'progress', requestId, doneS: 0, totalS: opened.durationS });
      await applyWorkerFault(request.testFault);
    }

    const block = new Float32Array(BLOCK);
    let filled = 0;
    let written = 0;
    let lastPost = 0;
    const flush = async () => {
      if (filled === 0) return;
      // A copy: the encoder may still hold the sample when the next block is being filled.
      const sample = new AudioSample({ data: block.slice(0, filled), format: 'f32', numberOfChannels: 1, sampleRate: RATE, timestamp: written / RATE });
      written += filled;
      filled = 0;
      try {
        // Named for "Ayrıntılar": an error here is the encoder's, not the decoder's that is feeding it.
        await staged('audio_encode', () => source.add(sample));
      } finally {
        sample.close();
      }
      const now = Date.now();
      if (now - lastPost >= 200) {
        lastPost = now;
        post({ type: 'progress', requestId, doneS: written / RATE, totalS: Math.max(opened.durationS, written / RATE) });
      }
    };
    const total = await streamMono16k(opened.track, async (samples) => {
      let at = 0;
      while (at < samples.length) {
        const take = Math.min(BLOCK - filled, samples.length - at);
        block.set(samples.subarray(at, at + take), filled);
        filled += take;
        at += take;
        if (filled === BLOCK) await flush();
      }
    });
    await flush();
    if (total === 0) {
      await output.cancel().catch(() => {});
      post({ type: 'failed', requestId, reason: 'no_audio' });
      return;
    }
    stage = 'finalize';
    await output.finalize();
    const buffer = target.buffer;
    if (!buffer || buffer.byteLength === 0) {
      post({ type: 'failed', requestId, reason: 'internal_error' });
      return;
    }
    post({ type: 'done', requestId, buffer, mime: format.mime, codec: format.codec, durationS: total / RATE }, [buffer]);
  } finally {
    opened.input.dispose();
  }
}

scope.onmessage = (message: MessageEvent<CloudAudioRequest>) => {
  const request = message.data;
  if (request.type === 'where') {
    // The work stands still somewhere in an `await`; this handler still runs. Nothing was thrown.
    post({ type: 'where', requestId: request.requestId, detail: stalledFailureDetail(stage) });
    return;
  }
  if (request.type !== 'extract') return;
  stage = 'unknown';
  extract(request).catch((error: unknown) => {
    // Never a raw error text: it can contain file paths. For an error that is not one of our own
    // refusals, what is sent is its name (if it is a known one) and the stage it was raised in.
    const origin = originOf(error);
    const cause = origin ?? error;
    const planned = error instanceof AudioFeedError && origin === undefined;
    post({
      type: 'failed',
      requestId: request.requestId,
      reason: error instanceof AudioFeedError ? error.reason : 'internal_error',
      ...(planned ? {} : { detail: caughtFailureDetail(cause, stageOf(cause) ?? stage) }),
    });
  });
};
