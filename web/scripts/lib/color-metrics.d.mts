/** Types for color-metrics.mjs (used by the unit tests). */
export function srgbToLinear(code: number): number;
export function srgbToLab(r: number, g: number, b: number): [number, number, number];
export function deltaE2000(lab1: readonly number[], lab2: readonly number[]): number;
export interface RgbComparison {
  meanDeltaE00: number;
  p95DeltaE00: number;
  meanDeltaL: number;
  meanDeltaA: number;
  meanDeltaB: number;
  cast: number;
  chromaRatio: number;
  saturationRatio: number;
  vividSaturationRatio: number;
  hueError: number;
  clipDelta: number;
}
export function compareRgb(reference: Uint8Array, output: Uint8Array): RgbComparison;
export function meanLuma(rgb: Uint8Array): number;
