/// <reference lib="webworker" />

/**
 * Looking at the video before "İyileştir" touches it (ADR-037).
 *
 * Frames spread over the whole download are decoded, drawn exactly as the
 * export draws them (same crop, same frame size, the same HDR path) and
 * measured (`measureFrame`). The plan made from them (`planEnhancement`)
 * holds for every frame of the export, which is what keeps the correction
 * from flickering: no frame is corrected by its own histogram alone.
 *
 * Nothing here encodes or writes anything.
 */

import { VideoSampleSink, type InputVideoTrack, type VideoSample } from 'mediabunny';

import {
  REFINE_BUDGET,
  analysisFrames,
  frameToRefine,
  measureFrame,
  type AnalysisPoint,
  type PictureRect,
} from '@/domain/enhance';
import { segmentDrawRect, sourceTimeForFrame, type RenderPlan, type RenderSegment } from '@/domain/renderPlan';
import { holdDecoder } from './decoderHold';
import { pickFrames } from './framePicker';
import { createHdrContext, softClippedImage } from './hdrCanvas';

/**
 * The whole pixels a moment's picture covers (`outer`, what is enhanced) and
 * the ones it covers fully (`inner`, what is measured: a half-covered edge
 * pixel is part bar, part picture).
 */
export function pictureRects(
  segment: Pick<RenderSegment, 'crop' | 'fit'>,
  plan: Pick<RenderPlan, 'width' | 'height'>,
): { outer: PictureRect; inner: PictureRect } {
  const rect = segmentDrawRect(segment, plan);
  const left = Math.max(0, Math.floor(rect.x));
  const top = Math.max(0, Math.floor(rect.y));
  const right = Math.min(plan.width, Math.ceil(rect.x + rect.width));
  const bottom = Math.min(plan.height, Math.ceil(rect.y + rect.height));
  const innerLeft = Math.min(plan.width - 1, Math.ceil(rect.x));
  const innerTop = Math.min(plan.height - 1, Math.ceil(rect.y));
  const innerRight = Math.max(innerLeft + 1, Math.min(plan.width, Math.floor(rect.x + rect.width)));
  const innerBottom = Math.max(innerTop + 1, Math.min(plan.height, Math.floor(rect.y + rect.height)));
  return {
    outer: { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) },
    inner: { x: innerLeft, y: innerTop, width: innerRight - innerLeft, height: innerBottom - innerTop },
  };
}

/** Draws a moment's frame the way the export does (set by the worker: it owns the drawing). */
export type DrawSegmentFrame = (
  context: OffscreenCanvasRenderingContext2D,
  sample: VideoSample,
  segment: RenderSegment,
  plan: RenderPlan,
) => void;

/**
 * Identifies what an analysis was made of: the frame size, every moment's
 * source range, crop and place on the output grid. Not the strength: the same
 * measurements serve all three.
 */
export function analysisKey(plan: RenderPlan, file: { name: string; size: number; lastModified: number }): string {
  const parts = [
    file.name,
    file.size,
    file.lastModified,
    plan.width,
    plan.height,
    plan.fpsNum,
    plan.fpsDen,
    ...plan.segments.flatMap((segment) => [
      segment.startFrame,
      segment.endFrame,
      segment.sourceInUs,
      segment.sourceOutUs,
      segment.crop.x,
      segment.crop.y,
      segment.crop.width,
      segment.crop.height,
      segment.fit,
    ]),
  ];
  return parts.join('|');
}

export interface AnalysisResult {
  key: string;
  /** Sorted by frame. */
  points: AnalysisPoint[];
  /** How many frames were asked for; fewer points means the decoder did not deliver some. */
  requested: number;
  /** Frames looked at in addition, to find where the light changes. */
  refined: number;
}

interface AnalyseOptions {
  plan: RenderPlan;
  track: InputVideoTrack;
  key: string;
  hdr: boolean;
  draw: DrawSegmentFrame;
  checkCanceled: () => void;
  /** Share of the frames looked at so far, 0..1. */
  onProgress: (share: number) => void;
}

/** Null: this browser cannot read the frames back (no canvas, or no float canvas for an HDR source). */
export async function analyseForEnhance(options: AnalyseOptions): Promise<AnalysisResult | null> {
  const { plan, track, hdr, draw, checkCanceled, onProgress } = options;
  const fps = plan.fpsNum / plan.fpsDen;
  const wanted = analysisFrames(plan.segments, fps);
  const { width, height } = plan;

  // A canvas that is read back after every draw: kept in memory, not on the GPU.
  const context = hdr
    ? createHdrContext(width, height)
    : new OffscreenCanvas(width, height).getContext('2d', { alpha: false, willReadFrequently: true });
  if (!context) return null;

  const points: AnalysisPoint[] = [];
  let reuse: ImageData | null = null;
  let done = 0;
  const sink = new VideoSampleSink(track);

  const measure = (sample: VideoSample, segment: RenderSegment, frame: number): boolean => {
    context.fillStyle = plan.background;
    context.fillRect(0, 0, width, height);
    draw(context, sample, segment, plan);
    let image: ImageData | null;
    if (hdr) {
      image = softClippedImage(context, width, height, reuse);
      reuse = image;
    } else {
      image = context.getImageData(0, 0, width, height);
    }
    if (!image) return false;
    points.push({ frame, stats: measureFrame(image.data, width, height, pictureRects(segment, plan).inner) });
    return true;
  };

  for (const segment of plan.segments) {
    const frames = wanted.filter((frame) => frame >= segment.startFrame && frame < segment.endFrame);
    if (frames.length === 0) continue;
    const times = frames.map((frame) => sourceTimeForFrame(segment, frame, plan.fpsNum, plan.fpsDen));
    const before = points.length;

    // Seek to each frame: a long video is not decoded twice for this.
    let index = 0;
    for await (const sample of sink.samplesAtTimestamps(times)) {
      checkCanceled();
      const frame = frames[index];
      index += 1;
      done += 1;
      if (sample) {
        try {
          if (frame !== undefined && !measure(sample, segment, frame)) return null;
        } finally {
          sample.close();
        }
      }
      onProgress(done / wanted.length);
    }

    // A decoder that did not deliver most of them when seeking (framePicker.ts
    // says when that happens) gets one continuous pass over the moment instead.
    if (points.length - before < frames.length / 2) {
      points.length = before;
      const first = times[0] ?? 0;
      const last = times[times.length - 1] ?? first;
      let at = 0;
      // One pass like the export's own, decoder held until its last frame is drawn (ADR-033).
      const passSink = new VideoSampleSink(track);
      const hold = holdDecoder(passSink);
      try {
        const usable = () => !hold.decoderClosed();
        for await (const picked of pickFrames(passSink.samples(first, last + 0.001), times, plan.fpsDen / plan.fpsNum, usable)) {
          checkCanceled();
          const frame = frames[at];
          at += 1;
          // The picker owns the frame and closes it.
          if (picked.frame && !picked.missing && frame !== undefined && !measure(picked.frame, segment, frame)) return null;
        }
      } finally {
        hold.release();
      }
    }
  }

  // Where neighbouring analysed frames would be corrected differently, look in between
  // (`frameToRefine`): a sudden change is narrowed down to the two frames it happens between.
  points.sort((a, b) => a.frame - b.frame);
  const failed = new Set<number>();
  let refined = 0;
  while (refined < REFINE_BUDGET) {
    const frame = frameToRefine(points, failed);
    if (frame === null) break;
    checkCanceled();
    const segment = plan.segments.find((item) => frame >= item.startFrame && frame < item.endFrame);
    const before = points.length;
    if (segment) {
      const time = sourceTimeForFrame(segment, frame, plan.fpsNum, plan.fpsDen);
      for await (const sample of sink.samplesAtTimestamps([time])) {
        if (!sample) continue;
        try {
          if (!measure(sample, segment, frame)) return null;
        } finally {
          sample.close();
        }
      }
    }
    if (points.length === before) failed.add(frame);
    else points.sort((a, b) => a.frame - b.frame);
    refined += 1;
  }

  return { key: options.key, points, requested: wanted.length, refined };
}
