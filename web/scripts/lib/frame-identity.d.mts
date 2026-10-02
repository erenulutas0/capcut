/** Types for frame-identity.mjs (used by the unit tests). */
export declare const MATCH_WINDOW: number;
export declare const EDGE_FRAMES: number;
export function normalise(pixels: ArrayLike<number>): Float32Array;
export function distance(a: Float32Array, b: Float32Array): number;
export function kesitFrameCounts(trims: [number, number][], fps?: number): number[];
export interface KesitIdentity {
  kesit: number;
  frames: number;
  wrong: number;
  wrongAtStart: number;
  wrongInMiddle: number;
  wrongAtEnd: number;
  undecidable: number;
  unmatched: number;
}
export interface ReferenceIdentity {
  frames: number;
  expectedFrames: number;
  referenceFrames: number;
  noise: number;
  wrong: number;
  undecidable: number;
  byKesit: KesitIdentity[];
  firstWrong: { outputFrame: number; kesit: number; looksLike: number }[];
  lastWrong: { outputFrame: number; kesit: number; looksLike: number }[];
}
export function matchFrames(
  out: Float32Array[],
  ref: Float32Array[],
  counts: number[],
  options?: { window?: number },
): ReferenceIdentity;
