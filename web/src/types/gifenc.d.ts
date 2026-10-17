/**
 * Types for `gifenc` 1.0.3 (MIT, Matt DesLauriers; no types of its own), for
 * the parts "GIF yap" uses (ADR-046). Written from the package's source.
 */
declare module 'gifenc' {
  export type GifencColor = [number, number, number] | [number, number, number, number];

  export interface GifencFrameOptions {
    /** The colour table: the global one on the first frame, else a local one. */
    palette?: GifencColor[] | null;
    /** Milliseconds; written as hundredths (rounded). */
    delay?: number;
    /** -1 once, 0 for ever, > 0 that many times. Written with the first frame. */
    repeat?: number;
    transparent?: boolean;
    transparentIndex?: number;
    /** Disposal method (0–7); -1: "none" (or "restore to background" when transparent). */
    dispose?: number;
    colorDepth?: number;
    /** Manual mode only: this frame writes the logical screen and the global colour table. */
    first?: boolean;
  }

  export interface GifencEncoder {
    reset(): void;
    finish(): void;
    bytes(): Uint8Array;
    bytesView(): Uint8Array;
    writeHeader(): void;
    writeFrame(index: Uint8Array, width: number, height: number, options?: GifencFrameOptions): void;
  }

  export function GIFEncoder(options?: { initialCapacity?: number; auto?: boolean }): GifencEncoder;

  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: { format?: 'rgb565' | 'rgb444' | 'rgba4444'; oneBitAlpha?: boolean | number; clearAlpha?: boolean },
  ): GifencColor[];
}
