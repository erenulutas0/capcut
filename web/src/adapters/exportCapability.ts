'use client';

/**
 * Capability gate, staged exactly as doc 11 describes.
 *
 * Stage A  environment: secure context, Worker, WebCodecs, OffscreenCanvas.
 * Stage B  the browser confirms the *target* encoder configuration.
 * Stage C  a tiny synthetic file is really encoded, muxed and re-opened.
 * Stage D  the user's actual source is probed and declared decodable.
 * Stage E  only a route that passed A-D is offered.
 *
 * A stage that did not run is reported as `null`, never as a pass.
 */

import type { ExportFailureCode } from '@/domain/exportEvents';
import type { RenderPlan } from '@/domain/renderPlan';
import type { CapabilityStageResult, EncoderProbeConfig } from './export/protocol';

export interface EnvironmentStage {
  secureContext: boolean;
  worker: boolean;
  videoEncoder: boolean;
  audioEncoder: boolean;
  videoDecoder: boolean;
  audioDecoder: boolean;
  offscreenCanvas: boolean;
}

export interface SourceStage {
  videoDecodable: boolean;
  audioDecodable: boolean | null;
  sourceVideoCodec: string | null;
  sourceAudioCodec: string | null;
  /** Coded size before rotation, for the support record. */
  codedWidth: number | null;
  codedHeight: number | null;
  rotation: number | null;
  /** Transfer characteristics as the container declares them. */
  transfer: string | null;
  primaries: string | null;
  /**
   * True when the source declares an HDR transfer. There is no verified tone
   * mapping path, so doc 09 says refuse clearly rather than produce wrong
   * colours and call it a success.
   */
  isHdr: boolean;
}

/** PQ and HLG are the HDR transfer functions we must not silently flatten. */
const HDR_TRANSFERS = new Set(['pq', 'smpte2084', 'hlg', 'arib-std-b67']);

export interface CapabilityReportV1 {
  /** True only when every stage that matters actually passed. */
  canExport: boolean;
  environment: EnvironmentStage;
  encoder: CapabilityStageResult | null;
  source: SourceStage | null;
  blockers: ExportFailureCode[];
}

export function checkEnvironment(): EnvironmentStage {
  if (typeof window === 'undefined') {
    return {
      secureContext: false,
      worker: false,
      videoEncoder: false,
      audioEncoder: false,
      videoDecoder: false,
      audioDecoder: false,
      offscreenCanvas: false,
    };
  }
  const global = window as unknown as Record<string, unknown>;
  return {
    secureContext: window.isSecureContext === true,
    worker: typeof global.Worker === 'function',
    videoEncoder: typeof global.VideoEncoder === 'function',
    audioEncoder: typeof global.AudioEncoder === 'function',
    videoDecoder: typeof global.VideoDecoder === 'function',
    audioDecoder: typeof global.AudioDecoder === 'function',
    offscreenCanvas: typeof global.OffscreenCanvas === 'function',
  };
}

export function environmentPasses(stage: EnvironmentStage): boolean {
  return (
    stage.secureContext &&
    stage.worker &&
    stage.videoEncoder &&
    stage.audioEncoder &&
    stage.videoDecoder &&
    stage.audioDecoder &&
    stage.offscreenCanvas
  );
}

export function probeConfigFromPlan(plan: RenderPlan): EncoderProbeConfig {
  return {
    width: plan.width,
    height: plan.height,
    fps: plan.fpsNum / plan.fpsDen,
    videoBitrate: plan.videoBitrate,
    sampleRate: plan.audio.sampleRate,
    channelCount: plan.audio.channelCount,
    audioBitrate: plan.audioBitrate,
  };
}

/** Stage D: read the real file's tracks; never assume from the extension. */
export async function probeSource(videoFile: File, audioFile: File | null): Promise<SourceStage> {
  const { ALL_FORMATS, BlobSource, Input } = await import('mediabunny');

  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(videoFile) });
  const videoTrack = await input.getPrimaryVideoTrack();
  const sourceAudioTrack = await input.getPrimaryAudioTrack();

  let audioDecodable: boolean | null = null;
  if (audioFile) {
    const musicInput = new Input({ formats: ALL_FORMATS, source: new BlobSource(audioFile) });
    const musicTrack = await musicInput.getPrimaryAudioTrack();
    audioDecodable = musicTrack ? await musicTrack.canDecode() : false;
  } else if (sourceAudioTrack) {
    audioDecodable = await sourceAudioTrack.canDecode();
  }

  let transfer: string | null = null;
  let primaries: string | null = null;
  if (videoTrack) {
    try {
      const colorSpace = await videoTrack.getColorSpace();
      transfer = colorSpace.transfer ?? null;
      primaries = colorSpace.primaries ?? null;
    } catch {
      // An unreadable colour space is treated as "unknown", not as HDR.
    }
  }

  return {
    videoDecodable: videoTrack ? await videoTrack.canDecode() : false,
    audioDecodable,
    sourceVideoCodec: videoTrack ? await videoTrack.getCodec() : null,
    sourceAudioCodec: sourceAudioTrack ? await sourceAudioTrack.getCodec() : null,
    codedWidth: videoTrack ? await videoTrack.getCodedWidth() : null,
    codedHeight: videoTrack ? await videoTrack.getCodedHeight() : null,
    rotation: videoTrack ? await videoTrack.getRotation() : null,
    transfer,
    primaries,
    isHdr: transfer !== null && HDR_TRANSFERS.has(transfer),
  };
}

export function buildReport(
  environment: EnvironmentStage,
  encoder: CapabilityStageResult | null,
  source: SourceStage | null,
): CapabilityReportV1 {
  const blockers: ExportFailureCode[] = [];

  if (!environmentPasses(environment)) {
    if (!environment.videoEncoder) blockers.push('video_encoder_unsupported');
    if (!environment.audioEncoder) blockers.push('audio_encoder_unsupported');
    if (!environment.worker) blockers.push('worker_unavailable');
    if (blockers.length === 0) blockers.push('internal_error');
  }

  if (encoder) {
    if (!encoder.videoConfigSupported) blockers.push('video_encoder_unsupported');
    if (!encoder.audioConfigSupported) blockers.push('audio_encoder_unsupported');
    if (!encoder.selfTestPassed && encoder.failure) blockers.push(encoder.failure);
  }

  if (source && !source.videoDecodable) blockers.push('source_undecodable');
  // An HDR source decodes fine but would come out with wrong colours, so it is
  // refused here instead of being quietly flattened to SDR (doc 09).
  if (source && source.isHdr) blockers.push('hdr_source_unsupported');

  const unique = Array.from(new Set(blockers));
  const canExport =
    unique.length === 0 &&
    environmentPasses(environment) &&
    encoder !== null &&
    encoder.selfTestPassed &&
    source !== null &&
    source.videoDecodable &&
    !source.isHdr;

  return { canExport, environment, encoder, source, blockers: unique };
}
