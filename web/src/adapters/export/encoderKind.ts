/**
 * Which H.264 encoder this browser has for a frame size (ADR-024, ADR-035).
 *
 * The browser never says which encoder `no-preference` picks, but it does say
 * whether a hardware one exists; without one it is the software encoder
 * (measured: Playwright's Chromium reports none, and its files match Chrome's
 * own `prefer-software` output class, ADR-024).
 *
 * Runs on the page and in the export worker alike (WebCodecs is in both), so
 * the size shown before a target-size download and the size the worker plans
 * come from the same answer.
 */

import { outputPixelSize, type AspectRatio } from '@/domain/edl';
import type { VideoEncoderKind } from '@/domain/encoderBitrate';
import { TARGET_SHORT_EDGES } from '@/domain/targetSize';

export async function videoEncoderKindFor(
  width: number,
  height: number,
  fps: number,
  bitrate: number,
): Promise<VideoEncoderKind> {
  try {
    if (typeof VideoEncoder !== 'function') return 'hardware';
    // The same question, asked the same way, as the export itself (mediabunny
    // builds the codec string for the size); loaded on demand on the page.
    const { canEncodeVideo } = await import('mediabunny');
    const hardware = await canEncodeVideo('avc', {
      width,
      height,
      bitrate,
      frameRate: fps,
      hardwareAcceleration: 'prefer-hardware',
    });
    return hardware ? 'hardware' : 'software';
  } catch {
    // Unknown: keep the plan's bitrate, as before.
    return 'hardware';
  }
}

export type EncoderKindLookup = (width: number, height: number) => VideoEncoderKind;

const tables = new Map<string, Promise<EncoderKindLookup>>();

/**
 * The encoder kind at every size the target-size planner may pick for this
 * frame shape, asked once per shape and frame rate. A size that was not asked
 * answers `hardware` (the plan's own bitrate), like an unknown encoder.
 */
export function encoderKindLookup(aspect: AspectRatio, fpsNum: number, fpsDen: number): Promise<EncoderKindLookup> {
  const key = `${aspect}|${fpsNum}/${fpsDen}`;
  let table = tables.get(key);
  if (!table) {
    table = (async () => {
      const kinds = new Map<string, VideoEncoderKind>();
      const fps = fpsNum / fpsDen;
      for (const shortEdge of TARGET_SHORT_EDGES) {
        const { width, height } = outputPixelSize(aspect, shortEdge);
        // A mid-range bitrate: the answer does not depend on it in practice.
        kinds.set(`${width}x${height}`, await videoEncoderKindFor(width, height, fps, Math.round(width * height * fps * 0.09)));
      }
      return (width: number, height: number) => kinds.get(`${width}x${height}`) ?? 'hardware';
    })();
    tables.set(key, table);
  }
  return table;
}
