/**
 * Fast-cut spike page (ADR-027). Bundled by `run-fast-cut-spike.mjs` with
 * esbuild so the page runs the app's own `fastCut.ts`, `segmentAudio.ts` and
 * domain code — not a copy of them. Everything runs locally; outputs are
 * POSTed to the local spike server only.
 */

import {
  ALL_FORMATS,
  AudioSampleSink,
  AudioSampleSource,
  BufferTarget,
  EncodedPacket,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Input,
  BlobSource,
  Mp4OutputFormat,
  Output,
  VideoSampleSink,
} from 'mediabunny';

import { AudioStreamReader } from '@/adapters/export/audioStream';
import { raiseAvcReorderDepth, reorderDepth } from '@/adapters/export/avcReorder';
import { prepareFastCut, type FastCutVariant } from '@/adapters/export/fastCut';
import { SegmentAudioWriter } from '@/adapters/export/segmentAudio';
import { frameAtUs, frameToUs, type RenderPlan, type RenderSegment } from '@/domain/renderPlan';

declare global {
  interface Window {
    spike: typeof spike;
  }
}

/** Sends a file to the local spike server in 8 MiB pieces (one huge POST body stalled in Chrome). */
async function upload(name: string, data: Uint8Array): Promise<void> {
  const piece = 8 * 1024 * 1024;
  for (let offset = 0; offset < Math.max(1, data.byteLength); offset += piece) {
    const body = data.slice(offset, Math.min(data.byteLength, offset + piece));
    const response = await fetch(`/upload/${encodeURIComponent(name)}?offset=${offset}`, { method: 'POST', body });
    if (!response.ok) throw new Error(`upload ${name}: ${response.status}`);
  }
  console.log(`[spike] ${name}: uploaded ${data.byteLength} bytes`);
}

async function sourceFile(url: string): Promise<File> {
  const response = await fetch(url);
  const blob = await response.blob();
  return new File([blob], url.split('/').pop() ?? 'source.mp4', { type: 'video/mp4' });
}

/** The render plan the editor would compile for these ranges (seconds) at the source's own size. */
function makePlan(ranges: [number, number][], width: number, height: number, fpsNum: number): RenderPlan {
  const segments: RenderSegment[] = [];
  let cursor = 0;
  for (const [i, [inS, outS]] of ranges.entries()) {
    const inUs = Math.round(inS * 1e6);
    const outUs = Math.round(outS * 1e6);
    const startFrame = frameAtUs(cursor, fpsNum, 1);
    const endFrame = frameAtUs(cursor + outUs - inUs, fpsNum, 1);
    segments.push({
      clipId: `c${i}`,
      assetId: 'a',
      startFrame,
      endFrame,
      sourceInUs: inUs,
      sourceOutUs: outUs,
      crop: { x: 0, y: 0, width, height },
      fit: 'cover',
      gain: 1,
      muted: false,
    });
    cursor += outUs - inUs;
  }
  const totalFrames = segments[segments.length - 1]?.endFrame ?? 0;
  return {
    planVersion: 2,
    engineId: 'spike',
    fingerprint: 'spike',
    container: 'mp4',
    videoCodec: 'avc',
    audioCodec: 'aac',
    width,
    height,
    aspect: width >= height ? '16:9' : '9:16',
    background: '#000000',
    fpsNum,
    fpsDen: 1,
    totalFrames,
    expectedDurationUs: frameToUs(totalFrames, fpsNum, 1),
    requestedDurationUs: cursor,
    videoBitrate: 5_600_000,
    audioBitrate: 128_000,
    segments,
    audio: { sampleRate: 48000, channelCount: 2, safetyGain: Math.pow(10, -1 / 20), wantsSourceAudio: true, music: null },
    captions: null,
  } as RenderPlan;
}

/** The export worker's reorder check (ADR-014 §3), metadata only: would it rewrite the SPS? */
async function needsReorderFix(input: Input): Promise<boolean> {
  const track = await input.getPrimaryVideoTrack();
  if (!track || (await track.getCodec()) !== 'avc') return false;
  const config = await track.getDecoderConfig();
  if (!config?.description) return false;
  const sink = new EncodedPacketSink(track);
  const times: number[] = [];
  const first = await sink.getFirstPacket({ metadataOnly: true });
  if (!first) return false;
  for await (const packet of sink.packets(first, undefined, { metadataOnly: true })) {
    times.push(packet.timestamp);
    if (times.length >= 240) break;
  }
  const description = config.description as Uint8Array;
  const bytes = ArrayBuffer.isView(description)
    ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength)
    : new Uint8Array(description as ArrayBuffer);
  return raiseAvcReorderDepth(bytes, reorderDepth(times)) !== null;
}

async function fastCut(options: {
  url: string;
  name: string;
  ranges: [number, number][];
  fps?: number;
  variant?: FastCutVariant;
}) {
  const started = performance.now();
  const file = await sourceFile(options.url);
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  const track = await input.getPrimaryVideoTrack();
  if (!track) return { ok: false, reason: 'no_video' };
  const width = await track.getDisplayWidth();
  const height = await track.getDisplayHeight();
  const plan = makePlan(options.ranges, width, height, options.fps ?? 30);
  const reorderFix = await needsReorderFix(input);
  console.log(`[spike] ${options.name}: opened, preparing`);

  const prepared = await prepareFastCut({
    plan,
    input,
    track,
    hdr: false,
    needsReorderFix: reorderFix,
    mode: 'auto',
    checkCanceled: () => undefined,
    variant: options.variant,
  });
  const preparedMs = performance.now() - started;
  console.log(`[spike] ${options.name}: prepared ${Math.round(preparedMs)} ms`);
  if (!prepared.ok) return { ok: false, reason: prepared.reason, preparedMs };
  const job = prepared.job;

  const output = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target: new BufferTarget() });
  job.addTrack(output);
  const audioTrack = await input.getPrimaryAudioTrack();
  const audioSource = audioTrack ? new AudioSampleSource({ codec: 'aac', bitrate: 128_000 }) : null;
  if (audioSource) output.addAudioTrack(audioSource);
  const sources = {
    clipReader: audioTrack ? new AudioStreamReader(new AudioSampleSink(audioTrack)) : null,
    musicReader: null,
  };
  await output.start();
  for (const [index, segment] of plan.segments.entries()) {
    const writer = audioSource ? new SegmentAudioWriter(plan, segment, sources, audioSource, () => undefined) : null;
    console.log(`[spike] ${options.name}: segment ${index}`);
    await job.writeSegment(index, async (us) => {
      await writer?.advanceTo(us);
    });
    await writer?.advanceTo();
  }
  job.finishVideo();
  audioSource?.close();
  await output.finalize();
  await sources.clipReader?.close();
  const buffer = new Uint8Array(output.target.buffer ?? new ArrayBuffer(0));
  const writtenMs = performance.now() - started;
  console.log(`[spike] ${options.name}: written, verifying`);
  let verify = 'passed';
  try {
    await job.verify(buffer);
  } catch (error) {
    verify = error instanceof Error ? error.message : String(error);
  }
  job.close();
  const verifiedMs = performance.now() - started;
  console.log(`[spike] ${options.name}: verified (${verify})`);
  await upload(options.name, buffer);
  return {
    ok: true,
    method: job.method,
    totalFrames: job.totalFrames,
    framesCopied: job.framesCopied,
    framesEncoded: job.framesEncoded,
    segments: job.segments,
    plan: { totalFrames: plan.totalFrames, expectedDurationUs: plan.expectedDurationUs, segments: plan.segments },
    verify,
    sizeBytes: buffer.byteLength,
    rotation: await track.getRotation(),
    reorderFix,
    ms: { prepared: preparedMs, written: writtenMs, verified: verifiedMs },
  };
}

/**
 * Variant (b): copy from the IDR before the cut and hide the frames before
 * it with an MP4 edit list (mediabunny writes one when the first timestamp is
 * negative). One range only; it must end on a copy-safe point (the next IDR).
 */
async function editListCut(options: { url: string; name: string; inS: number; outS: number }) {
  const file = await sourceFile(options.url);
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  const track = await input.getPrimaryVideoTrack();
  if (!track) return { ok: false };
  const config = await track.getDecoderConfig();
  if (!config) return { ok: false };
  const sink = new EncodedPacketSink(track);
  const start = await sink.getKeyPacket(options.inS);
  if (!start) return { ok: false };
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target: new BufferTarget() });
  const source = new EncodedVideoPacketSource('avc');
  output.addVideoTrack(source, { frameRate: await track.getTimeResolution(), transformationMatrix: await track.getTransformationMatrix() });
  await output.start();
  let first = true;
  let hidden = 0;
  let shown = 0;
  for await (const packet of sink.packets(start)) {
    if (packet.type === 'key' && packet.timestamp >= options.outS - 1e-6) break;
    const t = packet.timestamp - options.inS;
    if (t < -1e-6) hidden += 1;
    else shown += 1;
    const out = new EncodedPacket(packet.data, packet.type, t, packet.duration);
    if (first) {
      await source.add(out, { decoderConfig: config });
      first = false;
    } else {
      await source.add(out);
    }
  }
  source.close();
  await output.finalize();
  const buffer = new Uint8Array(output.target.buffer ?? new ArrayBuffer(0));
  await upload(options.name, buffer);
  return { ok: true, hidden, shown, keyAtS: start.timestamp };
}

/** Reads the frame-number barcode from the element's current picture (display orientation). */
function readBarcode(
  context: CanvasRenderingContext2D,
  codedWidth: number,
  codedHeight: number,
  rotation: number,
): { frame: number; confidence: number } {
  const map = (x: number, y: number): [number, number] => {
    // Coded (x, y) -> display (X, Y) for a clockwise rotation.
    switch (rotation) {
      case 90:
        return [codedHeight - 1 - y, x];
      case 180:
        return [codedWidth - 1 - x, codedHeight - 1 - y];
      case 270:
        return [y, codedWidth - 1 - x];
      default:
        return [x, y];
    }
  };
  let value = 0;
  let weakest = 255;
  for (let bit = 0; bit < 20; bit += 1) {
    const [X, Y] = map(bit * 64 + 32, 24);
    const data = context.getImageData(X - 4, Y - 4, 9, 9).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += ((data[i] ?? 0) + (data[i + 1] ?? 0) + (data[i + 2] ?? 0)) / 3;
    const lum = sum / (data.length / 4);
    weakest = Math.min(weakest, Math.abs(lum - 128));
    if (lum > 128) value += 2 ** bit;
  }
  return { frame: value, confidence: weakest };
}

/**
 * The file in a `<video>` element, the way a person watches it: seek to each
 * requested time and read which frame is on screen, then play it through at
 * 2x and count what the element presented.
 */
async function playCheck(options: {
  url: string;
  times: number[];
  codedWidth: number;
  codedHeight: number;
  rotation: number;
  play: boolean;
  rate?: number;
}) {
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  video.src = options.url;
  document.body.append(video);
  console.log(`[spike] playCheck ${options.url}: ${options.times.length} seeks`);
  const errors: string[] = [];
  video.addEventListener('error', () => errors.push(`error ${video.error?.code}: ${video.error?.message}`));
  await new Promise<void>((resolve, reject) => {
    video.addEventListener('loadeddata', () => resolve(), { once: true });
    video.addEventListener('error', () => reject(new Error(`load error ${video.error?.code}`)), { once: true });
  });
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('no 2d');

  const seeks: { t: number; frame: number; confidence: number }[] = [];
  for (const t of options.times) {
    await new Promise<void>((resolve) => {
      // A seek that never completes is reported, not waited for forever.
      const timer = setTimeout(() => {
        errors.push(`seek ${t} timed out`);
        resolve();
      }, 10_000);
      video.addEventListener(
        'seeked',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      video.currentTime = t;
    });
    // One more presented frame so the compositor really shows the seeked picture.
    await new Promise<void>((resolve) => {
      const v = video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
      if (v.requestVideoFrameCallback) {
        v.requestVideoFrameCallback(() => resolve());
        setTimeout(resolve, 500);
      } else resolve();
    });
    context.drawImage(video, 0, 0);
    seeks.push({ t, ...readBarcode(context, options.codedWidth, options.codedHeight, options.rotation) });
  }

  let played: { presented: number; frames: number[]; ended: boolean; quality: unknown } | null = null;
  if (options.play) {
    await new Promise<void>((resolve) => {
      video.addEventListener('seeked', () => resolve(), { once: true });
      setTimeout(resolve, 10_000);
      video.currentTime = 0;
    });
    const frames: number[] = [];
    let presented = 0;
    const v = video as HTMLVideoElement & {
      requestVideoFrameCallback: (cb: (now: number, meta: { presentedFrames: number }) => void) => number;
    };
    const onFrame = (_now: number, meta: { presentedFrames: number }) => {
      presented = meta.presentedFrames;
      context.drawImage(video, 0, 0);
      frames.push(readBarcode(context, options.codedWidth, options.codedHeight, options.rotation).frame);
      if (!video.ended) v.requestVideoFrameCallback(onFrame);
    };
    v.requestVideoFrameCallback(onFrame);
    video.playbackRate = options.rate ?? 1;
    const ended = await new Promise<boolean>((resolve) => {
      video.addEventListener('ended', () => resolve(true), { once: true });
      video.play().catch(() => resolve(false));
      setTimeout(() => resolve(false), (video.duration / (options.rate ?? 1) + 10) * 1000);
    });
    played = { presented, frames, ended, quality: video.getVideoPlaybackQuality() };
  }
  const duration = video.duration;
  video.remove();
  return { duration, seeks, played, errors };
}

/** Every frame of a file decoded with WebCodecs (mediabunny), barcodes read in coded orientation. */
async function decodeAll(options: { url: string; maxFrames?: number }) {
  const file = await sourceFile(options.url);
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  const track = await input.getPrimaryVideoTrack();
  if (!track) return null;
  const canvas = new OffscreenCanvas(1280, 48);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  const frames: { t: number; frame: number }[] = [];
  for await (const sample of new VideoSampleSink(track).samples()) {
    const vf = sample.toVideoFrame();
    // The barcode strip, coded orientation.
    context.drawImage(vf, 0, 0, 1280, 48, 0, 0, 1280, 48);
    vf.close();
    frames.push({ t: sample.timestamp, frame: readBarcode(context as unknown as CanvasRenderingContext2D, 1280, 48, 0).frame });
    sample.close();
    if (options.maxFrames && frames.length >= options.maxFrames) break;
  }
  return frames;
}

const spike = { fastCut, editListCut, playCheck, decodeAll };
window.spike = spike;
