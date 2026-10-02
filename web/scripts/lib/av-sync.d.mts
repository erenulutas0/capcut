/** Types for av-sync.mjs (used by the unit tests). */
export declare const SYNC_FPS: number;
export declare const SYNC_RATE: number;
export declare const SYNC_SECONDS: number;
export declare const SEEK_SAFE_S: number;
export function syncEventFrames(fps?: number): number[];
export declare const EDGE_FRAMES: number;
export function expectedSourceFrames(
  kesits: [number, number][],
  options?: { sourceFps?: number; outputFps?: number; seconds?: number },
): { kesit: number; frames: number[] }[];
export interface FrameIdentity {
  frames: number;
  expectedFrames: number;
  wrong: number;
  byKesit: { kesit: number; frames: number; wrong: number; wrongAtStart: number; wrongInMiddle: number; wrongAtEnd: number }[];
  firstWrong: { outputFrame: number; kesit: number; shows: number | null; expected: number }[];
  lastWrong: { outputFrame: number; kesit: number; shows: number | null; expected: number }[];
}
export function compareFrameIdentity(
  shown: number[],
  expectedByKesit: { kesit: number; frames: number[] }[],
): FrameIdentity;
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
