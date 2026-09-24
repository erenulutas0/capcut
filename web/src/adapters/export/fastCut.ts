/// <reference lib="webworker" />

/**
 * Fast cut (ADR-027): the download keeps the source's own compressed
 * pictures and re-encodes only the frames between each cut and the next IDR
 * ("smart cut"). Frame accurate: every range starts and ends on exactly the
 * frames the full encode would show.
 *
 * - Packets are read with `EncodedPacketSink` and written unchanged through
 *   `EncodedVideoPacketSource`, timestamps rebased onto the output timeline.
 * - Seam frames are decoded from the source and fed to WebCodecs'
 *   `VideoEncoder` as decoded frames (no canvas, no colour conversion), at
 *   the source's own coded size. Every run of seam frames starts with an IDR
 *   and carries the encoder's SPS/PPS in-band; the first copied IDR after it
 *   carries the source's SPS/PPS again. Both switches happen at IDRs, where
 *   H.264 allows a new parameter set to take effect.
 * - Audio is not copied: the caller re-encodes it exactly like the full
 *   encode (gain, music, fades, exact cut), interleaved via `onProgress`.
 * - Before success the file is re-opened and every seam is decoded again in
 *   this browser (`verify`); a seam that does not decode, or a copied frame
 *   that does not decode to the same pixels as in the source, fails the fast
 *   cut and the caller runs the full encode instead.
 */

import {
  BlobSource,
  BufferSource,
  EncodedPacket,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Input,
  IsobmffInputFormat,
  VideoSampleSink,
  ALL_FORMATS,
  type InputVideoTrack,
  type Output,
} from 'mediabunny';

import {
  copyStartCandidates,
  fastCutEligibility,
  frameRateRefusal,
  planSegmentCut,
  type ExportMode,
  type FastCutFallbackReason,
  type FastCutSourceFacts,
  type SegmentCutPlan,
} from '@/domain/fastPath';
import { sourceTimeForFrame, type RenderPlan, type RenderSegment } from '@/domain/renderPlan';
import { US_PER_SECOND } from '@/domain/time';
import { isIdrPacket, parseAvcC, readSps, withParameterSets, type AvcConfigRecord } from './avcBitstream';

/** A fast cut that cannot (or may not) run; the caller encodes instead. */
export class FastCutFallback extends Error {
  constructor(readonly reason: FastCutFallbackReason) {
    super(`fast_cut_fallback:${reason}`);
    this.name = 'FastCutFallback';
  }
}

/** Same slack the frame picker uses: container times are rational seconds. */
const EPSILON_S = 0.001;
/** A first frame this far after the cut is the container's start offset (framePicker). */
const LEADING_OFFSET_S = 0.1;
/** Seam frames: constant quantizer where the encoder offers it (visually transparent). */
const SEAM_QUANTIZER = 18;
/** How often the copy reports progress, in packets. */
const PROGRESS_EVERY_PACKETS = 30;
/** Encoder queue depth before the seam encoder waits. */
const MAX_ENCODE_QUEUE = 8;

/** Spike-only knobs (ADR-027 measurements); the app never sets them. */
export interface FastCutVariant {
  /** `avc3` sample entry instead of `avc1`. */
  sampleEntry?: 'avc1' | 'avc3';
  /** Skip the "at most 30 fps" rule, to measure the technique on 50/60 fps sources. */
  anyFrameRate?: boolean;
}

interface ScannedSegment {
  segment: RenderSegment;
  cut: SegmentCutPlan;
  /** Window packets, decode order, metadata only. */
  packets: EncodedPacket[];
  /** Output ticks of every frame of `cut.frames`, same order. */
  outTicks: number[];
  /** Output end of the moment, ticks. */
  endTicks: number;
  /** Source tick -> index into `cut.frames`. */
  index: Map<number, number>;
}

interface Seam {
  /** Output ticks of every frame expected in the decoded window, ascending. */
  expected: number[];
  /** Window to decode, output seconds [start, end). */
  startS: number;
  endS: number;
  /** A copied frame right after re-encoded ones: its pixels must equal the source's. */
  digest: { sourceS: number; outputS: number } | null;
}

/** What happened to one moment, for results and measurements. */
export interface FastCutSegmentSummary {
  /** Source presentation time of the first and last frame, seconds. */
  firstSourceS: number;
  lastSourceS: number;
  frames: number;
  head: number;
  copied: number;
  tail: number;
  /** Source and output presentation time of every frame, seconds, ascending. */
  sourceTimesS: number[];
  outputTimesS: number[];
}

export interface FastCutJob {
  method: 'copy' | 'smart';
  segments: FastCutSegmentSummary[];
  totalFrames: number;
  framesCopied: number;
  framesEncoded: number;
  /** Upper estimate of the video bytes, for the storage check. */
  videoBytes: number;
  addTrack(output: Output): void;
  /** Writes one moment; `onProgress` gets the output time complete so far (µs) and frames written. */
  writeSegment(index: number, onProgress: (outputUs: number, framesDone: number) => Promise<void>): Promise<void>;
  finishVideo(): void;
  verify(produced: Blob | Uint8Array): Promise<void>;
  close(): void;
}

/* ------------------------------------------------------------ source facts */

function bytesOf(source: AllowSharedBufferSource): Uint8Array {
  return ArrayBuffer.isView(source)
    ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
    : new Uint8Array(source);
}

const SDR_PRIMARIES = new Set(['bt709', 'bt470bg', 'smpte170m']);

async function sourceFacts(
  input: Input,
  track: InputVideoTrack,
  hdr: boolean,
  needsReorderFix: boolean,
): Promise<{ facts: FastCutSourceFacts; avc: AvcConfigRecord | null; config: VideoDecoderConfig | null }> {
  const codec = await track.getCodec();
  const format = await input.getFormat();
  const config = codec === 'avc' ? await track.getDecoderConfig() : null;
  const avc = config?.description ? parseAvcC(bytesOf(config.description)) : null;
  const firstSps = avc?.sps[0];
  const sps = firstSps ? readSps(firstSps) : null;
  const colorSpace = await track.getColorSpace().catch(() => null);
  const pixelAspect = await track.getPixelAspectRatio();
  return {
    facts: {
      codec,
      isobmff: format instanceof IsobmffInputFormat,
      hdr,
      sps,
      lengthSize: avc?.lengthSize ?? null,
      displayWidth: await track.getDisplayWidth(),
      displayHeight: await track.getDisplayHeight(),
      squarePixels: pixelAspect.num === pixelAspect.den,
      fullRange: colorSpace?.fullRange === true,
      wideGamut: Boolean(colorSpace?.primaries && !SDR_PRIMARIES.has(colorSpace.primaries)),
      needsReorderFix,
    },
    avc,
    config,
  };
}

/* ---------------------------------------------------------------- scanning */

/**
 * The packet with its bytes for a metadata-only one from the scan (mediabunny
 * starts a data iteration only from a packet that has its data). Looked up
 * by presentation time, which is unique per picture, and checked by position.
 */
async function withData(sink: EncodedPacketSink, meta: EncodedPacket | undefined): Promise<EncodedPacket> {
  if (!meta) throw new FastCutFallback('timing');
  const packet = await sink.getPacket(meta.timestamp);
  if (!packet || packet.sequenceNumber !== meta.sequenceNumber) throw new FastCutFallback('timing');
  return packet;
}

async function scanSegment(
  sink: EncodedPacketSink,
  plan: RenderPlan,
  segment: RenderSegment,
  srcRes: number,
  outRes: number,
  anyFrameRate: boolean,
): Promise<ScannedSegment> {
  const { fpsNum, fpsDen } = plan;
  const firstTarget = sourceTimeForFrame(segment, segment.startFrame, fpsNum, fpsDen);
  const lastTarget = sourceTimeForFrame(segment, segment.endFrame - 1, fpsNum, fpsDen);
  const metadataOnly = { metadataOnly: true } as const;

  // Two IDRs back: pictures shown before their IDR (leading B-frames) belong
  // to the IDR decoded after them.
  let startKey =
    (await sink.getKeyPacket(firstTarget, metadataOnly)) ?? (await sink.getFirstPacket(metadataOnly));
  if (!startKey) throw new FastCutFallback('timing');
  const earlier = await sink.getKeyPacket(startKey.timestamp - 1 / srcRes, metadataOnly);
  if (earlier && earlier.sequenceNumber < startKey.sequenceNumber) startKey = earlier;

  const packets: EncodedPacket[] = [];
  const pts: number[] = [];
  const key: boolean[] = [];
  const lastTick = lastTarget * srcRes;
  let keysBeyond = 0;
  for await (const packet of sink.packets(startKey, undefined, metadataOnly)) {
    const tick = Math.round(packet.timestamp * srcRes);
    if (packet.type === 'key' && tick > lastTick + EPSILON_S * srcRes) {
      keysBeyond += 1;
      if (keysBeyond === 2) break;
    }
    packets.push(packet);
    pts.push(tick);
    key.push(packet.type === 'key');
  }

  // The frames the full encode shows: the last frame at or before each
  // target (framePicker's rule), first and last target here.
  const sorted = [...pts].sort((a, b) => a - b);
  const atOrBefore = (seconds: number): number | null => {
    const limit = (seconds + EPSILON_S) * srcRes;
    let found: number | null = null;
    for (const t of sorted) {
      if (t <= limit) found = t;
      else break;
    }
    return found;
  };
  let first = atOrBefore(firstTarget);
  if (first === null) {
    const earliest = sorted[0];
    if (earliest === undefined || earliest / srcRes - firstTarget > LEADING_OFFSET_S) {
      throw new FastCutFallback('timing');
    }
    first = earliest;
  }
  const last = atOrBefore(lastTarget);
  if (last === null || last < first) throw new FastCutFallback('timing');

  // The earliest clean key packet that is a real IDR starts the copy.
  let start: number | null = null;
  for (const candidate of copyStartCandidates(pts, key, first, last)) {
    const packet = await withData(sink, packets[candidate]);
    if (isIdrPacket(packet.data, 4)) {
      start = candidate;
      break;
    }
  }
  const planned = planSegmentCut(pts, start, first, last);
  if (!planned.ok) throw new FastCutFallback(planned.reason);
  const cut = planned.cut;
  const rateRefusal = anyFrameRate ? null : frameRateRefusal(cut.frames, srcRes, fpsNum, fpsDen);
  if (rateRefusal) throw new FastCutFallback(rateRefusal);

  // Output timeline: the moment starts on its frame of the output grid and
  // keeps the source's own frame times from there; the first frame covers
  // the cut instant (like the full encode), so it may start a little late.
  const segStartS = (segment.startFrame * fpsDen) / fpsNum;
  const segEndS = (segment.endFrame * fpsDen) / fpsNum;
  const startTicks = Math.round(segStartS * outRes);
  const endTicks = Math.round(segEndS * outRes);
  const shift = Math.round((segStartS - firstTarget) * outRes);
  const outTicks = cut.frames.map((t) =>
    Math.max(startTicks, (outRes === srcRes ? t : Math.round((t * outRes) / srcRes)) + shift),
  );
  for (let i = 1; i < outTicks.length; i += 1) {
    if ((outTicks[i] ?? 0) <= (outTicks[i - 1] ?? 0)) throw new FastCutFallback('timing');
  }
  if ((outTicks[outTicks.length - 1] ?? 0) >= endTicks) throw new FastCutFallback('timing');

  const index = new Map<number, number>();
  cut.frames.forEach((t, i) => index.set(t, i));
  return { segment, cut, packets, outTicks, endTicks, index };
}

/* ------------------------------------------------------------ seam encoder */

interface EncodedRunPacket {
  data: Uint8Array;
  key: boolean;
  timestampUs: number;
}

function hex2(value: number): string {
  return value.toString(16).padStart(2, '0').toUpperCase();
}

/** Encoder configurations to try, closest to the source first. */
function encoderCandidates(avc: AvcConfigRecord, width: number, height: number, bitrate: number): VideoEncoderConfig[] {
  const byProfile: Record<number, string[]> = {
    66: ['42E0', '4D40', '6400'],
    77: ['4D40', '6400', '42E0'],
  };
  const profiles = byProfile[avc.profileIdc] ?? ['6400', '4D40', '42E0'];
  const levels = [...new Set([avc.levelIdc, 0x28, 0x2a, 0x32, 0x33, 0x34])].filter((level) => level >= avc.levelIdc);
  const configs: VideoEncoderConfig[] = [];
  for (const mode of ['quantizer', 'variable'] as const) {
    for (const profile of profiles) {
      for (const level of levels) {
        configs.push({
          codec: `avc1.${profile}${hex2(level)}`,
          width,
          height,
          ...(mode === 'quantizer' ? { bitrateMode: 'quantizer' as VideoEncoderBitrateMode } : { bitrate }),
          latencyMode: 'quality',
          avc: { format: 'avc' },
        });
      }
    }
  }
  return configs;
}

class SeamEncoder {
  private encoder: VideoEncoder | null = null;
  private outputs: EncodedRunPacket[] = [];
  private description: Uint8Array | null = null;
  private failure: Error | null = null;
  private quantizer = false;

  static async open(configs: VideoEncoderConfig[]): Promise<SeamEncoder | null> {
    for (const config of configs) {
      let supported = false;
      try {
        supported = (await VideoEncoder.isConfigSupported(config)).supported === true;
      } catch {
        supported = false;
      }
      if (!supported) continue;
      const seam = new SeamEncoder();
      try {
        seam.configure(config);
        return seam;
      } catch {
        seam.close();
      }
    }
    return null;
  }

  private configure(config: VideoEncoderConfig): void {
    this.quantizer = config.bitrateMode === 'quantizer';
    this.encoder = new VideoEncoder({
      output: (chunk, metadata) => {
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        const description = metadata?.decoderConfig?.description;
        if (description) this.description = bytesOf(description).slice();
        this.outputs.push({ data, key: chunk.type === 'key', timestampUs: chunk.timestamp });
      },
      error: (error) => {
        this.failure = error;
      },
    });
    this.encoder.configure(config);
  }

  async add(frame: VideoFrame, keyFrame: boolean): Promise<void> {
    const encoder = this.encoder;
    if (!encoder || this.failure) throw new FastCutFallback('encoder');
    while (encoder.encodeQueueSize > MAX_ENCODE_QUEUE) {
      await new Promise<void>((resolve) => encoder.addEventListener('dequeue', () => resolve(), { once: true }));
    }
    const options = this.quantizer
      ? ({ keyFrame, avc: { quantizer: SEAM_QUANTIZER } } as VideoEncoderEncodeOptions)
      : { keyFrame };
    encoder.encode(frame, options);
  }

  /** Waits for every frame added so far; returns them in decode order. */
  async finishRun(): Promise<{ packets: EncodedRunPacket[]; params: AvcConfigRecord }> {
    const encoder = this.encoder;
    if (!encoder) throw new FastCutFallback('encoder');
    try {
      await encoder.flush();
    } catch {
      throw new FastCutFallback('encoder');
    }
    if (this.failure) throw new FastCutFallback('encoder');
    const packets = this.outputs;
    this.outputs = [];
    const params = this.description ? parseAvcC(this.description) : null;
    if (!params || params.lengthSize !== 4) throw new FastCutFallback('encoder');
    return { packets, params };
  }

  close(): void {
    try {
      if (this.encoder && this.encoder.state !== 'closed') this.encoder.close();
    } catch {
      // Already closed.
    }
    this.encoder = null;
  }
}

/* ------------------------------------------------------------ frame digest */

/** FNV-1a over the frame's pixels as the decoder delivered them. */
async function frameDigest(frame: VideoFrame): Promise<string> {
  const size = frame.allocationSize();
  const buffer = new Uint8Array(size);
  await frame.copyTo(buffer);
  let hash = 0x811c9dc5;
  for (let i = 0; i < buffer.length; i += 1) {
    hash ^= buffer[i] ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${frame.format ?? 'x'}:${size}:${hash.toString(16)}`;
}

async function digestAt(track: InputVideoTrack, seconds: number, resolution: number): Promise<string | null> {
  const sink = new VideoSampleSink(track);
  for await (const sample of sink.samples(seconds, seconds + 0.5 / resolution)) {
    try {
      if (Math.abs(sample.timestamp - seconds) > 0.5 / resolution + 1e-6) continue;
      const frame = sample.toVideoFrame();
      try {
        return await frameDigest(frame);
      } finally {
        frame.close();
      }
    } finally {
      sample.close();
    }
  }
  return null;
}

/* ------------------------------------------------------------------ job */

/**
 * Decides whether the plan can be fast-cut and prepares everything that can
 * fail before an output file exists: eligibility, packet scan, the cut of
 * every moment, and a seam encoder this browser really supports.
 */
export async function prepareFastCut(options: {
  plan: RenderPlan;
  input: Input;
  track: InputVideoTrack;
  hdr: boolean;
  needsReorderFix: boolean;
  mode: ExportMode;
  checkCanceled: () => void;
  variant?: FastCutVariant;
}): Promise<{ ok: true; job: FastCutJob } | { ok: false; reason: FastCutFallbackReason }> {
  const { plan, input, track, mode, checkCanceled } = options;
  const variant = options.variant ?? {};
  const { facts, avc, config } = await sourceFacts(input, track, options.hdr, options.needsReorderFix);
  const eligibility = fastCutEligibility(plan, facts, mode);
  if (!eligibility.ok) return eligibility;
  if (!avc || !config?.description) return { ok: false, reason: 'bitstream' };
  const sourceSps = avc.sps[0] ? readSps(avc.sps[0]) : null;
  if (!sourceSps) return { ok: false, reason: 'bitstream' };

  const srcRes = await track.getTimeResolution();
  // The output keeps the source's clock when it is a sane integer rate.
  const outRes = Number.isInteger(srcRes) && srcRes > 0 && srcRes <= 1_000_000 ? srcRes : 90_000;
  const packetSink = new EncodedPacketSink(track);

  const scanned: ScannedSegment[] = [];
  try {
    for (const segment of plan.segments) {
      checkCanceled();
      if (segment.endFrame <= segment.startFrame) continue;
      scanned.push(await scanSegment(packetSink, plan, segment, srcRes, outRes, variant.anyFrameRate === true));
    }
  } catch (error) {
    if (error instanceof FastCutFallback) return { ok: false, reason: error.reason };
    throw error;
  }

  let framesCopied = 0;
  let framesEncoded = 0;
  let copiedBytes = 0;
  let copiedSeconds = 0;
  for (const s of scanned) {
    framesCopied += s.cut.copyTo - s.cut.copyFrom;
    framesEncoded += s.cut.head.length + s.cut.tail.length;
    for (let i = s.cut.copyFrom; i < s.cut.copyTo; i += 1) copiedBytes += s.packets[i]?.byteLength ?? 0;
  }
  if (framesCopied === 0) return { ok: false, reason: 'no_keyframe' };
  for (const s of scanned) {
    const frames = s.cut.frames;
    copiedSeconds += ((frames[frames.length - 1] ?? 0) - (frames[0] ?? 0)) / srcRes;
  }

  const codedWidth = await track.getCodedWidth();
  const codedHeight = await track.getCodedHeight();
  const sourceBitrate = copiedSeconds > 0 ? (copiedBytes * 8) / copiedSeconds : 8_000_000;
  let seamEncoder: SeamEncoder | null = null;
  if (framesEncoded > 0) {
    const bitrate = Math.round(Math.min(60_000_000, Math.max(4_000_000, sourceBitrate * 2)));
    seamEncoder = await SeamEncoder.open(encoderCandidates(avc, codedWidth, codedHeight, bitrate));
    if (!seamEncoder) return { ok: false, reason: 'encoder' };
  }

  const matrix = await track.getTransformationMatrix();
  const colorSpace = await track.getColorSpace().catch(() => undefined);
  const decoderConfig: VideoDecoderConfig = {
    codec: variant.sampleEntry === 'avc3' ? config.codec.replace(/^avc1/, 'avc3') : config.codec,
    codedWidth,
    codedHeight,
    description: bytesOf(config.description).slice(),
    ...(colorSpace ? { colorSpace } : {}),
  };
  const videoSource = new EncodedVideoPacketSource('avc');
  const sampleSink = new VideoSampleSink(track);
  const seams: Seam[] = [];
  let firstPacket = true;
  let framesDone = 0;
  const totalFrames = scanned.reduce((sum, s) => sum + s.cut.frames.length, 0);
  // Average source frame size, 3x for a seam frame, for the storage estimate.
  const seamBytes = framesEncoded * (framesCopied > 0 ? (copiedBytes / framesCopied) * 3 : 500_000);

  const outS = (ticks: number) => ticks / outRes;
  const durationOf = (s: ScannedSegment, i: number) =>
    ((s.outTicks[i + 1] ?? s.endTicks) - (s.outTicks[i] ?? 0)) / outRes;

  async function add(packet: EncodedPacket): Promise<void> {
    if (firstPacket) {
      firstPacket = false;
      await videoSource.add(packet, { decoderConfig });
    } else {
      await videoSource.add(packet);
    }
  }

  /** Re-encodes the frames at `ticks` (source ticks, ascending) as a new closed GOP. */
  async function encodeRun(s: ScannedSegment, ticks: number[]): Promise<void> {
    const encoder = seamEncoder;
    const firstTick = ticks[0];
    const lastTick = ticks[ticks.length - 1];
    if (!encoder || firstTick === undefined || lastTick === undefined) throw new FastCutFallback('encoder');
    const wanted = new Set(ticks);
    const byUs = new Map<number, number>();
    let fed = 0;
    for await (const sample of sampleSink.samples(firstTick / srcRes, (lastTick + 0.5) / srcRes)) {
      try {
        checkCanceled();
        const tick = Math.round(sample.timestamp * srcRes);
        if (!wanted.has(tick)) continue;
        const i = s.index.get(tick);
        if (i === undefined) continue;
        const outTicks = s.outTicks[i] ?? 0;
        const timestampUs = Math.round(outS(outTicks) * US_PER_SECOND);
        byUs.set(timestampUs, i);
        const decoded = sample.toVideoFrame();
        const frame = new VideoFrame(decoded, {
          timestamp: timestampUs,
          duration: Math.max(1, Math.round(durationOf(s, i) * US_PER_SECOND)),
        });
        decoded.close();
        try {
          await encoder.add(frame, fed === 0);
        } finally {
          frame.close();
        }
        fed += 1;
      } finally {
        sample.close();
      }
    }
    if (fed !== ticks.length) throw new FastCutFallback('timing');
    const { packets, params } = await encoder.finishRun();
    if (packets.length !== ticks.length) throw new FastCutFallback('encoder');
    const encodedSps = params.sps[0] ? readSps(params.sps[0]) : null;
    if (
      !encodedSps ||
      encodedSps.width !== sourceSps?.width ||
      encodedSps.height !== sourceSps.height ||
      encodedSps.chromaFormatIdc !== 1 ||
      encodedSps.bitDepthLuma !== 8 ||
      !encodedSps.frameMbsOnly
    ) {
      throw new FastCutFallback('encoder');
    }
    for (const [n, packet] of packets.entries()) {
      const i = byUs.get(packet.timestampUs);
      if (i === undefined) throw new FastCutFallback('encoder');
      let data = packet.data;
      if (n === 0) {
        if (!packet.key || !isIdrPacket(data, 4)) throw new FastCutFallback('encoder');
        data = withParameterSets(data, 4, params.sps, params.pps);
      }
      const type = n === 0 || (packet.key && isIdrPacket(data, 4)) ? 'key' : 'delta';
      await add(new EncodedPacket(data, type, outS(s.outTicks[i] ?? 0), durationOf(s, i)));
    }
  }

  const job: FastCutJob = {
    method: framesEncoded > 0 ? 'smart' : 'copy',
    segments: scanned.map((s) => ({
      firstSourceS: (s.cut.frames[0] ?? 0) / srcRes,
      lastSourceS: (s.cut.frames[s.cut.frames.length - 1] ?? 0) / srcRes,
      frames: s.cut.frames.length,
      head: s.cut.head.length,
      copied: s.cut.copyTo - s.cut.copyFrom,
      tail: s.cut.tail.length,
      sourceTimesS: s.cut.frames.map((t) => t / srcRes),
      outputTimesS: s.outTicks.map((t) => t / outRes),
    })),
    totalFrames,
    framesCopied,
    framesEncoded,
    videoBytes: Math.ceil(copiedBytes + seamBytes),

    addTrack(output: Output) {
      output.addVideoTrack(videoSource, { frameRate: outRes, transformationMatrix: matrix });
    },

    async writeSegment(index, onProgress) {
      const s = scanned.find((item) => item.segment === plan.segments[index]);
      if (!s) return;
      const { cut } = s;
      const segStartTicks = s.outTicks[0] ?? 0;

      if (cut.head.length > 0) {
        await encodeRun(s, cut.head);
        framesDone += cut.head.length;
        await onProgress(outS(s.outTicks[cut.head.length] ?? s.endTicks) * US_PER_SECOND, framesDone);
      }

      if (cut.copyTo > cut.copyFrom) {
        // `cut.frames` is ascending: head, then the copied frames, then the tail.
        const firstCopied = cut.head.length;
        let i = cut.copyFrom;
        let maxOut = 0;
        const copyStart = await withData(packetSink, s.packets[cut.copyFrom]);
        for await (const packet of packetSink.packets(copyStart, s.packets[cut.copyTo])) {
          checkCanceled();
          if (i >= cut.copyTo) break;
          const tick = Math.round(packet.timestamp * srcRes);
          const f = s.index.get(tick);
          if (f === undefined || s.packets[i]?.sequenceNumber !== packet.sequenceNumber) {
            throw new FastCutFallback('timing');
          }
          const idr = packet.type === 'key' && isIdrPacket(packet.data, 4);
          if (i === cut.copyFrom && !idr) throw new FastCutFallback('timing');
          // After re-encoded frames (or at the file start) the source's own
          // parameter sets are put back in front of the IDR.
          const data = i === cut.copyFrom ? withParameterSets(packet.data, 4, avc.sps, avc.pps) : packet.data;
          const outTicks = s.outTicks[f] ?? 0;
          maxOut = Math.max(maxOut, outTicks);
          await add(new EncodedPacket(data, idr ? 'key' : 'delta', outS(outTicks), durationOf(s, f)));
          i += 1;
          framesDone += 1;
          if ((i - cut.copyFrom) % PROGRESS_EVERY_PACKETS === 0) {
            await onProgress(outS(maxOut) * US_PER_SECOND, framesDone);
          }
        }
        if (i !== cut.copyTo) throw new FastCutFallback('timing');

        // Seam check at every copy start (after re-encoded frames or another
        // moment): the first copied picture must decode to the source's pixels,
        // i.e. the source's parameter sets really took over again.
        const endIndex = Math.min(s.outTicks.length - 1, firstCopied + 3);
        seams.push({
          expected: s.outTicks.slice(0, endIndex + 1),
          startS: outS(segStartTicks),
          endS: outS((s.outTicks[endIndex] ?? 0) + 1),
          digest: { sourceS: (cut.frames[firstCopied] ?? 0) / srcRes, outputS: outS(s.outTicks[firstCopied] ?? 0) },
        });
      }

      if (cut.tail.length > 0) {
        const tailFirst = s.index.get(cut.tail[0] ?? 0) ?? 0;
        await encodeRun(s, cut.tail);
        framesDone += cut.tail.length;
        const from = Math.max(0, tailFirst - 3);
        seams.push({
          expected: s.outTicks.slice(from),
          startS: outS(s.outTicks[from] ?? 0),
          endS: outS(s.endTicks),
          digest: null,
        });
      }
      await onProgress(outS(s.endTicks) * US_PER_SECOND, framesDone);
    },

    finishVideo() {
      videoSource.close();
    },

    async verify(produced) {
      const check = new Input({
        formats: ALL_FORMATS,
        source: produced instanceof Blob ? new BlobSource(produced) : new BufferSource(produced),
      });
      const outTrack = await check.getPrimaryVideoTrack();
      if (!outTrack) throw new FastCutFallback('seam_check');
      let count = 0;
      for await (const packet of new EncodedPacketSink(outTrack).packets(undefined, undefined, { metadataOnly: true })) {
        void packet;
        count += 1;
      }
      if (count !== totalFrames) throw new FastCutFallback('seam_check');

      const outSink = new VideoSampleSink(outTrack);
      for (const seam of seams) {
        checkCanceled();
        let delivered = 0;
        try {
          for await (const sample of outSink.samples(seam.startS, seam.endS)) {
            const tick = Math.round(sample.timestamp * outRes);
            if (tick >= (seam.expected[0] ?? 0) && tick <= (seam.expected[seam.expected.length - 1] ?? 0)) {
              delivered += 1;
            }
            sample.close();
          }
        } catch {
          throw new FastCutFallback('seam_check');
        }
        if (delivered !== seam.expected.length) throw new FastCutFallback('seam_check');
        if (seam.digest) {
          const [fromSource, fromOutput] = await Promise.all([
            digestAt(track, seam.digest.sourceS, srcRes),
            digestAt(outTrack, seam.digest.outputS, outRes),
          ]);
          if (!fromSource || fromSource !== fromOutput) throw new FastCutFallback('seam_check');
        }
      }
    },

    close() {
      seamEncoder?.close();
    },
  };
  return { ok: true, job };
}
