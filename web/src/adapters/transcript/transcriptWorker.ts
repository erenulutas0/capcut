/// <reference lib="webworker" />

/**
 * Transcript worker (ADR-036): downloads and checks the model files, and
 * turns a video's sound into timed text — all on this device, off the UI
 * thread. Cancel is a `terminate()` from the client: a download keeps the
 * parts already stored (the next try continues), a transcription leaves
 * nothing behind (no partial result is kept, ADR-017).
 *
 * The recogniser (Transformers.js + onnxruntime-web, ~1.5 MB of script) is
 * imported only when a transcription starts, so nothing else in the app —
 * not even the model download — pays for it.
 */

import { originOf, stageOf } from '@/adapters/export/failureStage';
import { applyWorkerFault } from '@/adapters/workerFault';
import { caughtFailureDetail, stalledFailureDetail, type ExportStage } from '@/domain/exportFailureDetail';
import { MODEL_MANIFEST, isModelManifest, type ModelManifest } from '@/domain/transcriptModels';
import { EngineError, type EngineSink } from './engine.types';
import { downloadModel } from './modelStore';
import type { TranscribeFailure, TranscriptTestOptions, TranscriptWorkerRequest, TranscriptWorkerResponse } from './protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;

/** '1' only in a test build (`CLIP_TEST_HOOKS=1`); the published site is built with ''. */
const TEST_HOOKS = process.env.NEXT_PUBLIC_CLIP_TEST_HOOKS === '1';

/** Where the running job is, for the day it fails or stands still (ADR-042): one of our own words, nothing of the video. */
let stage: ExportStage = 'unknown';

function post(message: TranscriptWorkerResponse): void {
  scope.postMessage(message);
}

function manifestFor(test: TranscriptTestOptions | undefined): ModelManifest {
  if (TEST_HOOKS && test?.manifest && isModelManifest(test.manifest)) return test.manifest;
  return MODEL_MANIFEST;
}

async function download(request: Extract<TranscriptWorkerRequest, { type: 'download' }>): Promise<void> {
  const { requestId } = request;
  stage = 'model_download';
  if (TEST_HOOKS) await applyWorkerFault(request.testFault);
  const outcome = await downloadModel(
    request.model,
    (progress) => {
      stage = progress.phase === 'checking' ? 'model_check' : 'model_download';
      post({ type: 'download-progress', requestId, ...progress });
    },
    manifestFor(request.test),
  );
  if (outcome.ok) post({ type: 'download-done', requestId });
  else post({ type: 'download-failed', requestId, reason: outcome.reason, ...(outcome.detail ? { detail: outcome.detail } : {}) });
}

async function transcribe(request: Extract<TranscriptWorkerRequest, { type: 'transcribe' }>): Promise<void> {
  const { requestId } = request;
  const sink: EngineSink = {
    progress: (progress) => post({ type: 'progress', requestId, progress }),
    segment: (segment) => post({ type: 'segment', requestId, segment }),
    stage: (next) => {
      stage = next;
    },
  };
  let reason: TranscribeFailure = 'internal_error';
  let failure: unknown;
  try {
    if (TEST_HOOKS && request.testFault) {
      // A test asked this run to break (test builds only): after its first sign of life, as a real one would.
      post({ type: 'progress', requestId, progress: { phase: 'loading' } });
      stage = 'model_load';
      await applyWorkerFault(request.testFault);
    }
    if (TEST_HOOKS && request.test?.stub) {
      // A stand-in recogniser for the UI tests. This branch (and its file) is not in an ordinary build.
      const { runStubTranscription } = await import('./stubEngine');
      const stats = await runStubTranscription(request.file, request.model, request.test.stub, sink);
      post({ type: 'done', requestId, stats });
      return;
    }
    const { transcribeFile } = await import('./engine');
    const stats = await transcribeFile(request.file, request.model, manifestFor(request.test), sink, request.probe);
    post({ type: 'done', requestId, stats });
    return;
  } catch (error) {
    // Never forward a raw error message: it can contain file paths.
    failure = error;
    const named = error instanceof EngineError ? error.reason : undefined;
    if (typeof named === 'string') reason = named;
  }
  // For an error that is not one of the engine's own refusals: its name (if it is a known one) and
  // the stage it was raised in. Its text is not read except to recognise a known sentence.
  const origin = originOf(failure);
  const planned = failure instanceof EngineError && origin === undefined && reason !== 'internal_error';
  const cause = origin ?? failure;
  post({ type: 'failed', requestId, reason, ...(planned ? {} : { detail: caughtFailureDetail(cause, stageOf(cause) ?? stage) }) });
}

scope.onmessage = (message: MessageEvent<TranscriptWorkerRequest>) => {
  const request = message.data;
  if (request.type === 'where') {
    // The job stands still somewhere in an `await`; this handler still runs. Nothing was thrown.
    post({ type: 'where', requestId: request.requestId, detail: stalledFailureDetail(stage) });
  } else if (request.type === 'download') {
    stage = 'unknown';
    download(request).catch((error: unknown) =>
      post({ type: 'download-failed', requestId: request.requestId, reason: 'storage_failed', detail: caughtFailureDetail(error, stage) }),
    );
  } else if (request.type === 'transcribe') {
    stage = 'unknown';
    void transcribe(request);
  }
};
