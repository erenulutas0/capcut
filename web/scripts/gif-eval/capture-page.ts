/**
 * GIF quality, round 2 (ADR-046 addendum 2): the frames the BROWSER draws.
 *
 * Bundled by `round2.mjs` and run in a local page (http://localhost, the
 * driver's own server; nothing leaves the machine). It decodes a part of a
 * video the GIF worker's way — mediabunny `VideoSampleSink` in one pass,
 * `pickFrames` at the GIF's frame times, the decoder held open
 * (`holdDecoder`), `VideoSample.draw` — and, from each decoded frame, draws
 * every requested size with every requested downscaling candidate. Each
 * result is posted as raw RGBA to the driver, which writes it under
 * `web/.scratch/` (gitignored). Never imported by the app.
 */

import { ALL_FORMATS, BlobSource, Input, VideoSampleSink } from 'mediabunny';

import { holdDecoder } from '@/adapters/export/decoderHold';
import { pickFrames } from '@/adapters/export/framePicker';
import { GIF_FRAME_US, gifFrameTimesUs, normalizeGifRange } from '@/domain/gif';
import { US_PER_SECOND } from '@/domain/time';
import { areaDownscale } from './resample';

export type Variant = 'high' | 'medium' | 'low' | 'mip' | 'mip2' | 'box';

export interface CaptureJob {
  /** Where the page fetches the video (the driver's server). */
  url: string;
  startS: number;
  seconds: number;
  /** Long edges; each is planned like `planGifSize` (never larger than the video). */
  longEdges: number[];
  /** Candidates per long edge (same list for all when one list). */
  variants: Variant[];
  /** Variants only for long edges ≤ this (bigger sizes get `bigVariants`). */
  smallUpTo?: number;
  bigVariants?: Variant[];
  /** Also post the frame at the video's own size (1:1): the phone-view reference. */
  full: boolean;
  /** File name prefix for the posts. */
  name: string;
}

export interface CaptureResult {
  display: { width: number; height: number };
  frames: number;
  missing: number;
  /** Per "<long edge>-<variant>": the size drawn and the drawing time, ms per frame (draw + read + resample). */
  outputs: Record<string, { width: number; height: number; msPerFrame: number[] }>;
  fullMsPerFrame: number[];
}

function plan(w: number, h: number, longEdge: number): { width: number; height: number } {
  const scale = Math.min(1, longEdge / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

function context(width: number, height: number, quality: ImageSmoothingQuality): OffscreenCanvasRenderingContext2D {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  if (!ctx) throw new Error('no 2d context');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = quality;
  return ctx;
}

async function put(name: string, data: Uint8ClampedArray): Promise<void> {
  const response = await fetch(`/put?file=${encodeURIComponent(name)}`, { method: 'POST', body: data as unknown as BodyInit });
  if (!response.ok) throw new Error(`put ${name}: ${response.status}`);
}

interface Drawable {
  displayWidth: number;
  displayHeight: number;
  draw(ctx: OffscreenCanvasRenderingContext2D, dx: number, dy: number, dw: number, dh: number): void;
  close(): void;
}

async function capture(job: CaptureJob): Promise<CaptureResult> {
  const blob = await (await fetch(job.url)).blob();
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('no video track');
    if (!(await track.canDecode())) throw new Error('cannot decode');
    const dw = await track.getDisplayWidth();
    const dh = await track.getDisplayHeight();
    const duration = await track.computeDuration();
    const range = normalizeGifRange(
      { startUs: Math.round(job.startS * US_PER_SECOND), endUs: Math.round((job.startS + job.seconds) * US_PER_SECOND) },
      Math.round(duration * US_PER_SECOND),
    );
    const times = gifFrameTimesUs(range).map((us) => us / US_PER_SECOND);

    // Every (size, variant) its own canvas, made once.
    interface Out {
      key: string;
      longEdge: number;
      variant: Variant;
      width: number;
      height: number;
      ctx: OffscreenCanvasRenderingContext2D;
      mip?: { ctx: OffscreenCanvasRenderingContext2D; levels: number };
      ms: number[];
    }
    const outs: Out[] = [];
    for (const longEdge of job.longEdges) {
      const { width, height } = plan(dw, dh, longEdge);
      const variants = job.smallUpTo !== undefined && longEdge > job.smallUpTo ? (job.bigVariants ?? job.variants) : job.variants;
      for (const variant of variants) {
        const quality: ImageSmoothingQuality = variant === 'medium' ? 'medium' : variant === 'low' ? 'low' : 'high';
        const out: Out = { key: `${longEdge}-${variant}`, longEdge, variant, width, height, ctx: context(width, height, quality), ms: [] };
        if (variant === 'mip' || variant === 'mip2') {
          let levels = 0;
          if (variant === 'mip2') levels = 2 * width <= dw && 2 * height <= dh ? 1 : 0;
          else if (2 * width < dw && 2 * height < dh) levels = Math.floor(Math.log2(Math.min(dw / width, dh / height)));
          if (levels > 0) {
            const mctx = context(width * 2 ** levels, height * 2 ** levels, 'high');
            out.mip = { ctx: mctx, levels };
            // The halving steps: bilinear at exactly one half is the 2 × 2 average.
            out.ctx.imageSmoothingQuality = 'low';
          }
        }
        outs.push(out);
      }
    }
    const needFull = job.full || outs.some((o) => o.variant === 'box');
    const fullCtx = needFull ? context(dw, dh, 'high') : null;
    const fullMs: number[] = [];

    const sink = new VideoSampleSink(track);
    const hold = holdDecoder(sink);
    let missing = 0;
    let frames = 0;
    try {
      const usable = () => !hold.decoderClosed();
      const first = times[0] ?? 0;
      const last = times[times.length - 1] ?? first;
      for await (const picked of pickFrames(sink.samples(first, last + 0.001), times, GIF_FRAME_US / US_PER_SECOND, usable)) {
        if (picked.missing) missing += 1;
        const sample = picked.frame as unknown as Drawable | null;
        const posts: Promise<void>[] = [];
        let full: Uint8ClampedArray | null = null;
        let fullTime = 0;
        if (fullCtx) {
          const t0 = performance.now();
          fullCtx.fillStyle = '#000000';
          fullCtx.fillRect(0, 0, dw, dh);
          sample?.draw(fullCtx, 0, 0, dw, dh);
          full = fullCtx.getImageData(0, 0, dw, dh).data;
          fullTime = performance.now() - t0;
          fullMs.push(fullTime);
          if (job.full) posts.push(put(`${job.name}-full`, full));
        }
        for (const out of outs) {
          const t0 = performance.now();
          let data: Uint8ClampedArray;
          if (out.variant === 'box') {
            data = areaDownscale(full as Uint8ClampedArray, dw, dh, out.width, out.height);
            out.ms.push(performance.now() - t0 + fullTime);
          } else {
            const { ctx, width, height } = out;
            if (out.mip) {
              const m = out.mip.ctx;
              const mw = width * 2 ** out.mip.levels;
              const mh = height * 2 ** out.mip.levels;
              m.globalCompositeOperation = 'source-over';
              m.imageSmoothingQuality = 'high';
              m.fillStyle = '#000000';
              m.fillRect(0, 0, mw, mh);
              sample?.draw(m, 0, 0, mw, mh);
              m.globalCompositeOperation = 'copy';
              m.imageSmoothingQuality = 'low';
              for (let i = out.mip.levels; i > 1; i -= 1) {
                const lw = width * 2 ** i;
                const lh = height * 2 ** i;
                m.drawImage(m.canvas, 0, 0, lw, lh, 0, 0, lw / 2, lh / 2);
              }
              ctx.globalCompositeOperation = 'copy';
              ctx.drawImage(m.canvas, 0, 0, 2 * width, 2 * height, 0, 0, width, height);
              ctx.globalCompositeOperation = 'source-over';
            } else {
              ctx.fillStyle = '#000000';
              ctx.fillRect(0, 0, width, height);
              sample?.draw(ctx, 0, 0, width, height);
            }
            data = ctx.getImageData(0, 0, width, height).data;
            out.ms.push(performance.now() - t0);
          }
          posts.push(put(`${job.name}-${out.key}`, data));
        }
        await Promise.all(posts);
        frames += 1;
      }
    } finally {
      hold.release();
    }
    const outputs: CaptureResult['outputs'] = {};
    for (const o of outs) outputs[o.key] = { width: o.width, height: o.height, msPerFrame: o.ms };
    return { display: { width: dw, height: dh }, frames, missing, outputs, fullMsPerFrame: fullMs };
  } finally {
    input.dispose();
  }
}

(globalThis as unknown as { capture: typeof capture }).capture = capture;
