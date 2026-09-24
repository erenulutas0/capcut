/// <reference lib="webworker" />

/**
 * The HDR soft clip off the encode worker's thread (ADR-028).
 *
 * Per 1080p HDR frame the encode worker spent ~12 ms reading the float16
 * canvas back and ~17 ms clipping it, one after the other, while the video
 * encoder mostly waited. The clip of frame N now runs on a helper thread
 * while the worker draws and reads back frame N+1; frames still reach the
 * encoder strictly in order (the caller awaits them first in, first out).
 *
 * The helper runs `softClipHalfToRgba8`, the same function the runtime check
 * and the in-thread path run, so the output is byte for byte the same. If the
 * helper cannot be started, or the read-back is not float16, the clip runs in
 * this thread as before: slower, never different.
 */

import { softClipHalfToRgba8 } from '@/domain/hdr';

import { clipHdrPixels, type HdrReadback } from './hdrCanvas';

/**
 * The helper is a second instance of the encode worker's own script, started
 * under this name: a separate worker entry would need the bundler to follow
 * a worker created inside a worker, which the app's bundler does not do
 * (measured: the file was copied unbundled). Loading the script it is
 * already running from works with any bundler.
 */
export const HDR_CLIP_WORKER_NAME = 'clip-hdr';

/** In the helper instance: answer clip requests, nothing else. */
export function serveHdrClips(scope: DedicatedWorkerGlobalScope): void {
  scope.onmessage = (message: MessageEvent<HdrClipRequest>) => {
    const { id, half, offset, length, out } = message.data;
    let response: HdrClipResponse;
    try {
      softClipHalfToRgba8(new Uint16Array(half, offset, length), new Uint8ClampedArray(out));
      response = { id, out };
    } catch {
      response = { id, out, failed: true };
    }
    scope.postMessage(response, [out]);
  };
}

export interface HdrClipRequest {
  id: number;
  /** The read-back's buffer (transferred) and the bits' place in it. */
  half: ArrayBuffer;
  offset: number;
  length: number;
  /** The 8-bit RGBA target (transferred there and back). */
  out: ArrayBuffer;
}

export interface HdrClipResponse {
  id: number;
  out: ArrayBuffer;
  failed?: true;
}

/** Frames whose clip may be running at once: one in the helper, one being read. */
export const HDR_PIPELINE_DEPTH = 2;

export class HdrClipper {
  private worker: Worker | null = null;
  private nextId = 0;
  private readonly waiting = new Map<number, { resolve: (out: Uint8ClampedArray) => void; reject: (error: Error) => void }>();
  private readonly spare: ArrayBuffer[] = [];
  private broken = false;

  constructor(
    private readonly byteLength: number,
    createWorker: () => Worker = () => new Worker(self.location.href, { name: HDR_CLIP_WORKER_NAME }),
  ) {
    try {
      this.worker = createWorker();
      this.worker.onmessage = (message: MessageEvent<HdrClipResponse>) => this.settle(message.data);
      this.worker.onerror = () => this.fail(new Error('hdr_clip_worker_failed'));
    } catch {
      this.worker = null;
    }
  }

  /** True while a helper thread does the clipping. */
  get threaded(): boolean {
    return this.worker !== null && !this.broken;
  }

  /**
   * Proves the helper runs before any frame depends on it: one known pixel
   * must come back right within `timeoutMs`. Otherwise the helper is dropped
   * and every clip runs in this thread.
   */
  async ready(timeoutMs = 5000): Promise<boolean> {
    const worker = this.worker;
    if (!worker || this.broken) return false;
    const id = (this.nextId += 1);
    // Half 0.5 in every channel: under the knee, 0.5 × 255 rounds to 128.
    const half = new Uint16Array([0x3800, 0x3800, 0x3800, 0x3c00]);
    const request: HdrClipRequest = { id, half: half.buffer, offset: 0, length: 4, out: new ArrayBuffer(4) };
    const answer = new Promise<Uint8ClampedArray>((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      worker.postMessage(request, [request.half, request.out]);
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
    });
    const pixel = await Promise.race([answer.catch(() => null), timeout]);
    clearTimeout(timer);
    const ok = pixel !== null && pixel[0] === 128 && pixel[1] === 128 && pixel[2] === 128 && pixel[3] === 255;
    if (!ok) {
      this.waiting.delete(id);
      this.broken = true;
      worker.terminate();
      this.worker = null;
    }
    return ok;
  }

  /**
   * The 8-bit picture of a read-back. A half-float read-back's buffer is
   * handed over (it must not be used afterwards). Resolves in the order the
   * frames were given only if awaited in that order, which the caller does.
   */
  clip(pixels: HdrReadback): Promise<Uint8ClampedArray> {
    const out = this.spare.pop() ?? new ArrayBuffer(this.byteLength);
    if (pixels.kind !== 'half' || !this.threaded || !this.worker) {
      const target = new Uint8ClampedArray(out);
      clipHdrPixels(pixels, target);
      return Promise.resolve(target);
    }
    const id = (this.nextId += 1);
    const { bits } = pixels;
    const request: HdrClipRequest = {
      id,
      half: bits.buffer as ArrayBuffer,
      offset: bits.byteOffset,
      length: bits.length,
      out,
    };
    return new Promise<Uint8ClampedArray>((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.worker!.postMessage(request, [request.half, request.out]);
    });
  }

  /** Gives a finished picture's buffer back for the next frame. */
  recycle(picture: Uint8ClampedArray): void {
    if (picture.buffer.byteLength === this.byteLength && this.spare.length < HDR_PIPELINE_DEPTH + 1) {
      this.spare.push(picture.buffer as ArrayBuffer);
    }
  }

  close(): void {
    this.fail(new Error('hdr_clip_closed'));
    this.worker?.terminate();
    this.worker = null;
    this.spare.length = 0;
  }

  private settle(response: HdrClipResponse): void {
    const entry = this.waiting.get(response.id);
    if (!entry) return;
    this.waiting.delete(response.id);
    if (response.failed) entry.reject(new Error('hdr_clip_failed'));
    else entry.resolve(new Uint8ClampedArray(response.out));
  }

  private fail(error: Error): void {
    this.broken = true;
    for (const entry of this.waiting.values()) entry.reject(error);
    this.waiting.clear();
  }
}
