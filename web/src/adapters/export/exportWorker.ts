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
  EncodedAudioPacketSource,
  EncodedPacketSink,
  Input,
  Mp4OutputFormat,
  Output,
  VideoSample,
  VideoSampleSink,
  VideoSampleSource,
  canEncodeAudio,
  canEncodeVideo,
  type InputAudioTrack,
  type InputVideoTrack,
} from 'mediabunny';

import { cueIndexAtFrame, preflightCaptions } from '@/domain/captionBurnIn';
import type { CaptionLayout } from '@/domain/captionLayout';
import type {
  ExportEvent,
  ExportFailureCode,
  ExportProbe,
  ExportResult,
  StorageShortfall,
  TargetSizeShortfall,
} from '@/domain/exportEvents';
import { encoderVideoBitrate, type VideoEncoderKind } from '@/domain/encoderBitrate';
import { audioDurationWithinTolerance, durationWithinTolerance, missingFramesAllowed } from '@/domain/exportEvents';
import type { ExportMode, FastCutFallbackReason } from '@/domain/fastPath';
import { frameToUs, sourceTimeForFrame, type RenderPlan, type RenderSegment } from '@/domain/renderPlan';
import { nominalOutputBytes, requiredFreeBytes } from '@/domain/outputStorage';
import {
  MAX_TARGET_ATTEMPTS,
  TARGET_AUDIO_BITRATES,
  TARGET_SAFETY_FRACTION,
  containerOverheadBytes,
  correctTargetSize,
  planForTargetSize,
  planTargetSize,
  targetSizeFacts,
  type TargetSizeDecision,
  type TargetSizeFacts,
  type TargetSizeMeasurement,
} from '@/domain/targetSize';
import { outputPixelSize } from '@/domain/edl';
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
import { AacAlignmentError, AlignedAacEncoder, measureAacEncoderDelay, type AacSettings } from './alignedAac';
import { AudioStreamReader } from './audioStream';
import { MediaPacer } from './exportPacing';
import {
  EXPORT_PROFILE_LOG_PREFIX,
  EXPORT_PROFILE_WORKER_SUFFIX,
  createStageClock,
  type StageClock,
} from './exportProfile';
import {
  avcLengthSize,
  inBandSpsUnderstates,
  raiseAvcReorderDepth,
  reorderDepth,
} from './avcReorder';
import { holdDecoder, type DecoderHold } from './decoderHold';
import { encoderKindLookup } from './encoderKind';
import { FastCutFallback, prepareFastCut, type FastCutJob } from './fastCut';
import { pickFrames } from './framePicker';
import { createHdrContext, readHdrPixels } from './hdrCanvas';
import { HDR_CLIP_WORKER_NAME, HDR_PIPELINE_DEPTH, HdrClipper, serveHdrClips } from './hdrClip';
import { probeHdrToneMapping, type HdrProbeResult } from './hdrProbe';
import { removeExportEntry, sweepExportEntries } from './opfsEntries';
import { prepareOutput, sinkRefusal, type CollectedOutput } from './outputSink';
import { AUDIO_CHUNK_FRAMES, SegmentAudioWriter, audioEndFrame, type AudioContextSources } from './segmentAudio';
import type {
  CaptionFontStatus,
  CapabilityStageResult,
  EncoderProbeConfig,
  ExportOutputKind,
  TargetSizeExport,
  WorkerRequest,
  WorkerResponse,
} from './protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;

/** Stage timings (ADR-028); only when a measurement script asked for them. */
const profiling = typeof scope.name === 'string' && scope.name.endsWith(EXPORT_PROFILE_WORKER_SUFFIX);

/**
 * How far a moment's audio may run ahead of its frames in the full encode, in
 * output seconds (ADR-028): enough to fill the encoder waits, close enough
 * that both tracks are written to the file side by side.
 */
const AUDIO_LEAD_SECONDS = 1;

/** How often the encoding progress is looked at, in output frames. */
const PROGRESS_EVERY_FRAMES = 5;

/**
 * The shortest time between two progress events (ADR-029). Every event makes
 * the editor render again; at a 1080p encode's ~245 frames per second, one
 * event per 5 frames was ~50 renders a second, ~0.77 GiB of short-lived
 * objects on the page per 20 minutes of output (sampling heap profiler), and
 * the page's JavaScript heap grew from 12 to 62 MiB over a 60-minute export.
 * Four updates a second are as smooth for a person watching a progress bar.
 */
const PROGRESS_INTERVAL_MS = 250;

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
    /** Set for `target_size_too_small`: the target and what would work instead. */
    readonly targetSize?: TargetSizeShortfall,
  ) {
    super(code);
    this.name = 'ExportFailure';
  }
}

/**
 * ADR-035: the file of a target-size attempt came out (or was certain to come
 * out) over the target and another attempt is allowed. The attempt's file is
 * discarded; `next` is what to encode instead.
 */
class TargetSizeOver extends Error {
  constructor(readonly next: TargetSizeDecision) {
    super('target_size_over');
    this.name = 'TargetSizeOver';
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

/**
 * The same check for a sound-only file (ADR-035): it must have an audio track
 * and must NOT have a video track. Width and height are reported as 0.
 */
async function probeProducedAudio(produced: Uint8Array | Blob): Promise<ExportProbe> {
  const input = new Input({
    formats: ALL_FORMATS,
    source: produced instanceof Blob ? new BlobSource(produced) : new BufferSource(produced),
  });
  const audioTrack = await input.getPrimaryAudioTrack();
  if (!audioTrack) throw new ExportFailure('output_probe_failed');
  if ((await input.getPrimaryVideoTrack()) !== null) throw new ExportFailure('output_probe_failed');
  const durationSeconds = await input.computeDuration();
  return {
    durationUs: Math.round(durationSeconds * US_PER_SECOND),
    width: 0,
    height: 0,
    videoCodec: null,
    audioCodec: await audioTrack.getCodec(),
    hasAudio: true,
  };
}

/**
 * Measurement only (ADR-028 profile): every track of the produced file,
 * packet by packet, so a duration mismatch on a device can be read from the
 * log instead of guessed. Never runs for a user.
 */
async function describeProduced(produced: Uint8Array | Blob): Promise<unknown[]> {
  const input = new Input({
    formats: ALL_FORMATS,
    source: produced instanceof Blob ? new BlobSource(produced) : new BufferSource(produced),
  });
  const tracks = [];
  for (const track of await input.getTracks()) {
    const packets = new EncodedPacketSink(track);
    const times: number[] = [];
    let endS = 0;
    let count = 0;
    for await (const packet of packets.packets(undefined, undefined, { metadataOnly: true })) {
      count += 1;
      endS = Math.max(endS, packet.timestamp + packet.duration);
      if (times.length < 400) times.push(Math.round(packet.timestamp * 1e6));
    }
    tracks.push({
      type: track.type,
      codec: await track.getCodec(),
      packets: count,
      firstS: await track.getFirstTimestamp(),
      endS,
      durationS: await track.computeDuration(),
      timesUs: track.type === 'video' ? times : times.slice(0, 8),
    });
  }
  return tracks;
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
): Promise<boolean> {
  if ((await track.getCodec()) !== 'avc') return false;
  const config = await track.getDecoderConfig();
  if (!config?.description) return false;
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
  if (!corrected) return false;

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
  return true;
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

interface ExportRequestOptions {
  requestId: string;
  plan: RenderPlan;
  videoFile: File;
  audioFile: File | null;
  origin: string;
  memoryRouteLimitUs: number;
  forceMemoryRoute: boolean;
  storageFreeBytes: number | null;
  storageReserveBytes: number | null;
  /** ADR-026: the file picked in the save dialog, or null for OPFS/memory. */
  destination: FileSystemFileHandle | null;
  mode: ExportMode;
  output: ExportOutputKind;
  targetSize: TargetSizeExport | null;
  /** ADR-035: the target-size attempt this output file belongs to; set by `runExport`. */
  target: TargetRun | null;
}

/** One target-size download (ADR-035): what was asked, and the attempt being encoded. */
interface TargetRun {
  request: TargetSizeExport;
  facts: TargetSizeFacts;
  /** The plan made before the first frame (what the page showed). */
  first: TargetSizeDecision;
  /** The attempt being encoded now. */
  decision: TargetSizeDecision;
  /** Set when the source's own pictures are copied because that file fits: its expected size. */
  copyPlannedBytes: number | null;
}

/** Everything read from the sources once, shared by the fast cut and the full encode. */
interface ExportSources {
  videoTrack: InputVideoTrack;
  hdrTransfer: HdrTransfer | null;
  captionLayouts: CaptionLayout[] | null;
  sourceAudioTrack: InputAudioTrack | null;
  sourceAudioUsable: boolean;
  musicTrack: InputAudioTrack | null;
  wantsAudio: boolean;
  /** ADR-032: frames the AAC encoder puts in front of the audio (0 when there is no audio). */
  audioDelayFrames: number;
  /** Measurement only: how clearly the calibration marker came back, and how long measuring took. */
  audioDelayCorrelation: number | null;
  audioDelayMs: number | null;
}

/** The export's AAC settings (the plan's rate, channels and bitrate). */
function aacSettings(plan: RenderPlan): AacSettings {
  return {
    sampleRate: plan.audio.sampleRate,
    numberOfChannels: plan.audio.channelCount,
    bitrate: plan.audioBitrate,
  };
}

/**
 * Errors after which the full encode is not tried: the user canceled, or the
 * reason (disk, memory, policy) would stop the full encode just the same.
 */
function endsTheExport(error: unknown): boolean {
  if (error instanceof CanceledError || error instanceof ExportFailure) return true;
  const name = error instanceof Error ? error.name : '';
  return name === 'QuotaExceededError';
}

async function runExport(options: ExportRequestOptions): Promise<void> {
  const { requestId, plan, videoFile, audioFile, origin } = options;
  const startedAt = Date.now();
  const clock = createStageClock(profiling);
  emit(requestId, { type: 'preparing', attemptId: requestId });

  // ADR-035: only the sound. No picture is opened, decoded or encoded.
  if (options.output === 'audio') {
    await runAudioExport(options, startedAt);
    return;
  }
  const targetSize = options.targetSize;
  // A forced size (measurement) is always a full encode.
  const mode: ExportMode = targetSize?.forced ? 'encode' : options.mode;

  // Before any decoding or output file exists: a missing font or a line that
  // cannot fit is known now, not after minutes of encoding. A target-size
  // download lays its captions out per attempt, at the size it encodes.
  const captionLayouts = targetSize ? null : await prepareCaptionLayouts(plan, origin);

  const videoInput = new Input({ formats: ALL_FORMATS, source: new BlobSource(videoFile) });
  const videoTrack = await videoInput.getPrimaryVideoTrack();
  if (!videoTrack) throw new ExportFailure('no_video_track');
  if (!(await videoTrack.canDecode())) throw new ExportFailure('source_undecodable');
  const hdrTransfer = await refuseUnverifiedHdr(videoTrack);
  const reorderFixed = await correctAvcReorder(videoTrack, plan.segments);

  const sourceAudioTrack = await videoInput.getPrimaryAudioTrack();
  const sourceAudioUsable =
    sourceAudioTrack !== null && plan.audio.wantsSourceAudio && (await sourceAudioTrack.canDecode());

  let musicTrack: InputAudioTrack | null = null;
  if (audioFile && plan.audio.music) {
    const musicInput = new Input({ formats: ALL_FORMATS, source: new BlobSource(audioFile) });
    musicTrack = await musicInput.getPrimaryAudioTrack();
    if (musicTrack && !(await musicTrack.canDecode())) throw new ExportFailure('audio_undecodable');
  }

  const wantsAudio = sourceAudioUsable || musicTrack !== null;

  // ADR-035: the size, bitrates and expected file size of a target-size
  // download, decided before anything is written — or refused here, with the
  // smallest size that would work.
  let target: TargetRun | null = null;
  if (targetSize) {
    // Only audio bitrates whose encoder delay can be measured here (ADR-032)
    // are planned with: a bitrate the browser accepts but cannot align would
    // end in a refusal after the plan was made.
    const audioBitrates: number[] = [];
    if (wantsAudio) {
      for (const bitrate of TARGET_AUDIO_BITRATES) {
        if ((await measureAacEncoderDelay({ ...aacSettings(plan), bitrate })).ok) audioBitrates.push(bitrate);
      }
      if (audioBitrates.length === 0) throw new ExportFailure('audio_encoder_misaligned');
    }
    const facts = targetSizeFacts(plan, {
      maxShortEdge: targetSize.maxShortEdge,
      hasAudio: wantsAudio,
      encoderKind: await encoderKindLookup(plan.aspect, plan.fpsNum, plan.fpsDen),
      ...(wantsAudio ? { audioBitrates } : {}),
    });
    let first: TargetSizeDecision;
    if (targetSize.forced) {
      const size = outputPixelSize(plan.aspect, targetSize.forced.shortEdge);
      first = {
        ok: true,
        targetBytes: targetSize.targetBytes,
        shortEdge: targetSize.forced.shortEdge,
        width: size.width,
        height: size.height,
        videoBitrate: targetSize.forced.videoBitrate,
        audioBitrate: wantsAudio ? targetSize.forced.audioBitrate : 0,
        encoderKind: facts.encoderKind(size.width, size.height),
        mode: 'reduced',
        plannedBytes: targetSize.targetBytes,
        // No correction: the measurement wants this exact encode.
        attempt: MAX_TARGET_ATTEMPTS,
      };
    } else {
      const planned = planTargetSize(targetSize, facts);
      if (!planned.ok) {
        throw new ExportFailure('target_size_too_small', undefined, undefined, {
          targetBytes: planned.targetBytes,
          minBytes: planned.minBytes,
          maxDurationUs: planned.maxDurationUs,
        });
      }
      first = planned;
    }
    target = { request: targetSize, facts, first, decision: first, copyPlannedBytes: null };
  }

  const sources: ExportSources = {
    videoTrack,
    hdrTransfer,
    captionLayouts,
    sourceAudioTrack,
    sourceAudioUsable,
    musicTrack,
    wantsAudio,
    audioDelayFrames: 0,
    audioDelayCorrelation: null,
    audioDelayMs: null,
  };
  // ADR-032: how many priming frames this browser's AAC encoder puts in
  // front of the audio, measured before any output exists. An encoder whose
  // delay cannot be measured would give sound out of sync with the picture.
  await measureAudioDelay(sources, plan);

  // Previous results from this worker are no longer offered once a new export
  // starts; stale files from closed tabs are swept too.
  for (const name of ownEntries) await removeExportEntry(name);
  ownEntries.clear();
  await sweepExportEntries().catch(() => 0);

  // ADR-027: keep the source's pictures when the plan allows it. Everything
  // that can refuse (eligibility, packet scan, seam encoder) is decided here,
  // before an output file exists.
  let fallbackReason: FastCutFallbackReason | null = null;
  let prepared: Awaited<ReturnType<typeof prepareFastCut>>;
  try {
    prepared = await prepareFastCut({
      plan,
      input: videoInput,
      track: videoTrack,
      hdr: hdrTransfer !== null,
      needsReorderFix: reorderFixed,
      mode,
      checkCanceled: () => checkCanceled(requestId),
    });
  } catch (error) {
    if (endsTheExport(error)) throw error;
    prepared = { ok: false, reason: 'error' };
  }

  if (prepared.ok) {
    const job = prepared.job;
    try {
      // ADR-035: with a target size the source's pictures are kept only when
      // that file fits — then the copy is the best quality there is. Its size
      // is known before a byte is written: the copied packets, plus the sound.
      let copyTarget: TargetRun | null = null;
      if (target) {
        const copyBytes = Math.ceil(
          job.videoBytes +
            nominalOutputBytes({
              videoBitrate: 0,
              audioBitrate: wantsAudio ? plan.audioBitrate : 0,
              durationUs: plan.expectedDurationUs,
            }) +
            containerOverheadBytes({
              durationUs: plan.expectedDurationUs,
              fps: plan.fpsNum / plan.fpsDen,
              audioSampleRate: wantsAudio ? plan.audio.sampleRate : null,
            }),
        );
        if (copyBytes > target.request.targetBytes * (1 - TARGET_SAFETY_FRACTION)) {
          throw new FastCutFallback('target_size');
        }
        copyTarget = { ...target, copyPlannedBytes: copyBytes };
      }
      if (copyTarget) sources.captionLayouts = await prepareCaptionLayouts(plan, origin);
      await produceOutput({ ...options, target: copyTarget }, sources, job, null, startedAt, clock);
      return;
    } catch (error) {
      if (endsTheExport(error)) throw error;
      // The fast cut failed its own checks (or broke): the file was discarded
      // and the full encode runs instead, saying why.
      fallbackReason = error instanceof FastCutFallback ? error.reason : 'error';
    } finally {
      job.close();
    }
  } else {
    fallbackReason = prepared.reason;
  }

  if (!target) {
    await produceOutput(options, sources, null, fallbackReason, startedAt, clock);
    return;
  }

  // ADR-035: encode at the decided size; a file that comes out over the
  // target is discarded and encoded again with what was measured, at most
  // MAX_TARGET_ATTEMPTS times in all. What the last attempt really weighs is
  // what the result says.
  for (;;) {
    const attemptPlan = planForTargetSize(plan, target.decision);
    sources.captionLayouts = await prepareCaptionLayouts(attemptPlan, origin);
    await measureAudioDelay(sources, attemptPlan);
    try {
      await produceOutput({ ...options, plan: attemptPlan, target }, sources, null, fallbackReason, startedAt, clock);
      return;
    } catch (error) {
      if (!(error instanceof TargetSizeOver)) throw error;
      target = { ...target, decision: error.next };
      emit(requestId, { type: 'preparing', attemptId: requestId });
    }
  }
}

/** ADR-032: the AAC encoder's delay for this plan's audio settings (cached per setting). */
async function measureAudioDelay(sources: ExportSources, plan: RenderPlan): Promise<void> {
  if (!sources.wantsAudio) return;
  const measuredAt = performance.now();
  const delay = await measureAacEncoderDelay(aacSettings(plan));
  sources.audioDelayMs = performance.now() - measuredAt;
  if (!delay.ok) throw new ExportFailure('audio_encoder_misaligned');
  sources.audioDelayFrames = delay.delayFrames;
  sources.audioDelayCorrelation = delay.correlation;
}

/** Hands a verified file to the page; false when there is nothing to hand over. */
function emitSucceeded(requestId: string, collected: CollectedOutput, result: ExportResult): boolean {
  if (collected.route === 'file' && collected.savedName !== null) {
    emit(requestId, {
      type: 'succeeded',
      attemptId: requestId,
      result,
      output: { kind: 'file', fileName: collected.savedName },
    });
    return true;
  }
  if (collected.file && collected.entryName) {
    ownEntries.add(collected.entryName);
    emit(requestId, {
      type: 'succeeded',
      attemptId: requestId,
      result,
      output: { kind: 'opfs', file: collected.file, entryName: collected.entryName },
    });
    return true;
  }
  if (collected.bytes) {
    emit(
      requestId,
      { type: 'succeeded', attemptId: requestId, result, output: { kind: 'memory', data: collected.bytes } },
      [collected.bytes.buffer],
    );
    return true;
  }
  return false;
}

/* ------------------------------------------------------------- audio only */

/** How much output time one step of the sound-only export writes before it reports progress. */
const AUDIO_ONLY_STEP_US = 2 * US_PER_SECOND;

/**
 * "Sesini al" (ADR-035): the selected ranges' sound as an M4A file (AAC in
 * MP4, no video track).
 *
 * The same mix as the video download — each kesit's gain, the music with its
 * envelope, headroom and limiter (`SegmentAudioWriter`) — through the same
 * aligned AAC encoder (ADR-032: priming in front of 0 behind an edit list,
 * the end cut to the exact sample). The video track is never opened: nothing
 * is decoded or drawn. Always re-encoded, never a packet copy: a copy could
 * only cut at AAC frame borders (21 ms at 48 kHz) and could not apply the
 * gain or the music.
 */
async function runAudioExport(options: ExportRequestOptions, startedAt: number): Promise<void> {
  const { requestId, plan, videoFile, audioFile, forceMemoryRoute, storageFreeBytes, storageReserveBytes, destination } =
    options;

  const videoInput = new Input({ formats: ALL_FORMATS, source: new BlobSource(videoFile) });
  const sourceAudioTrack = await videoInput.getPrimaryAudioTrack();
  const sourceAudioUsable =
    sourceAudioTrack !== null && plan.audio.wantsSourceAudio && (await sourceAudioTrack.canDecode());

  let musicTrack: InputAudioTrack | null = null;
  if (audioFile && plan.audio.music) {
    const musicInput = new Input({ formats: ALL_FORMATS, source: new BlobSource(audioFile) });
    musicTrack = await musicInput.getPrimaryAudioTrack();
    if (musicTrack && !(await musicTrack.canDecode())) throw new ExportFailure('audio_undecodable');
  }
  // A source track that exists but cannot be decoded is its own refusal.
  if (sourceAudioTrack !== null && plan.audio.wantsSourceAudio && !sourceAudioUsable && musicTrack === null) {
    throw new ExportFailure('audio_undecodable');
  }
  // Nothing to save: refused before any file exists.
  if (!sourceAudioUsable && musicTrack === null) throw new ExportFailure('no_audio_track');

  const delay = await measureAacEncoderDelay(aacSettings(plan));
  if (!delay.ok) throw new ExportFailure('audio_encoder_misaligned');

  for (const name of ownEntries) await removeExportEntry(name);
  ownEntries.clear();
  await sweepExportEntries().catch(() => 0);

  const sink = await prepareOutput(
    requestId,
    requiredFreeBytes({ videoBitrate: 0, audioBitrate: plan.audioBitrate, durationUs: plan.expectedDurationUs }),
    { forceMemory: forceMemoryRoute, storageFreeBytes, reserveBytes: storageReserveBytes, destination },
  );
  const refusal = sinkRefusal(sink, options.memoryRouteLimitUs, plan.expectedDurationUs);
  if (refusal) {
    await sink.discard();
    throw new ExportFailure(refusal.code, undefined, refusal.storage ?? undefined);
  }

  const output = new Output({ format: sink.format, target: sink.target });
  const audioPackets = new EncodedAudioPacketSource('aac');
  output.addAudioTrack(audioPackets);
  const endFrame = audioEndFrame(plan);
  const encoder = new AlignedAacEncoder(audioPackets, aacSettings(plan), delay.delayFrames, endFrame, true);
  const audioSources: AudioContextSources = {
    clipReader:
      sourceAudioUsable && sourceAudioTrack ? new AudioStreamReader(new AudioSampleSink(sourceAudioTrack)) : null,
    musicReader: musicTrack ? new AudioStreamReader(new AudioSampleSink(musicTrack)) : null,
  };

  // Progress is the share of the sound written, on the plan's frame grid so
  // the page shows it like any other download.
  const totalFrames = plan.totalFrames;
  let lastProgressAt = Number.NEGATIVE_INFINITY;
  const emitProgress = (outputUs: number, last: boolean) => {
    const now = performance.now();
    if (!last && now - lastProgressAt < PROGRESS_INTERVAL_MS) return;
    lastProgressAt = now;
    const share = Math.min(1, Math.max(0, outputUs / Math.max(1, plan.expectedDurationUs)));
    emit(requestId, {
      type: 'encoding',
      attemptId: requestId,
      progress: share,
      framesDone: Math.min(totalFrames, Math.round(share * totalFrames)),
      totalFrames,
    });
  };

  let succeeded = false;
  try {
    await output.start();
    if (audioSources.musicReader && plan.audio.music) {
      await audioSources.musicReader.open(
        plan.audio.music.sourceInUs / US_PER_SECOND,
        plan.audio.music.sourceOutUs / US_PER_SECOND,
      );
    }
    emitProgress(0, false);

    for (const segment of plan.segments) {
      checkCanceled(requestId);
      const writer = new SegmentAudioWriter(plan, segment, audioSources, encoder, () => checkCanceled(requestId));
      const startUs = frameToUs(segment.startFrame, plan.fpsNum, plan.fpsDen);
      for (let untilUs = startUs + AUDIO_ONLY_STEP_US; !writer.done; untilUs += AUDIO_ONLY_STEP_US) {
        await writer.advanceTo(untilUs);
        emitProgress(untilUs, false);
      }
    }
    emitProgress(plan.expectedDurationUs, true);

    checkCanceled(requestId);
    emit(requestId, { type: 'finalizing', attemptId: requestId });
    try {
      await encoder.finish();
    } catch (error) {
      throw error instanceof AacAlignmentError ? new ExportFailure('audio_encoder_misaligned') : error;
    }
    audioPackets.close();
    await output.finalize();

    const collected = await sink.collect(output.target);
    const produced = collected.file ?? collected.bytes;
    if (!produced || collected.sizeBytes === 0) throw new ExportFailure('output_probe_failed');

    emit(requestId, { type: 'verifying', attemptId: requestId });
    const probe = await probeProducedAudio(produced);
    if (probe.audioCodec !== 'aac') throw new ExportFailure('output_probe_failed');
    if (!audioDurationWithinTolerance(plan.expectedDurationUs, probe.durationUs, plan.audio.sampleRate)) {
      throw new ExportFailure('output_duration_mismatch');
    }

    const result: ExportResult = {
      attemptId: requestId,
      fingerprint: plan.fingerprint,
      sizeBytes: collected.sizeBytes,
      route: collected.route,
      probe,
      durationDeltaUs: probe.durationUs - plan.expectedDurationUs,
      elapsedMs: Date.now() - startedAt,
      framesMissing: 0,
      method: 'encode',
      fallbackReason: null,
      framesCopied: 0,
      framesEncoded: 0,
      output: 'audio',
    };
    if (!emitSucceeded(requestId, collected, result)) throw new ExportFailure('output_probe_failed');
    succeeded = true;
  } finally {
    if (profiling) {
      console.info(
        `${EXPORT_PROFILE_LOG_PREFIX} ${JSON.stringify({
          succeeded,
          method: 'audio',
          audio: true,
          route: sink.route,
          audioDelayFrames: delay.delayFrames,
          audioAlignment: encoder.stats,
          expectedDurationUs: plan.expectedDurationUs,
          audioEndFrame: endFrame,
        })}`,
      );
    }
    encoder.close();
    await audioSources.clipReader?.close();
    await audioSources.musicReader?.close();
    if (output.state !== 'finalized') {
      await output.cancel().catch(() => undefined);
    }
    if (!succeeded) await sink.discard();
  }
}

/**
 * Writes one output file: the fast cut when `fastJob` is given, the full
 * decode -> draw -> encode otherwise. Both write the same audio, through the
 * same sink, and are verified the same way before `succeeded`.
 */
async function produceOutput(
  options: ExportRequestOptions,
  sources: ExportSources,
  fastJob: FastCutJob | null,
  fallbackReason: FastCutFallbackReason | null,
  startedAt: number,
  clock: StageClock,
): Promise<void> {
  const { requestId, plan, memoryRouteLimitUs, forceMemoryRoute, storageFreeBytes, storageReserveBytes, destination } =
    options;
  const { target } = options;
  const { videoTrack, hdrTransfer, captionLayouts, sourceAudioTrack, sourceAudioUsable, musicTrack, wantsAudio } =
    sources;
  const durationSeconds = plan.expectedDurationUs / US_PER_SECOND;

  // The fast cut's video is the source's own bytes; the full encode's is the
  // encoder's bitrate (ADR-024). A target-size attempt's bitrate is the
  // planner's, as it is: the size decides, no factor is put on top (ADR-035).
  const videoBitrate = fastJob
    ? Math.ceil((fastJob.videoBytes * 8) / Math.max(durationSeconds, 0.001))
    : target
      ? plan.videoBitrate
      : await exportVideoBitrate(plan);

  // ADR-035: the encoded video bytes, counted as the encoder hands them over.
  let videoBytes = fastJob ? fastJob.videoBytes : 0;
  /** Everything in the file that is not video, as the planner counts it. */
  const otherBytesEstimate = target
    ? Math.ceil(
        nominalOutputBytes({
          videoBitrate: 0,
          audioBitrate: wantsAudio ? plan.audioBitrate : 0,
          durationUs: plan.expectedDurationUs,
        }) +
          containerOverheadBytes({
            durationUs: plan.expectedDurationUs,
            fps: plan.fpsNum / plan.fpsDen,
            audioSampleRate: wantsAudio ? plan.audio.sampleRate : null,
          }),
      )
    : 0;
  /** The next attempt for a file of this size, or null when this one is the answer. */
  const correction = (measured: TargetSizeMeasurement): TargetSizeDecision | null =>
    target && !fastJob ? correctTargetSize(target.request, target.facts, target.decision, measured) : null;

  // Measured, not guessed (ADR-023): the file is written once, and its size
  // stays under this estimate.
  const sink = await prepareOutput(
    requestId,
    requiredFreeBytes({
      videoBitrate,
      audioBitrate: plan.audioBitrate,
      durationUs: plan.expectedDurationUs,
    }),
    { forceMemory: forceMemoryRoute, storageFreeBytes, reserveBytes: storageReserveBytes, destination },
  );

  // Doc 15 v3: 60 minutes only on a disk route; ADR-026: the picked file
  // must open and have room. Refused here, before the first frame, not after
  // minutes of encoding.
  const refusal = sinkRefusal(sink, memoryRouteLimitUs, plan.expectedDurationUs);
  if (refusal) {
    await sink.discard();
    throw new ExportFailure(refusal.code, undefined, refusal.storage ?? undefined);
  }

  const output = new Output({ format: sink.format, target: sink.target });

  let videoSource: VideoSampleSource | null = null;
  let canvas: OffscreenCanvas | null = null;
  let context: OffscreenCanvasRenderingContext2D | null = null;
  let hdrContext: ReturnType<typeof createHdrContext> = null;
  if (fastJob) {
    fastJob.addTrack(output);
  } else {
    canvas = new OffscreenCanvas(plan.width, plan.height);
    context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new ExportFailure('internal_error');
    // HDR frames are drawn into a float16 canvas and soft clipped (ADR-022),
    // the same path the runtime check verified; SDR frames draw directly.
    hdrContext = hdrTransfer ? createHdrContext(plan.width, plan.height) : null;
    if (hdrTransfer && !hdrContext) throw new ExportFailure('hdr_source_unsupported');
    // The canvas is snapshotted into a sample here rather than by mediabunny's
    // CanvasSource: the same `new VideoSample(canvas)` it makes, but the
    // snapshot and the encoder hand-off can be timed apart (ADR-028).
    // ADR-035: a target-size encode asks for a constant bitrate. Measured on
    // the hardware encoder, the file then stays within 0.99–1.06 of what was
    // asked (variable: 1.07–1.30) at the same picture quality per byte. The
    // ordinary download is untouched (mediabunny's default, variable).
    const bitrateMode = !target ? undefined : target.request.forced ? target.request.forced.bitrateMode : 'constant';
    videoSource = new VideoSampleSource({
      codec: 'avc',
      bitrate: videoBitrate,
      keyFrameInterval: 2,
      ...(bitrateMode ? { bitrateMode } : {}),
      ...(target
        ? {
            onEncodedPacket: (packet: { data: Uint8Array }) => {
              videoBytes += packet.data.byteLength;
            },
          }
        : {}),
    });
    output.addVideoTrack(videoSource, { frameRate: plan.fpsNum / plan.fpsDen });
  }

  // ADR-032: the AAC encoder runs here rather than inside mediabunny, so its
  // priming can be moved in front of 0 (the muxer writes the edit list that
  // players skip) and the flush padding dropped again.
  let audioPackets: EncodedAudioPacketSource | null = null;
  let audioSource: AlignedAacEncoder | null = null;
  if (wantsAudio) {
    audioPackets = new EncodedAudioPacketSource('aac');
    output.addAudioTrack(audioPackets);
    audioSource = new AlignedAacEncoder(audioPackets, aacSettings(plan), sources.audioDelayFrames, audioEndFrame(plan));
  }

  const audioSources: AudioContextSources = {
    clipReader:
      sourceAudioUsable && sourceAudioTrack ? new AudioStreamReader(new AudioSampleSink(sourceAudioTrack)) : null,
    musicReader: musicTrack ? new AudioStreamReader(new AudioSampleSink(musicTrack)) : null,
  };

  const audioLane = clock.lane();
  // HDR: the soft clip runs on a helper thread when one starts (ADR-028).
  const hdrClipper = hdrContext ? new HdrClipper(plan.width * plan.height * 4) : null;
  const hdrQueue: { frame: number; picture: Promise<Uint8ClampedArray> }[] = [];
  const totalFrames = fastJob ? fastJob.totalFrames : plan.totalFrames;
  const frameDuration = plan.fpsDen / plan.fpsNum;
  let framesDone = 0;
  let framesDrawn = 0;
  let framesMissing = 0;
  let succeeded = false;
  /** ADR-035: this attempt's file is thrown away and another attempt follows. */
  let retrying = false;
  // Measurement only (ADR-028 profile): what the decoder delivered and what
  // the produced file holds.
  const decodedTimesUs: number[][] = [];
  // Measurement only (ADR-033): per moment, the frames drawn after the decode
  // pass ended — the ones a closed decoder would have left stale on Android.
  const drawnAfterDecodePass: number[] = [];
  let producedForProfile: Uint8Array | Blob | null = null;
  let probedDurationUs: number | null = null;

  // The first and the last report always go out; in between at most one per
  // PROGRESS_INTERVAL_MS (ADR-029).
  let lastProgressAt = Number.NEGATIVE_INFINITY;
  const emitProgress = () => {
    const now = performance.now();
    if (framesDone < totalFrames && now - lastProgressAt < PROGRESS_INTERVAL_MS) return;
    lastProgressAt = now;
    emit(requestId, {
      type: 'encoding',
      attemptId: requestId,
      progress: totalFrames > 0 ? Math.min(1, framesDone / totalFrames) : null,
      framesDone,
      totalFrames,
      ...(target && !fastJob && target.decision.attempt > 1 && !target.request.forced
        ? { pass: target.decision.attempt }
        : {}),
    });
  };

  /**
   * Captions, snapshot and encoder hand-off of the picture now on `canvas`,
   * as output frame `frameIndex`, then the bookkeeping of a finished frame.
   */
  const encodeCanvasFrame = async (frameIndex: number, pacer: MediaPacer): Promise<void> => {
    if (!videoSource || !context || !canvas) throw new ExportFailure('internal_error');
    // Burned in on top of the picture, before the frame is handed to the
    // encoder. Drawn even on a held/background frame: the caption belongs
    // to output time, not to the source frame.
    if (captionLayouts && plan.captions) {
      const cueIndex = cueIndexAtFrame(plan.captions.cues, frameIndex);
      const layout = cueIndex >= 0 ? captionLayouts[cueIndex] : undefined;
      if (layout) drawCaptionLayout(context, layout, plan.captions.style.preset);
      clock.lap('captions');
    }

    const picture = new VideoSample(canvas, { timestamp: frameIndex * frameDuration, duration: frameDuration });
    clock.lap('frameCapture');
    try {
      await videoSource.add(picture);
    } finally {
      picture.close();
    }
    clock.lap('encode');
    framesDone += 1;
    pacer.advance((frameIndex + 1) * frameDuration);

    if (framesDone % PROGRESS_EVERY_FRAMES === 0 || framesDone === plan.totalFrames) {
      emitProgress();
      clock.lap('progress');
      // ADR-035: once the video already written is more than the whole file
      // may be, finishing this attempt cannot fit. It stops here and the next
      // attempt starts from the ratio seen so far.
      if (target && videoBytes + otherBytesEstimate > target.decision.targetBytes) {
        const projected = Math.ceil((videoBytes * plan.totalFrames) / Math.max(1, framesDone));
        const next = correction({ videoBytes: projected, fileBytes: projected + otherBytesEstimate });
        if (next) {
          retrying = true;
          throw new TargetSizeOver(next);
        }
      }
    }
  };

  /** The oldest HDR frame in flight: its clipped picture onto `canvas`, then encoded. */
  const finishHdrFrame = async (pacer: MediaPacer): Promise<void> => {
    const next = hdrQueue.shift();
    if (!next || !hdrClipper || !context) return;
    clock.mark();
    let rgba: Uint8ClampedArray;
    try {
      rgba = await next.picture;
    } catch {
      throw new ExportFailure('internal_error');
    }
    clock.lap('hdrClip');
    context.putImageData(new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, plan.width, plan.height), 0, 0);
    hdrClipper.recycle(rgba);
    clock.lap('hdrWrite');
    await encodeCanvasFrame(next.frame, pacer);
  };

  try {
    await output.start();
    if (hdrClipper) await hdrClipper.ready();
    clock.lap('setup');

    if (audioSources.musicReader && plan.audio.music) {
      await audioSources.musicReader.open(
        plan.audio.music.sourceInUs / US_PER_SECOND,
        plan.audio.music.sourceOutUs / US_PER_SECOND,
      );
    }

    emitProgress();

    for (const [segmentIndex, segment] of plan.segments.entries()) {
      checkCanceled(requestId);
      const audioWriter = audioSource
        ? new SegmentAudioWriter(plan, segment, audioSources, audioSource, () => checkCanceled(requestId), audioLane)
        : null;

      if (fastJob) {
        // Audio follows the copied video closely, so the file is interleaved
        // and the progress is the real share of the file written.
        await fastJob.writeSegment(segmentIndex, async (outputUs, done) => {
          await audioWriter?.advanceTo(outputUs);
          framesDone = done;
          emitProgress();
        });
        await audioWriter?.advanceTo();
        continue;
      }

      const timestamps: number[] = [];
      for (let frame = segment.startFrame; frame < segment.endFrame; frame += 1) {
        timestamps.push(sourceTimeForFrame(segment, frame, plan.fpsNum, plan.fpsDen));
      }
      if (timestamps.length === 0) continue;
      if (!videoSource || !context || !canvas) throw new ExportFailure('internal_error');
      const frameContext = hdrContext ?? context;

      // Full encode only (ADR-028): the moment's audio is mixed and encoded
      // alongside its frames, in the time the worker would otherwise only wait
      // for the video encoder. It is paced to the frames (at most
      // AUDIO_LEAD_SECONDS ahead), written in the same 4096-frame chunks as
      // before, and finished before the next moment starts. A failure (or
      // cancel) on either side stops the other. The fast cut above interleaves
      // its audio with the copied video itself.
      const pacer = new MediaPacer(AUDIO_LEAD_SECONDS);
      let audioFailure: { error: unknown } | null = null;
      const audioTask = audioWriter
        ? paceSegmentAudio(audioWriter, pacer, plan, segment).catch((error: unknown) => {
            audioFailure = { error };
          })
        : null;

      // ADR-033: the decoder stays open until this moment's last frame is
      // drawn. Android's hardware decoder takes the pictures of undrawn frames
      // with it when it closes; a decoder that closes anyway marks the frames
      // after it as missing instead of drawing them as real ones.
      const videoSink = new VideoSampleSink(videoTrack);
      let hold: DecoderHold;
      try {
        hold = holdDecoder(videoSink);
      } catch {
        throw new ExportFailure('internal_error');
      }
      let drawnAfterPass = 0;
      try {
        // One continuous decode per moment (see framePicker): a flush at every
        // GOP boundary made Chromium drop whole GOPs of real camera footage.
        const firstTs = timestamps[0] ?? 0;
        const lastTs = timestamps[timestamps.length - 1] ?? firstTs;
        const samples = videoSink.samples(firstTs, lastTs + 0.001);
        const seen: number[] = [];
        if (clock.enabled) decodedTimesUs.push(seen);
        const decoded = clock.enabled ? recordTimes(samples, seen) : samples;
        const usable = () => !hold.decoderClosed();
        let frame = segment.startFrame;
        clock.mark();
        for await (const { frame: sample, missing } of pickFrames(decoded, timestamps, frameDuration, usable)) {
          if (hold.closeRequested) drawnAfterPass += 1;
          clock.lap('decodeWait');
          checkCanceled(requestId);
          if (audioFailure) throw (audioFailure as { error: unknown }).error;

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
          clock.lap('draw');

          if (hdrContext && hdrClipper) {
            // HDR (ADR-022): read the float picture back now; its soft clip
            // runs on the helper while the next frame is drawn (ADR-028).
            const pixels = readHdrPixels(hdrContext, plan.width, plan.height);
            if (!pixels) throw new ExportFailure('hdr_source_unsupported');
            clock.lap('hdrRead');
            const picture = hdrClipper.clip(pixels);
            // Awaited below in order; a failure is raised there, not here.
            picture.catch(() => undefined);
            hdrQueue.push({ frame, picture });
            frame += 1;
            if (hdrQueue.length >= HDR_PIPELINE_DEPTH) await finishHdrFrame(pacer);
          } else {
            await encodeCanvasFrame(frame, pacer);
            frame += 1;
          }
          clock.mark();
        }
        while (hdrQueue.length > 0) await finishHdrFrame(pacer);
        pacer.finish();
        await audioTask;
        if (audioFailure) throw (audioFailure as { error: unknown }).error;
      } finally {
        // Every frame of the moment is drawn (or the export is stopping).
        hold.release();
        if (clock.enabled) drawnAfterDecodePass.push(drawnAfterPass);
        // On any early exit the audio stops at its next chunk and is awaited,
        // so nothing still writes into the output while it is torn down.
        pacer.stop();
        await audioTask;
      }
    }

    if (!fastJob) {
      if (framesDrawn === 0) throw new ExportFailure('no_frames_decoded');
      if (framesMissing > missingFramesAllowed(plan.totalFrames)) {
        throw new ExportFailure('source_frames_missing');
      }
    }

    checkCanceled(requestId);
    emit(requestId, { type: 'finalizing', attemptId: requestId });

    clock.mark();
    if (fastJob) fastJob.finishVideo();
    else videoSource?.close();
    if (audioSource) {
      try {
        await audioSource.finish();
      } catch (error) {
        // Audio that stops short of the end is refused, on either path.
        throw error instanceof AacAlignmentError ? new ExportFailure('audio_encoder_misaligned') : error;
      }
    }
    audioPackets?.close();
    await output.finalize();

    // ADR-035: the finished file's size, read before it becomes the saved
    // file. Over the target: the source's pictures do not fit after all (the
    // full encode runs), or the encode is tried again with what was measured.
    if (target) {
      const fileBytes = sink.writtenBytes(output.target);
      if (fileBytes > target.decision.targetBytes) {
        if (fastJob) {
          retrying = true;
          throw new FastCutFallback('target_size');
        }
        const next = correction({ fileBytes, videoBytes });
        if (next) {
          retrying = true;
          throw new TargetSizeOver(next);
        }
      }
    }

    const collected = await sink.collect(output.target);
    const produced = collected.file ?? collected.bytes;
    if (!produced || collected.sizeBytes === 0) throw new ExportFailure('output_probe_failed');
    if (clock.enabled) producedForProfile = produced;
    clock.lap('finalize');

    emit(requestId, { type: 'verifying', attemptId: requestId });
    // The fast cut's seams are decoded again in this browser before the file
    // may be offered (ADR-027); a failure here falls back to the full encode.
    if (fastJob) await fastJob.verify(produced);
    const probe = await probeProduced(produced);
    probedDurationUs = probe.durationUs;
    clock.lap('probe');

    if (!durationWithinTolerance(plan.expectedDurationUs, probe.durationUs, plan.fpsNum, plan.fpsDen)) {
      throw fastJob ? new FastCutFallback('seam_check') : new ExportFailure('output_duration_mismatch');
    }

    const result: ExportResult = {
      attemptId: requestId,
      fingerprint: plan.fingerprint,
      sizeBytes: collected.sizeBytes,
      route: collected.route,
      probe,
      durationDeltaUs: probe.durationUs - plan.expectedDurationUs,
      elapsedMs: Date.now() - startedAt,
      framesMissing,
      method: fastJob ? fastJob.method : 'encode',
      fallbackReason: fastJob ? null : fallbackReason,
      framesCopied: fastJob ? fastJob.framesCopied : 0,
      framesEncoded: fastJob ? fastJob.framesEncoded : framesDone,
      ...(target
        ? {
            targetSize: {
              targetBytes: target.decision.targetBytes,
              plannedBytes: fastJob ? (target.copyPlannedBytes ?? collected.sizeBytes) : target.decision.plannedBytes,
              firstPlannedBytes: target.first.plannedBytes,
              actualBytes: collected.sizeBytes,
              // From the file itself: never "fits" for a file over the target.
              fits: collected.sizeBytes <= target.decision.targetBytes,
              attempts: fastJob ? 0 : target.decision.attempt,
              shortEdge: Math.min(probe.width, probe.height),
              videoBitrate,
              audioBitrate: wantsAudio ? plan.audioBitrate : 0,
              encoderKind: target.decision.encoderKind,
              mode: fastJob ? ('copy' as const) : target.decision.mode,
            },
          }
        : {}),
    };

    if (!emitSucceeded(requestId, collected, result)) throw new ExportFailure('output_probe_failed');
    succeeded = true;
  } finally {
    if (clock.enabled) {
      // Measurement only (ADR-028): read by the scripts from the console.
      const producedTracks = producedForProfile
        ? await describeProduced(producedForProfile).catch((error: unknown) => String(error))
        : null;
      console.info(
        `${EXPORT_PROFILE_LOG_PREFIX} ${JSON.stringify({
          succeeded,
          method: fastJob ? fastJob.method : 'encode',
          width: plan.width,
          height: plan.height,
          totalFrames,
          segments: plan.segments.length,
          hdr: hdrTransfer !== null,
          hdrClipThreaded: hdrClipper?.threaded ?? null,
          captions: captionLayouts !== null,
          audio: wantsAudio,
          route: sink.route,
          videoBitrate,
          videoBytes,
          targetSize: target ? { ...target.decision, retrying } : null,
          framesMissing,
          audioDelayFrames: sources.audioDelayFrames,
          audioDelayCorrelation: sources.audioDelayCorrelation,
          audioDelayMs: sources.audioDelayMs === null ? null : Math.round(sources.audioDelayMs),
          audioAlignment: audioSource?.stats ?? null,
          expectedDurationUs: plan.expectedDurationUs,
          probedDurationUs,
          decodedTimesUs: decodedTimesUs.map((times) => times.slice(0, 400)),
          drawnAfterDecodePass,
          producedTracks,
          ...clock.summary(framesDone),
        })}`,
      );
    }
    hdrClipper?.close();
    audioSource?.close();
    hdrQueue.length = 0;
    await audioSources.clipReader?.close();
    await audioSources.musicReader?.close();
    // `finalize()` already tore the output down on the success path; cancel()
    // is the cleanup path for every other exit.
    if (output.state !== 'finalized') {
      await output.cancel().catch(() => undefined);
    }
    // A partial or unverified file must never be left behind as if it were a
    // result: only a verified success keeps its file.
    // ADR-035: when another attempt follows, the picked file itself stays.
    if (!succeeded) await sink.discard(retrying);
  }
}

/**
 * Writes a moment's audio behind the pacer (ADR-028): each step is one
 * 4096-frame chunk, counted from the moment's first audio frame exactly as
 * `SegmentAudioWriter` counts it, so the chunks (and the mix) are the same
 * as when the whole moment was written in one call.
 */
async function paceSegmentAudio(
  writer: SegmentAudioWriter,
  pacer: MediaPacer,
  plan: RenderPlan,
  segment: RenderSegment,
): Promise<void> {
  const rate = plan.audio.sampleRate;
  const firstFrame = Math.round((frameToUs(segment.startFrame, plan.fpsNum, plan.fpsDen) * rate) / US_PER_SECOND);
  for (let chunk = firstFrame; !writer.done; chunk += AUDIO_CHUNK_FRAMES) {
    // Not further ahead of the frames than the lead; the wait is time spent
    // on video, not audio work, so it is outside the marks.
    const turn = pacer.until(chunk / rate);
    if (turn) await turn;
    if (pacer.isStopped) return;
    await writer.advanceTo(((chunk + AUDIO_CHUNK_FRAMES) * US_PER_SECOND) / rate);
  }
}

/** Measurement only: passes the decoded frames through, noting each timestamp. */
async function* recordTimes<T extends { timestamp: number }>(
  frames: AsyncIterable<T>,
  into: number[],
): AsyncGenerator<T> {
  for await (const frame of frames) {
    into.push(Math.round(frame.timestamp * 1e6));
    yield frame;
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

if (scope.name === HDR_CLIP_WORKER_NAME) {
  // This instance is the HDR clip helper of another export (hdrClip.ts).
  serveHdrClips(scope);
} else {
  scope.onmessage = onRequest;
}

async function onRequest(message: MessageEvent<WorkerRequest>): Promise<void> {
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
      await runExport({
        requestId: request.requestId,
        plan: request.plan,
        videoFile: request.videoFile,
        audioFile: request.audioFile,
        origin: request.origin,
        memoryRouteLimitUs: request.memoryRouteLimitUs,
        forceMemoryRoute: request.forceMemoryRoute,
        storageFreeBytes: request.storageFreeBytes,
        storageReserveBytes: request.storageReserveBytes,
        destination: request.destination,
        mode: request.mode ?? 'auto',
        output: request.output ?? 'video',
        targetSize: request.output === 'audio' ? null : (request.targetSize ?? null),
        target: null,
      });
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
          ...(error.targetSize !== undefined ? { targetSize: error.targetSize } : {}),
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
}
