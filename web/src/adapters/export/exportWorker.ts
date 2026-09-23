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
  EncodedPacketSink,
  Input,
  Mp4OutputFormat,
  Output,
  VideoSampleSink,
  type VideoSample,
  canEncodeAudio,
  canEncodeVideo,
  type InputAudioTrack,
  type InputVideoTrack,
} from 'mediabunny';

import {
  clampBuffers,
  interleave,
  mixStreamInto,
  musicEnvelope,
} from '@/domain/audioMix';
import { cueIndexAtFrame, preflightCaptions } from '@/domain/captionBurnIn';
import type { CaptionLayout } from '@/domain/captionLayout';
import type { ExportEvent, ExportFailureCode, ExportProbe, StorageShortfall } from '@/domain/exportEvents';
import { encoderVideoBitrate, type VideoEncoderKind } from '@/domain/encoderBitrate';
import { durationWithinTolerance, missingFramesAllowed } from '@/domain/exportEvents';
import {
  frameToUs,
  sourceTimeForFrame,
  type RenderPlan,
  type RenderSegment,
} from '@/domain/renderPlan';
import { requiredFreeBytes } from '@/domain/outputStorage';
import { hdrTransferOf, type HdrTransfer } from '@/domain/hdr';
import { outputRouteRefusal } from '@/domain/policy';
import { US_PER_SECOND } from '@/domain/time';
import {
  CAPTION_FONT_FAMILY,
  canvasMeasure,
  captionFont,
  drawCaptionLayout,
  loadCaptionFont,
} from '../captionRender';
import { AudioStreamReader } from './audioStream';
import {
  avcLengthSize,
  inBandSpsUnderstates,
  raiseAvcReorderDepth,
  reorderDepth,
} from './avcReorder';
import { pickFrames } from './framePicker';
import { createHdrContext, softClippedImage } from './hdrCanvas';
import { probeHdrToneMapping, type HdrProbeResult } from './hdrProbe';
import { removeExportEntry, sweepExportEntries } from './opfsEntries';
import { prepareOutput } from './outputSink';
import type {
  CaptionFontStatus,
  CapabilityStageResult,
  EncoderProbeConfig,
  WorkerRequest,
  WorkerResponse,
} from './protocol';

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
  constructor(
    readonly code: ExportFailureCode,
    /** Set for `caption_does_not_fit`: which recipe line to shorten. */
    readonly cueId?: string,
    /** Set for `output_storage_insufficient`: needed vs reported free space. */
    readonly storage?: StorageShortfall,
  ) {
    super(code);
    this.name = 'ExportFailure';
  }
}

let cancelRequestedFor: string | null = null;

/** OPFS entries this worker created and has not yet been told to release. */
const ownEntries = new Set<string>();

function checkCanceled(requestId: string): void {
  if (cancelRequestedFor === requestId) throw new CanceledError();
}

function emit(requestId: string, event: ExportEvent, transfer?: Transferable[]): void {
  const message: WorkerResponse = { type: 'event', requestId, event };
  if (transfer && transfer.length > 0) scope.postMessage(message, transfer);
  else scope.postMessage(message);
}

/* ------------------------------------------------------------------ probing */

async function probeProduced(produced: Uint8Array | Blob): Promise<ExportProbe> {
  // A fresh Input over the produced file: it is verified the same way a player
  // would open it, not by trusting our own encoder. A disk-backed File is read
  // in place, never copied into memory for the check.
  const input = new Input({
    formats: ALL_FORMATS,
    source: produced instanceof Blob ? new BlobSource(produced) : new BufferSource(produced),
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

/* ------------------------------------------------------------ caption font */

/** Letters the caption must render correctly (Turkish dotted/dotless i, ğ, ş). */
const FONT_PROBE_TEXT = 'İığşçöü ĞŞ Wm 0123';

function isWebOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.origin === value;
  } catch {
    return false;
  }
}

/**
 * Loads the bundled caption typeface into THIS worker and proves the canvas
 * uses it. A font that silently fell back would give a file that differs from
 * the preview, so anything short of proof is reported, never papered over
 * with another font (ADR-015).
 */
async function loadWorkerCaptionFont(origin: string): Promise<CaptionFontStatus> {
  // `fonts` on a worker scope and `FontFace` are both needed; older engines
  // lack them in workers even where the page has them.
  const fonts = (scope as unknown as { fonts?: FontFaceSet }).fonts;
  if (typeof FontFace !== 'function' || !fonts || typeof OffscreenCanvas !== 'function') {
    return 'api_missing';
  }
  if (!isWebOrigin(origin)) return 'load_failed';
  if (!(await loadCaptionFont(fonts, origin))) return 'load_failed';

  let inSet = false;
  fonts.forEach((face) => {
    if (face.family.replace(/["']/g, '') === CAPTION_FONT_FAMILY && face.status === 'loaded') inSet = true;
  });
  if (!inSet) return 'load_failed';

  // The set holding the face is not yet proof the canvas draws with it: the
  // caption font must measure differently from both generic fallbacks.
  const probe = new OffscreenCanvas(8, 8).getContext('2d');
  if (!probe) return 'load_failed';
  const width = (font: string) => {
    probe.font = font;
    return probe.measureText(FONT_PROBE_TEXT).width;
  };
  const caption = width(captionFont(40));
  const fallbacks = [width('700 40px sans-serif'), width('700 40px serif')];
  return fallbacks.every((fallback) => Math.abs(fallback - caption) > 0.5) ? 'loaded' : 'load_failed';
}

/**
 * Loads the font and lays out every cue before any frame is encoded; the
 * returned array is the per-cue layout cache the frame loop draws from.
 */
async function prepareCaptionLayouts(plan: RenderPlan, origin: string): Promise<CaptionLayout[] | null> {
  if (!plan.captions) return null;
  if ((await loadWorkerCaptionFont(origin)) !== 'loaded') {
    throw new ExportFailure('caption_font_unavailable');
  }
  const measureContext = new OffscreenCanvas(8, 8).getContext('2d');
  if (!measureContext) throw new ExportFailure('internal_error');
  const preflight = preflightCaptions(
    plan.captions,
    { width: plan.width, height: plan.height, aspect: plan.aspect },
    canvasMeasure(measureContext),
  );
  if (!preflight.ok) throw new ExportFailure('caption_does_not_fit', preflight.cueId);
  return preflight.layouts;
}

/* -------------------------------------------------------- capability gate C */

/**
 * Stage C of doc 11: encode a tiny synthetic clip with the *target* codecs,
 * mux it, then re-open it. Being able to play a file, or having the encoder
 * API present, is not evidence that this path produces a readable MP4.
 */
async function runSelfTest(
  config: EncoderProbeConfig,
  captionFontOrigin: string | null,
  hdrTransfer: HdrTransfer | null,
): Promise<CapabilityStageResult> {
  const result: CapabilityStageResult = {
    videoConfigSupported: false,
    audioConfigSupported: false,
    selfTestPassed: false,
    selfTestDurationUs: null,
    selfTestHasAudio: false,
    captionFont: null,
    hdrToneMap: null,
    failure: null,
  };

  // Checked first so the answer is reported even when the encoder stages
  // below refuse; it is loaded in the same worker that will later draw it.
  if (captionFontOrigin !== null) {
    result.captionFont = await loadWorkerCaptionFont(captionFontOrigin).catch(
      (): CaptionFontStatus => 'load_failed',
    );
  }

  // Only for an HDR source: does this browser's own conversion, drawn the way
  // the export draws, give a correct SDR picture (ADR-022)?
  if (hdrTransfer !== null) {
    result.hdrToneMap = (await hdrToneMapping(hdrTransfer)).status;
  }

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

/* --------------------------------------------------------- HDR -> SDR check */

const hdrChecks = new Map<HdrTransfer, Promise<HdrProbeResult>>();

/** One check per transfer and worker; the answer cannot change while it lives. */
function hdrToneMapping(transfer: HdrTransfer): Promise<HdrProbeResult> {
  let check = hdrChecks.get(transfer);
  if (!check) {
    check = probeHdrToneMapping(transfer).catch(
      (): HdrProbeResult => ({ status: 'api_missing', failures: ['api:exception'], patches: null }),
    );
    hdrChecks.set(transfer, check);
  }
  return check;
}

/**
 * An HDR source is exported only where the browser's conversion was proven
 * correct; checked here as well as in the gate, so no path reaches the
 * encoder with an unverified HDR picture.
 */
async function refuseUnverifiedHdr(track: InputVideoTrack): Promise<HdrTransfer | null> {
  let transfer: HdrTransfer | null = null;
  try {
    transfer = hdrTransferOf((await track.getColorSpace()).transfer);
  } catch {
    transfer = null;
  }
  if (transfer === null) return null;
  if ((await hdrToneMapping(transfer)).status !== 'verified') {
    throw new ExportFailure('hdr_source_unsupported');
  }
  return transfer;
}

/* ------------------------------------------------------- H.264 reorder fix */

/** Packets whose order is measured from each place the export reads. */
const REORDER_SCAN_PACKETS = 240;

function bytesOf(source: AllowSharedBufferSource): Uint8Array {
  // Not `instanceof SharedArrayBuffer`: that global does not exist on pages
  // without cross-origin isolation, and referencing it throws.
  return ArrayBuffer.isView(source)
    ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
    : new Uint8Array(source);
}

/**
 * Makes the decoder wait for as many reordered frames as the file really has.
 *
 * Some cameras (a GoPro/Ambarella file, ADR-014 §3) declare fewer reorder
 * frames in the SPS than their B-frame pattern needs. FFmpeg — the software
 * H.264 decoder of Chromium, Chrome and Edge — trusts that number and silently
 * drops about one frame per B-group (25% of that file). mediabunny then hands
 * every delivered picture the next pending timestamp, so the export looked
 * perfectly timed while its pictures fell further behind at every GOP.
 *
 * The container's own decode/presentation order is the ground truth: when it
 * shows deeper reordering than the SPS admits, the decoder is configured with
 * a corrected SPS. Streams that are already truthful are left untouched.
 */
async function correctAvcReorder(
  track: InputVideoTrack,
  segments: readonly RenderSegment[],
): Promise<void> {
  if ((await track.getCodec()) !== 'avc') return;
  const config = await track.getDecoderConfig();
  if (!config?.description) return;
  const description = bytesOf(config.description);

  const packets = new EncodedPacketSink(track);
  const metadataOnly = { metadataOnly: true };
  const starts = [await packets.getFirstPacket(metadataOnly)];
  for (const segment of segments) {
    starts.push(await packets.getKeyPacket(segment.sourceInUs / US_PER_SECOND, metadataOnly));
  }

  let depth = 0;
  for (const start of starts) {
    if (!start) continue;
    const times: number[] = [];
    for await (const packet of packets.packets(start, undefined, metadataOnly)) {
      times.push(packet.timestamp);
      if (times.length >= REORDER_SCAN_PACKETS) break;
    }
    depth = Math.max(depth, reorderDepth(times));
  }

  const corrected = raiseAvcReorderDepth(description, depth);
  if (!corrected) return;

  // A parameter set repeated inside the packets overrides the corrected one
  // at every keyframe (measured), so the drops would come back. Such a file is
  // refused rather than exported with pictures that lag their timestamps.
  const lengthSize = avcLengthSize(description);
  for (const segment of segments) {
    const key = await packets.getKeyPacket(segment.sourceInUs / US_PER_SECOND);
    if (key && inBandSpsUnderstates(key.data, lengthSize, depth)) {
      throw new ExportFailure('source_reorder_unfixable');
    }
  }

  // VideoSampleSink reads the decoder config through this public method each
  // time it builds a decoder; overriding it on this one track instance is the
  // narrowest way to hand the corrected SPS to the decoder mediabunny creates
  // (its own browser workarounds still run on top of it).
  const correctedConfig: VideoDecoderConfig = { ...config, description: corrected };
  track.getDecoderConfig = () => Promise.resolve(correctedConfig);
}

/* ------------------------------------------------------------ encoder kind */

/**
 * Whether this browser has a hardware H.264 encoder for the plan's picture.
 * The browser never says which encoder `no-preference` picks, but it does say
 * whether a hardware one exists; without one it is the software encoder
 * (measured: Playwright's Chromium reports none, and its files match Chrome's
 * own `prefer-software` output class, ADR-024).
 */
async function videoEncoderKind(plan: RenderPlan): Promise<VideoEncoderKind> {
  try {
    const hardware = await canEncodeVideo('avc', {
      width: plan.width,
      height: plan.height,
      bitrate: plan.videoBitrate,
      frameRate: plan.fpsNum / plan.fpsDen,
      hardwareAcceleration: 'prefer-hardware',
    });
    return hardware ? 'hardware' : 'software';
  } catch {
    // Unknown: keep the plan's bitrate, as before.
    return 'hardware';
  }
}

/** The bitrate the encoder is configured with (ADR-024). */
async function exportVideoBitrate(plan: RenderPlan): Promise<number> {
  const kind = await videoEncoderKind(plan);
  const bitrate = encoderVideoBitrate(plan.videoBitrate, kind);
  if (bitrate === plan.videoBitrate) return bitrate;
  // A software encoder that would refuse the higher bitrate keeps the plan's.
  const supported = await canEncodeVideo('avc', {
    width: plan.width,
    height: plan.height,
    bitrate,
    frameRate: plan.fpsNum / plan.fpsDen,
  }).catch(() => false);
  return supported ? bitrate : plan.videoBitrate;
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
  origin: string,
  memoryRouteLimitUs: number,
  forceMemoryRoute: boolean,
  storageFreeBytes: number | null,
  storageReserveBytes: number | null,
): Promise<void> {
  const startedAt = Date.now();
  emit(requestId, { type: 'preparing', attemptId: requestId });

  // Before any decoding or output file exists: a missing font or a line that
  // cannot fit is known now, not after minutes of encoding.
  const captionLayouts = await prepareCaptionLayouts(plan, origin);

  const videoInput = new Input({ formats: ALL_FORMATS, source: new BlobSource(videoFile) });
  const videoTrack = await videoInput.getPrimaryVideoTrack();
  if (!videoTrack) throw new ExportFailure('no_video_track');
  if (!(await videoTrack.canDecode())) throw new ExportFailure('source_undecodable');
  const hdrTransfer = await refuseUnverifiedHdr(videoTrack);
  await correctAvcReorder(videoTrack, plan.segments);

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

  // Previous results from this worker are no longer offered once a new export
  // starts; stale files from closed tabs are swept too.
  for (const name of ownEntries) await removeExportEntry(name);
  ownEntries.clear();
  await sweepExportEntries().catch(() => 0);

  const videoBitrate = await exportVideoBitrate(plan);

  // Measured, not guessed (ADR-023): the file is written once, and its size
  // stays under this estimate.
  const sink = await prepareOutput(
    requestId,
    requiredFreeBytes({
      videoBitrate,
      audioBitrate: plan.audioBitrate,
      durationUs: plan.expectedDurationUs,
    }),
    { forceMemory: forceMemoryRoute, storageFreeBytes, reserveBytes: storageReserveBytes },
  );

  // Doc 15 v3: 60 minutes only on the disk route. Refused here, before the
  // first frame, not after minutes of encoding into memory.
  const refusal = outputRouteRefusal(
    { maxMemoryRouteOutputDurationUs: memoryRouteLimitUs },
    sink.availability,
    plan.expectedDurationUs,
  );
  if (refusal) {
    await sink.discard();
    throw new ExportFailure(
      refusal,
      undefined,
      refusal === 'output_storage_insufficient' ? (sink.storage ?? undefined) : undefined,
    );
  }

  const output = new Output({ format: sink.format, target: sink.target });

  const canvas = new OffscreenCanvas(plan.width, plan.height);
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new ExportFailure('internal_error');
  // HDR frames are drawn into a float16 canvas and soft clipped (ADR-022),
  // the same path the runtime check verified; SDR frames draw directly.
  const hdrContext = hdrTransfer ? createHdrContext(plan.width, plan.height) : null;
  if (hdrTransfer && !hdrContext) throw new ExportFailure('hdr_source_unsupported');
  const frameContext = hdrContext ?? context;

  const videoSource = new CanvasSource(canvas, {
    codec: 'avc',
    bitrate: videoBitrate,
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
  let framesMissing = 0;
  let succeeded = false;

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

      // One continuous decode per moment (see framePicker): a flush at every
      // GOP boundary made Chromium drop whole GOPs of real camera footage.
      const firstTs = timestamps[0] ?? 0;
      const lastTs = timestamps[timestamps.length - 1] ?? firstTs;
      const decoded = videoSink.samples(firstTs, lastTs + 0.001);
      let frame = segment.startFrame;
      for await (const { frame: sample, missing } of pickFrames(decoded, timestamps, frameDuration)) {
        checkCanceled(requestId);

        frameContext.fillStyle = plan.background;
        frameContext.fillRect(0, 0, plan.width, plan.height);

        // A frame the decoder did not deliver is counted, never hidden: the
        // previous frame is held (or the background shown when none exists)
        // and the total decides below whether this is still an honest result.
        if (missing) framesMissing += 1;
        if (sample) {
          // Same rectangle the preview uses, taken straight from the plan.
          // The picker owns the sample and closes it; do not close it here.
          drawSegmentFrame(frameContext, sample, segment, plan);
          framesDrawn += 1;
        }
        if (hdrContext) {
          const image = softClippedImage(hdrContext, plan.width, plan.height);
          if (!image) throw new ExportFailure('hdr_source_unsupported');
          context.putImageData(image, 0, 0);
        }

        // Burned in on top of the picture, before the frame is handed to the
        // encoder. Drawn even on a held/background frame: the caption belongs
        // to output time, not to the source frame.
        if (captionLayouts && plan.captions) {
          const cueIndex = cueIndexAtFrame(plan.captions.cues, frame);
          const layout = cueIndex >= 0 ? captionLayouts[cueIndex] : undefined;
          if (layout) drawCaptionLayout(context, layout, plan.captions.style.preset);
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
    if (framesMissing > missingFramesAllowed(plan.totalFrames)) {
      throw new ExportFailure('source_frames_missing');
    }

    checkCanceled(requestId);
    emit(requestId, { type: 'finalizing', attemptId: requestId });

    videoSource.close();
    audioSource?.close();
    await output.finalize();

    const collected = await sink.collect(output.target);
    const produced = collected.file ?? collected.bytes;
    if (!produced || collected.sizeBytes === 0) throw new ExportFailure('output_probe_failed');

    emit(requestId, { type: 'verifying', attemptId: requestId });
    const probe = await probeProduced(produced);

    if (!durationWithinTolerance(plan.expectedDurationUs, probe.durationUs, plan.fpsNum, plan.fpsDen)) {
      throw new ExportFailure('output_duration_mismatch');
    }

    const result = {
      attemptId: requestId,
      fingerprint: plan.fingerprint,
      sizeBytes: collected.sizeBytes,
      route: collected.route,
      probe,
      durationDeltaUs: probe.durationUs - plan.expectedDurationUs,
      elapsedMs: Date.now() - startedAt,
      framesMissing,
    };

    if (collected.file && collected.entryName) {
      ownEntries.add(collected.entryName);
      succeeded = true;
      emit(requestId, {
        type: 'succeeded',
        attemptId: requestId,
        result,
        output: { kind: 'opfs', file: collected.file, entryName: collected.entryName },
      });
    } else if (collected.bytes) {
      succeeded = true;
      emit(
        requestId,
        {
          type: 'succeeded',
          attemptId: requestId,
          result,
          output: { kind: 'memory', data: collected.bytes },
        },
        [collected.bytes.buffer],
      );
    } else {
      throw new ExportFailure('output_probe_failed');
    }
  } finally {
    await sources.clipReader?.close();
    await sources.musicReader?.close();
    // `finalize()` already tore the output down on the success path; cancel()
    // is the cleanup path for every other exit.
    if (output.state !== 'finalized') {
      await output.cancel().catch(() => undefined);
    }
    // A partial or unverified file must never be left behind as if it were a
    // result: only a verified success keeps its file.
    if (!succeeded) await sink.discard();
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
    const result = await runSelfTest(request.config, request.captionFontOrigin, request.hdrTransfer);
    const response: WorkerResponse = { type: 'capability', requestId: request.requestId, result };
    scope.postMessage(response);
    return;
  }

  if (request.type === 'export') {
    try {
      await runExport(
        request.requestId,
        request.plan,
        request.videoFile,
        request.audioFile,
        request.origin,
        request.memoryRouteLimitUs,
        request.forceMemoryRoute,
        request.storageFreeBytes,
        request.storageReserveBytes,
      );
    } catch (error) {
      if (error instanceof CanceledError) {
        emit(request.requestId, { type: 'canceled', attemptId: request.requestId });
      } else if (error instanceof ExportFailure) {
        emit(request.requestId, {
          type: 'failed',
          attemptId: request.requestId,
          code: error.code,
          ...(error.cueId !== undefined ? { cueId: error.cueId } : {}),
          ...(error.storage !== undefined ? { storage: error.storage } : {}),
        });
      } else {
        const name = error instanceof Error ? error.name : '';
        emit(request.requestId, {
          type: 'failed',
          attemptId: request.requestId,
          // Never forward the raw message: it can contain file paths.
          code:
            name === 'RangeError'
              ? 'out_of_memory'
              : name === 'QuotaExceededError'
                ? 'output_storage_full'
                : 'internal_error',
        });
      }
    } finally {
      if (cancelRequestedFor === request.requestId) cancelRequestedFor = null;
    }
  }
};
