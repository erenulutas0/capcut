/**
 * Runtime HDR -> SDR check, run inside the export worker (ADR-022).
 *
 * The export turns HDR into SDR by drawing each decoded frame into an sRGB
 * canvas and letting the browser convert it. That conversion is the browser's,
 * not ours, and it is not the same everywhere, so before an HDR source is
 * accepted a synthetic PQ or HLG frame goes through the exact path the export
 * uses (`VideoSample.draw` into a float16 OffscreenCanvas, then the highlight
 * soft clip of hdrCanvas.ts) and the pixels that come back are judged
 * (`judgeHdrProbe`). A browser that does not really tone map
 * gets a clear refusal instead of a file with wrong colours.
 */

import { VideoSample } from 'mediabunny';

import {
  buildProbeFrame,
  judgeHdrProbe,
  readProbePatches,
  type HdrTransfer,
  type ProbeVerdict,
} from '@/domain/hdr';
import { createHdrContext, softClippedImage } from './hdrCanvas';

export type HdrToneMapStatus = 'verified' | 'failed' | 'api_missing';

export interface HdrProbeResult {
  status: HdrToneMapStatus;
  /** Why it failed (stable codes from `judgeHdrProbe`), or the missing API. */
  failures: string[];
  patches: ProbeVerdict['patches'] | null;
}

/** The WebCodecs colour names the DOM typings in this TypeScript do not list yet. */
const COLOR_SPACE: Record<HdrTransfer, unknown> = {
  pq: { primaries: 'bt2020', transfer: 'pq', matrix: 'bt2020-ncl', fullRange: false },
  hlg: { primaries: 'bt2020', transfer: 'hlg', matrix: 'bt2020-ncl', fullRange: false },
};

export async function probeHdrToneMapping(transfer: HdrTransfer): Promise<HdrProbeResult> {
  if (typeof VideoFrame !== 'function' || typeof OffscreenCanvas !== 'function') {
    return { status: 'api_missing', failures: ['api:VideoFrame'], patches: null };
  }
  const frame = buildProbeFrame(transfer);

  let videoFrame: VideoFrame;
  try {
    videoFrame = new VideoFrame(frame.data, {
      format: 'I420P10',
      codedWidth: frame.width,
      codedHeight: frame.height,
      timestamp: 0,
      colorSpace: COLOR_SPACE[transfer],
    } as unknown as VideoFrameBufferInit);
  } catch {
    // No 10-bit VideoFrame here: nothing proves the conversion, so no.
    return { status: 'api_missing', failures: ['api:I420P10'], patches: null };
  }

  const colorSpace = videoFrame.colorSpace as unknown as { transfer?: string | null; primaries?: string | null };
  if (colorSpace.transfer !== transfer || colorSpace.primaries !== 'bt2020') {
    // The browser dropped the HDR signalling from the frame; drawing it would
    // test an SDR conversion, not ours.
    videoFrame.close();
    return { status: 'api_missing', failures: ['api:colorSpace'], patches: null };
  }

  const sample = new VideoSample(videoFrame);
  try {
    const context = createHdrContext(frame.width, frame.height);
    if (!context) return { status: 'api_missing', failures: ['api:float16-canvas'], patches: null };
    // The same calls the export makes for every HDR frame.
    sample.draw(context, 0, 0);
    const image = softClippedImage(context, frame.width, frame.height);
    if (!image) return { status: 'api_missing', failures: ['api:float16-readback'], patches: null };
    const verdict = judgeHdrProbe(readProbePatches(image.data, frame.width));
    return {
      status: verdict.pass ? 'verified' : 'failed',
      failures: verdict.failures,
      patches: verdict.patches,
    };
  } finally {
    sample.close();
  }
}
