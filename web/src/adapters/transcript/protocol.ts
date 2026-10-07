/**
 * Message contract between the page and the transcript worker (ADR-036).
 *
 * The user's `File` travels by structured clone and is read inside the
 * worker (mediabunny `BlobSource`): the sound is decoded and turned into
 * text there, on this device. What comes back is text with times and the
 * real counts of the work done — never a made-up percentage.
 */

import type { TranscriptSegment } from '@/domain/transcript';
import type { ModelManifest, TranscriptModelId } from '@/domain/transcriptModels';
import type { EngineProbe, EngineSettings } from '@/domain/transcriptSettings';
import type { DownloadFailure } from './modelStore';

/**
 * Test builds only (`CLIP_TEST_HOOKS=1`, never the published site): a tiny
 * manifest served by the test, and a scripted stand-in for the recogniser.
 * In an ordinary build the worker ignores this field entirely.
 */
export interface TranscriptTestOptions {
  manifest?: ModelManifest;
  stub?: StubScript;
  /**
   * Says whether "this browser can run the large model" instead of asking
   * the graphics card: the test machines have none, and the choice between
   * the two models must be testable both ways.
   */
  largeModel?: boolean;
}

/** What the stand-in engine "hears": fixed segments, posted one by one. */
export interface StubScript {
  segments: TranscriptSegment[];
  /** Pause between segments, so progress can be seen and a run cancelled. */
  stepMs?: number;
  /** Fail instead, after the first segment. */
  failWith?: TranscribeFailure;
}

export type TranscribeFailure =
  /** The video has no sound track. */
  | 'no_audio'
  | 'undecodable'
  | 'unreadable'
  /** The model files are not (all) in this browser: download first. */
  | 'model_missing'
  /** The browser could not start the model (no WebAssembly, no WebGPU for the large model). */
  | 'engine_unavailable'
  | 'out_of_memory'
  | 'internal_error';

export type TranscriptWorkerRequest =
  | { type: 'download'; requestId: string; model: TranscriptModelId; test?: TranscriptTestOptions }
  | {
      type: 'transcribe';
      requestId: string;
      model: TranscriptModelId;
      file: File;
      test?: TranscriptTestOptions;
      /** Measuring scripts only (see `transcriptClient.ts`); absent in normal use. */
      probe?: EngineProbe;
    };

export type TranscribeProgress =
  /** The model is being started (read from this browser's storage). */
  | { phase: 'loading' }
  /** The sound is being searched for speech: source time covered so far. */
  | { phase: 'listening'; doneUs: number; totalUs: number }
  /** Speech spans are being written: how many are done, of how many found. */
  | { phase: 'writing'; spansDone: number; spansTotal: number };

/** Real measurements of one run, for the result line and the measurement scripts. */
export interface TranscribeStats {
  model: TranscriptModelId;
  device: 'wasm' | 'webgpu' | 'stub';
  audioUs: number;
  /** Sum of the speech spans' lengths. */
  speechUs: number;
  spans: number;
  /** Stretches left as "(anlaşılamadı)", and their total length. */
  unclearSpans: number;
  unclearUs: number;
  /** Recogniser calls made for a second look at a dropped span, and the speech time they got written. */
  secondLooks: number;
  rescuedUs: number;
  loadMs: number;
  listenMs: number;
  writeMs: number;
  totalMs: number;
  /** Only when a measuring script asked for it. */
  trace?: EngineTrace;
}

/** What the guard saw for one attempt at one stretch of sound. */
export interface AttemptTrace {
  /** `first`, `look:<depth>` (a second look that counts), `lab-…` (recorded only). */
  kind: string;
  startS: number;
  endS: number;
  text: string;
  avgLogprob: number | null;
  compressionRatio: number | null;
  verdict: 'ok' | 'unclear';
  /** Word times are seconds from the start of this attempt's sound, uncorrected. */
  words: { text: string; start: number | null; end: number | null }[];
  tokens: { text: string; logprob: number }[];
}

export interface SpanTrace {
  startS: number;
  endS: number;
  attempts: AttemptTrace[];
}

export interface EngineTrace {
  settings: EngineSettings;
  /** The detector's speech probability per 32 ms frame. */
  probs: number[];
  spans: SpanTrace[];
}

export type TranscriptWorkerResponse =
  | { type: 'download-progress'; requestId: string; bytesDone: number; bytesTotal: number; phase: 'downloading' | 'checking' }
  | { type: 'download-done'; requestId: string }
  | { type: 'download-failed'; requestId: string; reason: DownloadFailure }
  | { type: 'progress'; requestId: string; progress: TranscribeProgress }
  | { type: 'segment'; requestId: string; segment: TranscriptSegment }
  | { type: 'done'; requestId: string; stats: TranscribeStats }
  | { type: 'failed'; requestId: string; reason: TranscribeFailure };
