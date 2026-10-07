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

import { MODEL_MANIFEST, isModelManifest, type ModelManifest } from '@/domain/transcriptModels';
import type { EngineSink } from './engine.types';
import { downloadModel } from './modelStore';
import type { TranscribeFailure, TranscriptTestOptions, TranscriptWorkerRequest, TranscriptWorkerResponse } from './protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;

/** '1' only in a test build (`CLIP_TEST_HOOKS=1`); the published site is built with ''. */
const TEST_HOOKS = process.env.NEXT_PUBLIC_CLIP_TEST_HOOKS === '1';

function post(message: TranscriptWorkerResponse): void {
  scope.postMessage(message);
}

function manifestFor(test: TranscriptTestOptions | undefined): ModelManifest {
  if (TEST_HOOKS && test?.manifest && isModelManifest(test.manifest)) return test.manifest;
  return MODEL_MANIFEST;
}

async function download(request: Extract<TranscriptWorkerRequest, { type: 'download' }>): Promise<void> {
  const { requestId } = request;
  const outcome = await downloadModel(
    request.model,
    (progress) => post({ type: 'download-progress', requestId, ...progress }),
    manifestFor(request.test),
  );
  if (outcome.ok) post({ type: 'download-done', requestId });
  else post({ type: 'download-failed', requestId, reason: outcome.reason });
}

async function transcribe(request: Extract<TranscriptWorkerRequest, { type: 'transcribe' }>): Promise<void> {
  const { requestId } = request;
  const sink: EngineSink = {
    progress: (progress) => post({ type: 'progress', requestId, progress }),
    segment: (segment) => post({ type: 'segment', requestId, segment }),
  };
  let reason: TranscribeFailure = 'internal_error';
  try {
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
    const named = (error as { reason?: unknown } | null)?.reason;
    if (typeof named === 'string') reason = named as TranscribeFailure;
  }
  post({ type: 'failed', requestId, reason });
}

scope.onmessage = (message: MessageEvent<TranscriptWorkerRequest>) => {
  const request = message.data;
  if (request.type === 'download') {
    download(request).catch(() => post({ type: 'download-failed', requestId: request.requestId, reason: 'storage_failed' }));
  } else if (request.type === 'transcribe') {
    void transcribe(request);
  }
};
