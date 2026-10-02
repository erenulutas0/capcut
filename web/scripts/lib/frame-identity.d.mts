/** Types for frame-identity.mjs (used by the unit tests). */
export declare const WINDOW_S: number;
export declare const EDGE_FRAMES: number;
export declare const FLAT_STD: number;
export function contrast(pixels: ArrayLike<number>): number;
export function normalise(pixels: ArrayLike<number>): Float32Array;
export function distance(a: Float32Array, b: Float32Array): number;
export interface ExpectedFrame {
  kesit: number;
  k: number;
  count: number;
  t: number;
  index: number;
}
export function expectedFromSource(sourceTimes: number[], trims: [number, number][], fps?: number): ExpectedFrame[];
export interface SourceFrame {
  time: number;
  frame: Float32Array;
  contrast: number;
}
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
export interface WrongFrame {
  outputFrame: number;
  kesit: number;
  sourceOffset: number;
  looksLikeMs: number;
}
export interface ReferenceIdentity {
  frames: number;
  expectedFrames: number;
  noise: number;
  wrong: number;
  unmatched: number;
  undecidable: number;
  byKesit: KesitIdentity[];
  firstWrong: WrongFrame[];
  lastWrong: WrongFrame[];
}
export function matchFrames(
  out: Float32Array[],
  source: SourceFrame[],
  expected: ExpectedFrame[],
  options?: { windowS?: number },
): ReferenceIdentity;
