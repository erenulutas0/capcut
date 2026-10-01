/** Types for av-sync.mjs (used by the unit tests). */
export const SYNC_FPS: number;
export const SYNC_RATE: number;
export const SYNC_SECONDS: number;
export const SEEK_SAFE_S: number;
export function syncEventFrames(): number[];
export function onsets(pcm: Float32Array, rate?: number): number[];
export function onFileTimeline(
  decoded: Float32Array,
  streamStartS: number,
  startS: number,
  seconds?: number | null,
  rate?: number,
): Float32Array;
export interface FlashPairing {
  flashes: number;
  onsets: number;
  paired: number;
  medianMs: number | null;
  minMs: number | null;
  maxMs: number | null;
}
export function pairFlashes(flashes: number[], heard: number[]): FlashPairing;
export interface SoundEditList {
  at: number;
  bytes: 4 | 8;
  mediaTime: number;
}
export function soundEditList(bytes: Uint8Array): SoundEditList | null;
export function withSoundMediaTime(bytes: Uint8Array, mediaTime: number): Uint8Array | null;
