/// <reference lib="webworker" />

/**
 * The GIF worker (ADR-046): one part of the video (at most ten seconds)
 * becomes a looping GIF, on this device.
 *
 * Decoding is the export's own road, reused, not a second one: mediabunny's
 * `VideoSampleSink` in one continuous pass (`framePicker`: no flush at every
 * group of pictures), the decoder held open until the last frame is drawn
 * (`decoderHold`, ADR-033), the incomplete-file check (ADR-040), HDR through
 * the float canvas and the soft clip that the export verified (ADR-022).
 * `VideoSample.draw` applies the file's rotation. Nothing is ever enlarged
 * (ADR-041): the size comes from `planGifSize`.
 *
 * Two jobs:
 * - `estimate`: a few moments of the part, three frames each, encoded exactly
 *   as the GIF will be — what the "yaklaşık 3 MB" on the screen is made of;
 * - `make`: every frame of the part, the text drawn on each, one palette,
 *   the GIF's bytes back to the page. The palette's sample is gathered as the
 *   frames come (`GifPaletteSampler`); frames are held only while they fit in
 *   the budget (`gifFramesBudget`: 32 MiB, or 128 MiB where the device says it
 *   has 8 GB) — a larger GIF (e.g. ten seconds of "Büyük", 115 MB of frames)
 *   decodes the part a second time and writes each frame as it comes, holding
 *   none (ADR-046 memory addendum). The same bytes either way.
 *
 * Cancel is a `terminate()` from the page.
 */

import { ALL_FORMATS, BlobSource, EncodedPacketSink, Input, IsobmffInputFormat, VideoSampleSink, type InputVideoTrack } from 'mediabunny';

import { loadCaptionFont } from '@/adapters/captionRender';
import { holdDecoder } from '@/adapters/export/decoderHold';
import { originOf, stageOf, tagStage, withOrigin } from '@/adapters/export/failureStage';
import { pickFrames } from '@/adapters/export/framePicker';
import { createHdrContext, softClippedImage } from '@/adapters/export/hdrCanvas';
import { probeHdrToneMapping } from '@/adapters/export/hdrProbe';
import { sourceIntegrity } from '@/adapters/sourceIntegrity';
import { applyWorkerFault } from '@/adapters/workerFault';
import { missingFramesAllowed } from '@/domain/exportEvents';
import { caughtFailureDetail, failureHint, stalledFailureDetail, type ExportStage } from '@/domain/exportFailureDetail';
import {
  GIF_FIXED_BYTES,
  GIF_FRAME_US,
  gifFrameTimesUs,
  gifFramesBudget,
  gifHoldsFrames,
  normalizeGifRange,
  planGifSize,
  type GifSize,
  type GifTextLayout,
} from '@/domain/gif';
import { hdrTransferOf, type HdrTransfer } from '@/domain/hdr';
import { US_PER_SECOND } from '@/domain/time';
import { GifPaletteSampler, GifWriter, buildGifPalette } from './gifEncode';
import { drawGifText, gifMeasure, gifTextLayouts } from './gifText';
import type { GifFailure, GifJob, GifSample, GifWorkerRequest, GifWorkerResponse } from './protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;

/** '1' only in a test build (`CLIP_TEST_HOOKS=1`); the published site is built with ''. */
const TEST_HOOKS = process.env.NEXT_PUBLIC_CLIP_TEST_HOOKS === '1';

/** Progress is posted at most this often (and always for the last frame). */
const PROGRESS_INTERVAL_MS = 100;

/**
 * The estimate looks at this many moments of the part, `ESTIMATE_RUN` consecutive frames at each.
 * 8 × 3 since 20 Oct 2026 (ADR-046 addendum), measured in the app on 9 real phone recordings × 3 sizes
 * × 4 or 10 s: with 4 × 2, 37 of 54 GIFs were within 10 % of the estimate (up to 19 % larger, 12 %
 * smaller); with 8 × 3, 48 of 54 — the other six all of one almost-still video of 40–250 KB.
 */
const ESTIMATE_MOMENTS = 8;
const ESTIMATE_RUN = 3;

/** Where the running job is, for the day it fails or stands still (ADR-042): this file's own word, nothing of the video. */
let stage: ExportStage = 'unknown';

class GifError extends Error {
  constructor(readonly reason: GifFailure) {
    super(reason);
    this.name = 'GifFailure';
  }
}

function post(message: GifWorkerResponse, transfer?: Transferable[]): void {
  if (transfer) scope.postMessage(message, transfer);
  else scope.postMessage(message);
}

/** The opened video, ready to draw frames of at the GIF's size. */
interface Source {
  input: Input;
  track: InputVideoTrack;
  size: GifSize;
  hdr: HdrTransfer | null;
  layouts: GifTextLayout[];
  canvas: OffscreenCanvas;
  context: OffscreenCanvasRenderingContext2D;
  hdrContext: OffscreenCanvasRenderingContext2D | null;
}

/** HDR tone mapping is checked once per worker, like the export does per run. */
const toneMapped = new Map<HdrTransfer, Promise<boolean>>();

async function open(job: GifJob): Promise<Source> {
  stage = 'open_source';
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(job.file) });
  try {
    let track: InputVideoTrack | null;
    try {
      track = await input.getPrimaryVideoTrack();
    } catch (error) {
      throw withOrigin(new GifError('source_undecodable'), tagStage(error, 'open_source'));
    }
    if (!track) throw new GifError('no_video_track');
    if (!(await track.canDecode().catch(() => false))) throw new GifError('source_undecodable');
    // ADR-040: a file whose end is missing is refused, never turned into a GIF that stops early.
    const verdict = await sourceIntegrity(input, { EncodedPacketSink, isIndexed: (format) => format instanceof IsobmffInputFormat });
    if (verdict.kind === 'incomplete') throw new GifError('source_incomplete');

    let hdr: HdrTransfer | null = null;
    try {
      hdr = hdrTransferOf((await track.getColorSpace()).transfer);
    } catch {
      hdr = null;
    }
    if (hdr) {
      let check = toneMapped.get(hdr);
      if (!check) {
        check = probeHdrToneMapping(hdr).then((result) => result.status === 'verified', () => false);
        toneMapped.set(hdr, check);
      }
      if (!(await check)) throw new GifError('hdr_source_unsupported');
    }

    const size = planGifSize(await track.getDisplayWidth(), await track.getDisplayHeight(), job.size);
    stage = 'setup';
    const canvas = new OffscreenCanvas(size.width, size.height);
    const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
    if (!context) throw new GifError('internal_error');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    const hdrContext = hdr ? createHdrContext(size.width, size.height) : null;
    if (hdr && !hdrContext) throw new GifError('hdr_source_unsupported');
    if (hdrContext) {
      hdrContext.imageSmoothingEnabled = true;
      hdrContext.imageSmoothingQuality = 'high';
    }

    stage = 'captions';
    let layouts: GifTextLayout[] = [];
    if (job.texts.top.trim() || job.texts.bottom.trim()) {
      // The caption typeface, as the page's preview uses it: a fallback font would wrap differently.
      if (!(await loadCaptionFont(scope.fonts, job.origin))) throw new GifError('text_font_unavailable');
      layouts = gifTextLayouts(job.texts, size, gifMeasure(context));
    }
    return { input, track, size, hdr, layouts, canvas, context, hdrContext };
  } catch (error) {
    input.dispose();
    throw error;
  }
}

/**
 * Decodes the moments `timesUs` (one continuous pass) and hands each frame,
 * drawn at the GIF's size with its text, to `onFrame` as RGBA. Returns how many
 * moments the decoder did not deliver (the frame before is held there).
 */
async function drawFrames(
  source: Source,
  timesUs: readonly number[],
  onFrame: (rgba: Uint8Array, index: number) => void | Promise<void>,
): Promise<{ missing: number; drawn: number }> {
  const { track, size, context, hdrContext, layouts } = source;
  const times = timesUs.map((us) => us / US_PER_SECOND);
  const first = times[0] ?? 0;
  const last = times[times.length - 1] ?? first;
  const sink = new VideoSampleSink(track);
  let hold: ReturnType<typeof holdDecoder>;
  try {
    hold = holdDecoder(sink);
  } catch (error) {
    throw tagStage(error, 'configure_decoder');
  }
  let missing = 0;
  let drawn = 0;
  let index = 0;
  try {
    stage = 'decode';
    const usable = () => !hold.decoderClosed();
    for await (const picked of pickFrames(sink.samples(first, last + 0.001), times, GIF_FRAME_US / US_PER_SECOND, usable)) {
      stage = 'draw';
      if (picked.missing) missing += 1;
      try {
        const target = hdrContext ?? context;
        target.fillStyle = '#000000';
        target.fillRect(0, 0, size.width, size.height);
        if (picked.frame) {
          // The picker owns the sample and closes it.
          picked.frame.draw(target, 0, 0, size.width, size.height);
          drawn += 1;
        }
        if (hdrContext) {
          const clipped = softClippedImage(hdrContext, size.width, size.height);
          if (!clipped) throw new GifError('hdr_source_unsupported');
          context.putImageData(clipped, 0, 0);
        }
        drawGifText(context, layouts);
      } catch (error) {
        throw tagStage(error, 'draw');
      }
      stage = 'frame_capture';
      const pixels = context.getImageData(0, 0, size.width, size.height).data;
      const pending = onFrame(new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength), index);
      if (pending) await pending;
      index += 1;
      stage = 'decode';
    }
  } finally {
    hold.release();
  }
  return { missing, drawn };
}

function progressPoster(requestId: string, step: 'frames' | 'encoding', total: number, passes: 1 | 2): (done: number) => void {
  let last = Number.NEGATIVE_INFINITY;
  return (done) => {
    const now = performance.now();
    if (done < total && now - last < PROGRESS_INTERVAL_MS) return;
    last = now;
    post({ type: 'progress', requestId, step, done, total, passes });
  };
}

async function make(request: Extract<GifWorkerRequest, { type: 'make' }>): Promise<void> {
  const startedAt = performance.now();
  const { requestId } = request;
  post({ type: 'progress', requestId, step: 'frames', done: 0, total: 0 });
  // A test's fault breaks the job at its start — or, when it names a frame (`atFrame`), once that many
  // frames of this job were drawn (both passes counted): the worker then fails mid-way, frames in hand.
  const fault = TEST_HOOKS ? (request.testFault ?? null) : null;
  const midway = fault && typeof fault.atFrame === 'number' ? fault : null;
  if (fault && !midway) await applyWorkerFault(fault);
  const source = await open(request);
  try {
    const duration = await source.track.computeDuration().catch(() => request.range.endUs / US_PER_SECOND);
    const range = normalizeGifRange(request.range, Math.round(duration * US_PER_SECOND));
    const times = gifFrameTimesUs(range);
    const total = times.length;
    const { width, height } = source.size;
    // What the device says of its memory (Chromium, rounded to a power of two; this desktop says 32): nothing from Safari and Firefox.
    const deviceMemory = (scope.navigator as WorkerNavigator & { deviceMemory?: unknown }).deviceMemory;
    const budget =
      TEST_HOOKS && typeof request.testHeldFramesBytes === 'number' ? request.testHeldFramesBytes : gifFramesBudget(deviceMemory);
    const hold = gifHoldsFrames(source.size, total, budget);
    const passes = hold ? 1 : 2;
    let drawnInJob = 0;
    const afterFrame = midway
      ? async () => {
          drawnInJob += 1;
          if (drawnInJob === midway.atFrame) await applyWorkerFault(midway);
        }
      : () => undefined;

    // Pass 1: every frame gives its share of the palette's sample; it is held only within the budget.
    const sampler = new GifPaletteSampler(width * height, total);
    const frames: Uint8Array[] = [];
    const frameProgress = progressPoster(requestId, 'frames', total, passes);
    frameProgress(0);
    const first = await drawFrames(source, times, (rgba, index) => {
      sampler.add(rgba);
      // `getImageData` hands out a new buffer for every frame: kept as it is.
      if (hold) frames.push(rgba);
      frameProgress(index + 1);
      return afterFrame();
    });
    if (first.drawn === 0) throw new GifError('no_frames_decoded');
    if (first.missing > missingFramesAllowed(total)) throw new GifError('source_frames_missing');

    stage = 'gif_encode';
    const palette = sampler.palette(source.layouts.length > 0);
    const writer = new GifWriter(width, height, palette);
    const encodeProgress = progressPoster(requestId, 'encoding', total, passes);
    encodeProgress(0);
    let missing = first.missing;
    if (hold) {
      for (let i = 0; i < frames.length; i += 1) {
        writer.add(frames[i] as Uint8Array);
        // Each frame is let go as soon as it is written: memory falls while the GIF grows.
        frames[i] = new Uint8Array(0);
        encodeProgress(i + 1);
      }
    } else {
      // Pass 2: the same moments decoded again; each frame is written the moment it is drawn, then let go.
      const second = await drawFrames(source, times, (rgba, index) => {
        stage = 'gif_encode';
        writer.add(rgba);
        encodeProgress(index + 1);
        return afterFrame();
      });
      if (second.drawn === 0) throw new GifError('no_frames_decoded');
      if (second.missing > missingFramesAllowed(total)) throw new GifError('source_frames_missing');
      missing = Math.max(missing, second.missing);
    }
    stage = 'gif_encode';
    const bytes = writer.finish();
    // `finish` hands out a copy of exactly the file's length: that buffer goes to the page as it is
    // (transferred, not copied once more — at the end of a 20 MB GIF that was one more 20 MB).
    const buffer = (
      bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
        ? bytes.buffer
        : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    ) as ArrayBuffer;
    post(
      {
        type: 'made',
        requestId,
        bytes: buffer,
        width,
        height,
        frames: writer.frameCount,
        framesMissing: missing,
        elapsedMs: Math.round(performance.now() - startedAt),
      },
      [buffer],
    );
  } finally {
    source.input.dispose();
  }
}

/**
 * The estimate: `ESTIMATE_MOMENTS` moments spread over the part,
 * `ESTIMATE_RUN` consecutive frames at each, encoded with one palette made of
 * them. The first frame of a run is what a whole picture costs; each following
 * one is what a later frame costs once the unchanged pixels are left out.
 */
async function estimate(request: Extract<GifWorkerRequest, { type: 'estimate' }>): Promise<void> {
  const { requestId } = request;
  if (TEST_HOOKS) await applyWorkerFault(request.testFault);
  const source = await open(request);
  try {
    const duration = await source.track.computeDuration().catch(() => request.range.endUs / US_PER_SECOND);
    const range = normalizeGifRange(request.range, Math.round(duration * US_PER_SECOND));
    const times = gifFrameTimesUs(range);
    const runs: Uint8Array[][] = [];
    const run = Math.min(ESTIMATE_RUN, times.length);
    const moments = Math.min(ESTIMATE_MOMENTS, Math.max(1, Math.floor(times.length / 2)));
    const starts: number[] = [];
    for (let m = 0; m < moments; m += 1) {
      starts.push(Math.max(0, Math.min(times.length - run, Math.round((m * (times.length - run)) / Math.max(1, moments - 1)))));
    }
    // The cheaper road to those frames: a seek to each moment decodes from the key frame before it, one
    // pass decodes the whole part. Key frames far apart (a video an app saved again, one every 8 s) make
    // the seeks the dearer road: measured on such videos, eight seeks took 6–22 s on this desktop, one pass 2–10.
    const frameS = GIF_FRAME_US / US_PER_SECOND;
    const partS = ((times[times.length - 1] as number) - (times[0] as number)) / US_PER_SECOND + frameS;
    const packets = new EncodedPacketSink(source.track);
    let seekS = 0;
    for (const at of starts) {
      const t = (times[at] as number) / US_PER_SECOND;
      const key = await packets.getKeyPacket(t, { metadataOnly: true }).catch(() => null);
      seekS += (key ? Math.max(0, t - key.timestamp) : t) + run * frameS;
    }
    if (seekS >= partS) {
      const wanted = [...new Set(starts.flatMap((at) => Array.from({ length: run }, (_, k) => at + k)))].sort((a, b) => a - b);
      const byIndex = new Map<number, Uint8Array>();
      await drawFrames(
        source,
        wanted.map((i) => times[i] as number),
        (rgba, k) => {
          byIndex.set(wanted[k] as number, rgba);
        },
      );
      for (const at of starts) {
        const frames = Array.from({ length: run }, (_, k) => byIndex.get(at + k)).filter((frame): frame is Uint8Array => frame !== undefined);
        if (frames.length > 0) runs.push(frames);
      }
    } else {
      for (const at of starts) {
        const frames: Uint8Array[] = [];
        await drawFrames(source, times.slice(at, at + run), (rgba) => {
          frames.push(rgba);
        });
        if (frames.length > 0) runs.push(frames);
      }
    }
    if (runs.length === 0) throw new GifError('no_frames_decoded');
    stage = 'gif_encode';
    const palette = buildGifPalette(runs.flat(), source.layouts.length > 0);
    const firsts: number[] = [];
    const laters: number[] = [];
    for (const frames of runs) {
      const writer = new GifWriter(source.size.width, source.size.height, palette);
      writer.add(frames[0] as Uint8Array);
      let before = writer.byteLength;
      firsts.push(before - (GIF_FIXED_BYTES - 1));
      for (const frame of frames.slice(1)) {
        writer.add(frame);
        laters.push(writer.byteLength - before);
        before = writer.byteLength;
      }
    }
    const mean = (values: number[]) => (values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length);
    const sample: GifSample = { firstFrameBytes: mean(firsts), laterFrameBytes: laters.length > 0 ? mean(laters) : mean(firsts) };
    post({ type: 'estimated', requestId, width: source.size.width, height: source.size.height, frames: times.length, sample });
  } finally {
    source.input.dispose();
  }
}

scope.onmessage = (message: MessageEvent<GifWorkerRequest>) => {
  const request = message.data;
  if (request.type === 'where') {
    // The job stands still somewhere in an `await`; this handler still runs. Nothing was thrown.
    post({ type: 'where', requestId: request.requestId, detail: stalledFailureDetail(stage) });
    return;
  }
  stage = 'unknown';
  const job = request.type === 'make' ? make(request) : estimate(request);
  job.catch((error: unknown) => {
    // Never a raw error message (it can name a file): a planned refusal goes as its code; anything else
    // as its name (if known) and the stage — `caughtFailureDetail`.
    const origin = originOf(error);
    const planned = error instanceof GifError && origin === undefined;
    const cause = origin ?? error;
    // A buffer the browser could not give ("Array buffer allocation failed", "Out of memory at ImageData
    // creation" — the latter was not recognised before 21 Oct 2026): the known sentence is matched, never kept.
    const outOfMemory = !(error instanceof GifError) && failureHint(cause) === 'out_of_memory';
    post({
      type: 'failed',
      requestId: request.requestId,
      reason: error instanceof GifError ? error.reason : outOfMemory ? 'out_of_memory' : 'internal_error',
      ...(planned ? {} : { detail: caughtFailureDetail(cause, stageOf(cause) ?? stage) }),
    });
  });
};
