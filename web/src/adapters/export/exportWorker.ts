/// <reference lib="webworker" />

/**
 * The real W1 encode pipeline: decode -> transform -> encode -> mux -> probe.
 *
 * Runs entirely in a Worker (doc 11): decoding, canvas transforms, encoding and
 * muxing never touch the UI thread. Frames and audio samples are closed as soon
 * as they are consumed, and the readers only buffer one chunk ahead.
 *
 * It never reports success it did not verify: the produced bytes are re-opened
 * and probed before `succeeded` is emitted.
 */

import {
  ALL_FORMATS,
  AudioSample,
  AudioSampleSink,
  AudioSampleSource,
  BlobSource,
  BufferSource,
  BufferTarget,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  VideoSampleSink,
  type VideoSample,
  canEncodeAudio,
  canEncodeVideo,
  type InputAudioTrack,
} from 'mediabunny';

import {
  clampBuffers,
  interleave,
  mixStreamInto,
  musicEnvelope,
} from '@/domain/audioMix';
import type { ExportEvent, ExportFailureCode, ExportProbe } from '@/domain/exportEvents';
import { durationWithinTolerance } from '@/domain/exportEvents';
import {
  frameToUs,
  sourceTimeForFrame,
  type RenderPlan,
  type RenderSegment,
} from '@/domain/renderPlan';
import { US_PER_SECOND } from '@/domain/time';
import { AudioStreamReader } from './audioStream';
import type { CapabilityStageResult, EncoderProbeConfig, WorkerRequest, WorkerResponse } from './protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;

/** Audio is mixed in chunks so memory stays flat regardless of duration. */
const AUDIO_CHUNK_FRAMES = 4096;
/** How often the encoding progress event is emitted, in output frames. */
const PROGRESS_EVERY_FRAMES = 5;

class CanceledError extends Error {
  constructor() {
    super('canceled');
    this.name = 'CanceledError';
  }
}

class ExportFailure extends Error {
  constructor(readonly code: ExportFailureCode) {
    super(code);
    this.name = 'ExportFailure';
  }
}

let cancelRequestedFor: string | null = null;

function checkCanceled(requestId: string): void {
  if (cancelRequestedFor === requestId) throw new CanceledError();
}

function emit(requestId: string, event: ExportEvent, transfer?: Transferable[]): void {
  const message: WorkerResponse = { type: 'event', requestId, event };
  if (transfer && transfer.length > 0) scope.postMessage(message, transfer);
  else scope.postMessage(message);
}

/* ------------------------------------------------------------------ probing */

async function probeProduced(bytes: Uint8Array): Promise<ExportProbe> {
  // A fresh Input over the produced bytes: the file is verified the same way a
  // player would open it, not by trusting our own encoder.
  const input = new Input({
    formats: ALL_FORMATS,
    source: new BufferSource(bytes),
  });
  const videoTrack = await input.getPrimaryVideoTrack();
  if (!videoTrack) throw new ExportFailure('output_probe_failed');

  const audioTrack = await input.getPrimaryAudioTrack();
  const durationSeconds = await input.computeDuration();

  return {
    durationUs: Math.round(durationSeconds * US_PER_SECOND),
    width: await videoTrack.getDisplayWidth(),
    height: await videoTrack.getDisplayHeight(),
    videoCodec: await videoTrack.getCodec(),
    audioCodec: audioTrack ? await audioTrack.getCodec() : null,
    hasAudio: audioTrack !== null,
  };
}

/* -------------------------------------------------------- capability gate C */

/**
 * Stage C of doc 11: encode a tiny synthetic clip with the *target* codecs,
 * mux it, then re-open it. Being able to play a file, or having the encoder
 * API present, is not evidence that this path produces a readable MP4.
 */
async function runSelfTest(config: EncoderProbeConfig): Promise<CapabilityStageResult> {
  const result: CapabilityStageResult = {
    videoConfigSupported: false,
    audioConfigSupported: false,
    selfTestPassed: false,
    selfTestDurationUs: null,
    selfTestHasAudio: false,
    failure: null,
  };

  try {
    result.videoConfigSupported = await canEncodeVideo('avc', {
      width: config.width,
      height: config.height,
      bitrate: config.videoBitrate,
    });
    result.audioConfigSupported = await canEncodeAudio('aac', {
      numberOfChannels: config.channelCount,
      sampleRate: config.sampleRate,
      bitrate: config.audioBitrate,
    });
  } catch {
    result.failure = 'internal_error';
    return result;
  }

  if (!result.videoConfigSupported) {
    result.failure = 'video_encoder_unsupported';
    return result;
  }
  if (!result.audioConfigSupported) {
    result.failure = 'audio_encoder_unsupported';
    return result;
  }

  try {
    const width = 320;
    const height = 240;
    const frames = 10;
    const fps = 10;

    const output = new Output({
      format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
      target: new BufferTarget(),
    });
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new ExportFailure('internal_error');

    const videoSource = new CanvasSource(canvas, { codec: 'avc', bitrate: 300_000 });
    output.addVideoTrack(videoSource, { frameRate: fps });

    const audioSource = new AudioSampleSource({
      codec: 'aac',
      bitrate: config.audioBitrate,
    });
    output.addAudioTrack(audioSource);

    await output.start();

    for (let i = 0; i < frames; i += 1) {
      context.fillStyle = i % 2 === 0 ? '#101315' : '#d2ef78';
      context.fillRect(0, 0, width, height);
      await videoSource.add(i / fps, 1 / fps);
    }
    videoSource.close();

    // One second of silence at the target rate/channel count.
    const frameCount = config.sampleRate;
    const silence = new Float32Array(frameCount * config.channelCount);
    await audioSource.add(
      new AudioSample({
        data: silence,
        format: 'f32',
        numberOfChannels: config.channelCount,
        sampleRate: config.sampleRate,
        timestamp: 0,
      }),
    );
    audioSource.close();

    await output.finalize();
    const buffer = output.target.buffer;
    if (!buffer) throw new ExportFailure('output_probe_failed');

    const probe = await probeProduced(new Uint8Array(buffer));
    result.selfTestDurationUs = probe.durationUs;
    result.selfTestHasAudio = probe.hasAudio;
    result.selfTestPassed = probe.width === width && probe.height === height && probe.hasAudio;
    if (!result.selfTestPassed) result.failure = 'output_probe_failed';
  } catch (error) {
    result.failure = error instanceof ExportFailure ? error.code : 'internal_error';
  }

  return result;
}

/* ------------------------------------------------------------------- export */

interface AudioContextSources {
  clipReader: AudioStreamReader | null;
  musicReader: AudioStreamReader | null;
}

async function writeSegmentAudio(
  plan: RenderPlan,
  segment: RenderSegment,
  sources: AudioContextSources,
  audioSource: AudioSampleSource,
  requestId: string,
): Promise<void> {
  const outRate = plan.audio.sampleRate;
  const channels = plan.audio.channelCount;
  const segmentStartUs = frameToUs(segment.startFrame, plan.fpsNum, plan.fpsDen);
  const segmentEndUs = frameToUs(segment.endFrame, plan.fpsNum, plan.fpsDen);

  const firstAudioFrame = Math.round((segmentStartUs * outRate) / US_PER_SECOND);
  const lastAudioFrame = Math.round((segmentEndUs * outRate) / US_PER_SECOND);

  const { clipReader, musicReader } = sources;

  if (clipReader && segment.gain > 0) {
    await clipReader.open(
      segment.sourceInUs / US_PER_SECOND,
      segment.sourceOutUs / US_PER_SECOND,
    );
  }

  for (let frame = firstAudioFrame; frame < lastAudioFrame; frame += AUDIO_CHUNK_FRAMES) {
    checkCanceled(requestId);
    const chunkFrames = Math.min(AUDIO_CHUNK_FRAMES, lastAudioFrame - frame);
    const planar: Float32Array[] = [];
    for (let channel = 0; channel < channels; channel += 1) {
      planar.push(new Float32Array(chunkFrames));
    }

    // --- source clip audio -------------------------------------------------
    if (clipReader && segment.gain > 0 && clipReader.sampleRate > 0) {
      const srcRate = clipReader.sampleRate;
      const chunkStartUs = (frame * US_PER_SECOND) / outRate;
      const offsetUs = chunkStartUs - segmentStartUs;
      const startSourceSeconds = (segment.sourceInUs + offsetUs) / US_PER_SECOND;
      const positionStart = startSourceSeconds * srcRate;
      const positionStep = srcRate / outRate;

      // Buffer forward first, then mix: `pcm` only exists once something
      // has been decoded, and a silent source legitimately never fills it.
      await clipReader.ensure(Math.ceil(positionStart + chunkFrames * positionStep) + 2);
      if (clipReader.pcm) {
        mixStreamInto(
          planar,
          chunkFrames,
          clipReader.pcm,
          positionStart,
          positionStep,
          segment.gain,
        );
        clipReader.release(Math.floor(positionStart) - 1);
      }
    }

    // --- external music ----------------------------------------------------
    const music = plan.audio.music;
    if (musicReader && music) {
      const gains = musicEnvelope(music, frame, chunkFrames, outRate);
      let anyGain = false;
      for (let i = 0; i < chunkFrames; i += 1) {
        if ((gains[i] ?? 0) > 0) {
          anyGain = true;
          break;
        }
      }
      if (anyGain && musicReader.sampleRate > 0) {
        const srcRate = musicReader.sampleRate;
        const chunkStartUs = (frame * US_PER_SECOND) / outRate;
        const musicSourceUs = music.sourceInUs + (chunkStartUs - music.timelineStartUs);
        const positionStart = (musicSourceUs / US_PER_SECOND) * srcRate;
        const positionStep = srcRate / outRate;

        await musicReader.ensure(Math.ceil(positionStart + chunkFrames * positionStep) + 2);
        if (musicReader.pcm) {
          mixStreamInto(planar, chunkFrames, musicReader.pcm, positionStart, positionStep, gains);
          musicReader.release(Math.floor(positionStart) - 1);
        }
      }
    }

    // --- headroom + limiter ------------------------------------------------
    if (plan.audio.safetyGain !== 1) {
      for (const channel of planar) {
        for (let i = 0; i < chunkFrames; i += 1) {
          channel[i] = (channel[i] ?? 0) * plan.audio.safetyGain;
        }
      }
    }
    clampBuffers(planar, chunkFrames);

    await audioSource.add(
      new AudioSample({
        data: interleave(planar, chunkFrames),
        format: 'f32',
        numberOfChannels: channels,
        sampleRate: outRate,
        timestamp: frame / outRate,
      }),
    );
  }
}

async function runExport(
  requestId: string,
  plan: RenderPlan,
  videoFile: File,
  audioFile: File | null,
): Promise<void> {
  const startedAt = Date.now();
  emit(requestId, { type: 'preparing', attemptId: requestId });

  const videoInput = new Input({ formats: ALL_FORMATS, source: new BlobSource(videoFile) });
  const videoTrack = await videoInput.getPrimaryVideoTrack();
  if (!videoTrack) throw new ExportFailure('no_video_track');
  if (!(await videoTrack.canDecode())) throw new ExportFailure('source_undecodable');

  const sourceAudioTrack = await videoInput.getPrimaryAudioTrack();
  const sourceAudioUsable =
    sourceAudioTrack !== null && plan.audio.wantsSourceAudio && (await sourceAudioTrack.canDecode());

  let musicInput: Input | null = null;
  let musicTrack: InputAudioTrack | null = null;
  if (audioFile && plan.audio.music) {
    musicInput = new Input({ formats: ALL_FORMATS, source: new BlobSource(audioFile) });
    musicTrack = await musicInput.getPrimaryAudioTrack();
    if (musicTrack && !(await musicTrack.canDecode())) throw new ExportFailure('audio_undecodable');
  }

  const wantsAudio = sourceAudioUsable || musicTrack !== null;

  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
    target: new BufferTarget(),
  });

  const canvas = new OffscreenCanvas(plan.width, plan.height);
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new ExportFailure('internal_error');

  const videoSource = new CanvasSource(canvas, {
    codec: 'avc',
    bitrate: plan.videoBitrate,
    keyFrameInterval: 2,
  });
  output.addVideoTrack(videoSource, { frameRate: plan.fpsNum / plan.fpsDen });

  let audioSource: AudioSampleSource | null = null;
  if (wantsAudio) {
    audioSource = new AudioSampleSource({ codec: 'aac', bitrate: plan.audioBitrate });
    output.addAudioTrack(audioSource);
  }

  const videoSink = new VideoSampleSink(videoTrack);
  const sources: AudioContextSources = {
    clipReader: sourceAudioUsable && sourceAudioTrack ? new AudioStreamReader(new AudioSampleSink(sourceAudioTrack)) : null,
    musicReader: musicTrack ? new AudioStreamReader(new AudioSampleSink(musicTrack)) : null,
  };

  const frameDuration = plan.fpsDen / plan.fpsNum;
  let framesDone = 0;
  let framesDrawn = 0;

  try {
    await output.start();

    if (sources.musicReader && plan.audio.music) {
      await sources.musicReader.open(
        plan.audio.music.sourceInUs / US_PER_SECOND,
        plan.audio.music.sourceOutUs / US_PER_SECOND,
      );
    }

    emit(requestId, {
      type: 'encoding',
      attemptId: requestId,
      progress: 0,
      framesDone: 0,
      totalFrames: plan.totalFrames,
    });

    for (const segment of plan.segments) {
      checkCanceled(requestId);

      const timestamps: number[] = [];
      for (let frame = segment.startFrame; frame < segment.endFrame; frame += 1) {
        timestamps.push(sourceTimeForFrame(segment, frame, plan.fpsNum, plan.fpsDen));
      }
      if (timestamps.length === 0) continue;

      let frame = segment.startFrame;
      for await (const sample of videoSink.samplesAtTimestamps(timestamps)) {
        checkCanceled(requestId);

        context.fillStyle = plan.background;
        context.fillRect(0, 0, plan.width, plan.height);

        if (sample) {
          // Same rectangle the preview uses, taken straight from the plan.
          drawSegmentFrame(context, sample, segment, plan);
          sample.close();
          framesDrawn += 1;
        }

        await videoSource.add(frame * frameDuration, frameDuration);
        frame += 1;
        framesDone += 1;

        if (framesDone % PROGRESS_EVERY_FRAMES === 0 || framesDone === plan.totalFrames) {
          emit(requestId, {
            type: 'encoding',
            attemptId: requestId,
            progress: plan.totalFrames > 0 ? framesDone / plan.totalFrames : null,
            framesDone,
            totalFrames: plan.totalFrames,
          });
        }
      }

      if (audioSource) {
        await writeSegmentAudio(plan, segment, sources, audioSource, requestId);
      }
    }

    if (framesDrawn === 0) throw new ExportFailure('no_frames_decoded');

    checkCanceled(requestId);
    emit(requestId, { type: 'finalizing', attemptId: requestId });

    videoSource.close();
    audioSource?.close();
    await output.finalize();

    const buffer = output.target.buffer;
    if (!buffer) throw new ExportFailure('output_probe_failed');
    const bytes = new Uint8Array(buffer);

    emit(requestId, { type: 'verifying', attemptId: requestId });
    const probe = await probeProduced(bytes);

    if (!durationWithinTolerance(plan.expectedDurationUs, probe.durationUs, plan.fpsNum, plan.fpsDen)) {
      throw new ExportFailure('output_duration_mismatch');
    }

    emit(
      requestId,
      {
        type: 'succeeded',
        attemptId: requestId,
        result: {
          attemptId: requestId,
          fingerprint: plan.fingerprint,
          sizeBytes: bytes.byteLength,
          probe,
          durationDeltaUs: probe.durationUs - plan.expectedDurationUs,
          elapsedMs: Date.now() - startedAt,
        },
        data: bytes,
      },
      [bytes.buffer],
    );
  } finally {
    await sources.clipReader?.close();
    await sources.musicReader?.close();
    // `finalize()` already tore the output down on the success path; cancel()
    // is the cleanup path for every other exit.
    if (output.state !== 'finalized') {
      await output.cancel().catch(() => undefined);
    }
  }
}

/**
 * Applies the plan's crop rectangle. `VideoSample.draw` accounts for the
 * source's rotation/flip metadata, so the crop is expressed over the same
 * orientation-corrected image the editor showed.
 *
 * Note: `draw` must be called as a method — pulling it into a local variable
 * detaches `this` and breaks it.
 */
function drawSegmentFrame(
  context: OffscreenCanvasRenderingContext2D,
  sample: VideoSample,
  segment: RenderSegment,
  plan: RenderPlan,
): void {
  const crop = segment.crop;

  if (segment.fit === 'cover') {
    sample.draw(context, crop.x, crop.y, crop.width, crop.height, 0, 0, plan.width, plan.height);
    return;
  }

  // contain: fit the cropped region inside the frame and letterbox the rest.
  const scale = Math.min(plan.width / crop.width, plan.height / crop.height);
  const drawWidth = crop.width * scale;
  const drawHeight = crop.height * scale;
  sample.draw(
    context,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    (plan.width - drawWidth) / 2,
    (plan.height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
}

/* ------------------------------------------------------------- message loop */

scope.onmessage = async (message: MessageEvent<WorkerRequest>) => {
  const request = message.data;

  if (request.type === 'cancel') {
    cancelRequestedFor = request.requestId;
    return;
  }

  if (request.type === 'capability') {
    const result = await runSelfTest(request.config);
    const response: WorkerResponse = { type: 'capability', requestId: request.requestId, result };
    scope.postMessage(response);
    return;
  }

  if (request.type === 'export') {
    try {
      await runExport(request.requestId, request.plan, request.videoFile, request.audioFile);
    } catch (error) {
      if (error instanceof CanceledError) {
        emit(request.requestId, { type: 'canceled', attemptId: request.requestId });
      } else if (error instanceof ExportFailure) {
        emit(request.requestId, { type: 'failed', attemptId: request.requestId, code: error.code });
      } else {
        const name = error instanceof Error ? error.name : '';
        emit(request.requestId, {
          type: 'failed',
          attemptId: request.requestId,
          // Never forward the raw message: it can contain file paths.
          code: name === 'RangeError' ? 'out_of_memory' : 'internal_error',
        });
      }
    } finally {
      if (cancelRequestedFor === request.requestId) cancelRequestedFor = null;
    }
  }
};
