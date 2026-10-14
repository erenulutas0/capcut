'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { canvasMeasure, loadCaptionFont } from '@/adapters/captionRender';
import { recordError, recordFailure } from '@/adapters/diagnostics';
import { forgetLargeModelFailed, largeModelFailedHere, rememberLargeModelFailed, subscribeLargeModelNote } from '@/adapters/transcript/largeModelNote';
import { deleteModelFiles, deleteStoredModels, modelStatus, storedOwnBytes, type ModelStatus } from '@/adapters/transcript/modelStore';
import {
  TranscriptClient,
  activeManifest,
  currentDevice,
  supportsLargeModel,
  type DownloadFailure,
  type DownloadProgress,
  type TranscribeFailure,
  type TranscribeProgress,
  type TranscribeStats,
} from '@/adapters/transcript/transcriptClient';
import type { CaptionImportResult, ImportedCueInput } from '@/application/commands';
import { fitsEveryFrame } from '@/domain/captionFrames';
import { DEFAULT_CAPTION_STYLE } from '@/domain/captions';
import type { CaptionStyleV2, CaptionUnclearV3 } from '@/domain/edl';
import type { ExportFailureDetail } from '@/domain/exportFailureDetail';
import { CUE_RULES, transcriptToCues, type FitsFrame } from '@/domain/subtitleSegmentation';
import type { Micros } from '@/domain/time';
import { transcriptCoverage, type Coverage } from '@/domain/transcript';
import type { DeviceClass } from '@/domain/deviceClass';
import {
  LARGE_MODEL,
  classifyLargeModelFailure,
  largeModelStanding,
  preselectedModel,
  recommendedModel,
  type LargeFailureKind,
  type LargeModelStanding,
  type TranscriptModelId,
} from '@/domain/transcriptModels';

export type TranscriptionJob =
  | { kind: 'idle' }
  | { kind: 'downloading'; progress: DownloadProgress | null }
  /** `detail` (here and in `failed`): for "Ayrıntılar", when the failure was not a planned refusal (ADR-042). */
  | { kind: 'download-failed'; reason: DownloadFailure | 'worker_unavailable' | 'internal_error' | 'stalled'; detail?: ExportFailureDetail }
  | { kind: 'transcribing'; progress: TranscribeProgress | null; startedAt: number }
  | {
      kind: 'failed';
      reason: TranscribeFailure | 'worker_unavailable' | 'nothing_heard';
      detail?: ExportFailureDetail;
      /**
       * Set when the LARGE model failed in a way the small one may get past (ADR-036 addendum,
       * 14 Oct 2026): the failure screen then offers "Küçük modelle dene" before "Tekrar dene".
       */
      largeFailure?: LargeFailureKind;
    }
  | {
      kind: 'done';
      stats: TranscribeStats;
      /** Lines written, spans that could not be written, lines a rule refused. */
      lines: number;
      unclear: number;
      skipped: number;
      /** How much of the found speech was written (real times of this run). */
      coverage: Coverage;
      /** A meaningful part was not written, the small model wrote it, and the large model is this device's recommendation. */
      suggestLarger: boolean;
    };

export interface TranscriptionTarget {
  file: File;
  durationUs: Micros;
  /** The look the lines must fit (the track's own, or the default). */
  style?: CaptionStyleV2;
  /** Puts the result into the recipe (one undo step) and says what happened. */
  apply: (cues: readonly ImportedCueInput[], unclear: readonly CaptionUnclearV3[]) => CaptionImportResult;
}

/**
 * The real frame test for the transcript's lines: the app's caption layout
 * with the bundled typeface, for every frame shape and size. Without the
 * typeface only the character rule applies (the export says so if a line
 * then does not fit; it is never shrunk).
 */
export async function frameTest(style: CaptionStyleV2): Promise<FitsFrame> {
  try {
    const ready = await loadCaptionFont(document.fonts, window.location.origin);
    const context = document.createElement('canvas').getContext('2d');
    if (!ready || !context) return () => true;
    const measure = canvasMeasure(context);
    return (text) => fitsEveryFrame(text, style, measure);
  } catch {
    return () => true;
  }
}

/**
 * "Yazıya dök" as the wizard and the editor use it (ADR-036): whether the
 * model is in this browser, the explicit download, and the transcription —
 * each with its real numbers, each cancellable.
 */
export function useTranscription() {
  const clientRef = useRef<TranscriptClient | null>(null);
  const [model, setModelState] = useState<TranscriptModelId>('base');
  /** The selected model, for the jobs: a press that switches models and starts at once must not use the old one. */
  const modelRef = useRef<TranscriptModelId>('base');
  const [status, setStatus] = useState<ModelStatus | null>(null);
  const [largeOffered, setLargeOffered] = useState(false);
  /** Phone or computer, Chromium or not: read once (`domain/deviceClass.ts`). */
  const [device, setDevice] = useState<DeviceClass>({ handheld: false, chromium: true, source: 'user-agent' });
  /** "The large model failed here" — this browser's note (`largeModelNote.ts`). */
  const [largeFailedHere, setLargeFailedHere] = useState(false);
  /** Bytes the large model's own files take in this browser (shown where they can be freed). */
  const [largeStoredBytes, setLargeStoredBytes] = useState(0);
  /** The small model in this browser: what "Küçük modelle dene" would download first. */
  const [smallStatus, setSmallStatus] = useState<ModelStatus | null>(null);
  /** False until this browser has been asked what it can run and what it already holds. */
  const [decided, setDecided] = useState(false);
  const [job, setJob] = useState<TranscriptionJob>({ kind: 'idle' });
  const aliveRef = useRef(true);
  /** What decides "Önerilen modelle yeniden yaz" when a run ends. */
  const recommendedRef = useRef<TranscriptModelId>('base');
  /** The user pressed "Küçük modelle dene" after the large model failed: its outcome goes to the diagnostics. */
  const fallbackRef = useRef(false);

  const client = () => {
    clientRef.current ??= new TranscriptClient();
    return clientRef.current;
  };

  const setModel = useCallback((next: TranscriptModelId) => {
    modelRef.current = next;
    setModelState(next);
  }, []);

  const refresh = useCallback(async (which: TranscriptModelId) => {
    try {
      const next = await modelStatus(which, activeManifest());
      if (aliveRef.current && modelRef.current === which) setStatus(next);
    } catch {
      if (aliveRef.current && modelRef.current === which) setStatus(null);
    }
  }, []);

  const refreshLargeBytes = useCallback(async () => {
    const bytes = await storedOwnBytes(LARGE_MODEL, activeManifest()).catch(() => 0);
    if (aliveRef.current) setLargeStoredBytes(bytes);
  }, []);

  const refreshSmall = useCallback(async () => {
    const next = await modelStatus('base', activeManifest()).catch(() => null);
    if (aliveRef.current) setSmallStatus(next);
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    // Which model is selected to begin with (`preselectedModel`): asked once, before any button is shown,
    // so the download button never shows one model's size and then another's.
    const manifest = activeManifest();
    const stored = (which: TranscriptModelId) => modelStatus(which, manifest).catch(() => null);
    const here = currentDevice();
    const failedHere = largeModelFailedHere();
    void Promise.all([supportsLargeModel(), stored('base'), stored('turbo')]).then(([largeSupported, base, turbo]) => {
      if (!aliveRef.current) return;
      const standing = { largeSupported, device: here, largeFailedHere: failedHere };
      const first = preselectedModel({ ...standing, baseReady: base?.ready === true, turboReady: turbo?.ready === true });
      recommendedRef.current = recommendedModel(standing);
      setSmallStatus(base);
      setDevice(here);
      setLargeFailedHere(failedHere);
      setLargeOffered(largeSupported);
      setModel(first);
      setStatus(first === 'turbo' ? turbo : base);
      setDecided(true);
    });
    void refreshLargeBytes();
    // Another tab (or the privacy page in this one) cleared or wrote the note.
    const unsubscribe = subscribeLargeModelNote(() => {
      if (aliveRef.current) setLargeFailedHere(largeModelFailedHere());
    });
    return () => {
      aliveRef.current = false;
      unsubscribe();
      clientRef.current?.dispose();
      clientRef.current = null;
    };
  }, [refreshLargeBytes, setModel]);

  useEffect(() => {
    recommendedRef.current = recommendedModel({ largeSupported: largeOffered, device, largeFailedHere });
  }, [largeOffered, device, largeFailedHere]);

  useEffect(() => {
    if (!decided) return undefined;
    // The stored-model check reads Cache Storage: asynchronous, set from its answer.
    let live = true;
    void modelStatus(model, activeManifest()).then(
      (next) => {
        if (live && aliveRef.current) setStatus(next);
      },
      () => {
        if (live && aliveRef.current) setStatus(null);
      },
    );
    return () => {
      live = false;
    };
  }, [model, decided]);

  const chooseModel = useCallback(
    (next: TranscriptModelId) => {
      if (next === modelRef.current) return;
      setStatus(null);
      setModel(next);
    },
    [setModel],
  );

  /** "Modeli indir": only ever from a press. True when the model is now here. */
  const download = useCallback(async (): Promise<boolean> => {
    const which = modelRef.current;
    setJob({ kind: 'downloading', progress: null });
    const outcome = await client().download(which, (progress) => {
      if (aliveRef.current) setJob({ kind: 'downloading', progress });
    });
    if (!aliveRef.current) return false;
    await refresh(which);
    if (which === LARGE_MODEL) void refreshLargeBytes();
    else void refreshSmall();
    if (outcome.ok || outcome.reason === 'canceled') setJob({ kind: 'idle' });
    else {
      // For "Sorun bildir": the code, and the detail of an unexpected failure.
      recordFailure('model_download', outcome.reason, outcome.detail);
      setJob({ kind: 'download-failed', reason: outcome.reason, ...(outcome.detail ? { detail: outcome.detail } : {}) });
    }
    return outcome.ok;
  }, [refresh, refreshLargeBytes, refreshSmall]);

  const start = useCallback(
    async (target: TranscriptionTarget) => {
      const which = modelRef.current;
      const fallback = fallbackRef.current;
      fallbackRef.current = false;
      setJob({ kind: 'transcribing', progress: null, startedAt: Date.now() });
      const startedAt = Date.now();
      const outcome = await client().transcribe(target.file, which, (progress) => {
        if (aliveRef.current) setJob({ kind: 'transcribing', progress, startedAt });
      });
      if (!aliveRef.current) return;
      if (!outcome.ok) {
        if (outcome.reason === 'canceled') setJob({ kind: 'idle' });
        else {
          const largeFailure = classifyLargeModelFailure(which, outcome.reason, outcome.detail) ?? undefined;
          // For "Sorun bildir": first which way the large model failed (a code), then the failure with its detail.
          if (largeFailure) recordError('transcript', `large_model_failed_${largeFailure}`);
          recordFailure('transcript', outcome.reason, outcome.detail);
          if (largeFailure) {
            // ADR-036 addendum: this browser stops recommending the large model, and the screen offers the small one.
            rememberLargeModelFailed();
            setLargeFailedHere(true);
            void refreshLargeBytes();
            void refreshSmall();
          }
          setJob({
            kind: 'failed',
            reason: outcome.reason,
            ...(outcome.detail ? { detail: outcome.detail } : {}),
            ...(largeFailure ? { largeFailure } : {}),
          });
        }
        if (outcome.reason === 'model_missing') void refresh(which);
        return;
      }
      if (which === LARGE_MODEL && largeModelFailedHere()) {
        // It worked here after all (the user chose it again): the note goes.
        forgetLargeModelFailed();
        setLargeFailedHere(false);
      }
      if (fallback) recordError('transcript', 'large_model_fallback_small_done');
      const fits = await frameTest(target.style ?? DEFAULT_CAPTION_STYLE);
      const made = transcriptToCues(outcome.segments, target.durationUs, CUE_RULES, fits);
      if (made.cues.length === 0 && made.unclear.length === 0) {
        setJob({ kind: 'failed', reason: 'nothing_heard' });
        return;
      }
      const applied = target.apply(made.cues, made.unclear);
      if (!applied.ok) {
        setJob({ kind: 'failed', reason: 'internal_error' });
        return;
      }
      const coverage = transcriptCoverage(outcome.stats);
      setJob({
        kind: 'done',
        stats: outcome.stats,
        lines: applied.report.imported,
        unclear: made.unclear.length,
        skipped: applied.report.skipped.length,
        coverage,
        suggestLarger: coverage.worthSaying && outcome.stats.model !== LARGE_MODEL && recommendedRef.current === LARGE_MODEL,
      });
    },
    [refresh, refreshLargeBytes, refreshSmall],
  );

  /**
   * "Küçük modelle dene" after the large model failed: selects the small model, downloads it if it is
   * not here (the button says its size first), then runs `startAgain` — the caller's own start, which
   * now uses the small model. Nothing else is deleted or changed.
   */
  const trySmallModel = useCallback(
    async (startAgain: () => void) => {
      recordError('transcript', 'large_model_fallback_small');
      chooseModel('base');
      const here = await modelStatus('base', activeManifest()).catch(() => null);
      if (!aliveRef.current) return;
      if (here?.ready !== true) {
        setStatus(here);
        if (!(await download())) return;
      }
      fallbackRef.current = true;
      startAgain();
    },
    [chooseModel, download],
  );

  /** "Tekrar dene" on the large model's failure screen: the same model again, said in the diagnostics. */
  const retryAfterLargeFailure = useCallback((startAgain: () => void) => {
    recordError('transcript', 'large_model_retry');
    startAgain();
  }, []);

  const cancel = useCallback(() => {
    clientRef.current?.cancel();
  }, []);

  const reset = useCallback(() => {
    clientRef.current?.cancel();
    setJob({ kind: 'idle' });
  }, []);

  /** "Modeli sil": every stored model file of this app. */
  const removeModels = useCallback(async () => {
    clientRef.current?.cancel();
    await deleteStoredModels();
    await refresh(modelRef.current);
    void refreshLargeBytes();
    void refreshSmall();
  }, [refresh, refreshLargeBytes, refreshSmall]);

  /**
   * "Büyük modeli sil": only the large model's own files (the small model and the shared files stay).
   * Offered where it failed here; never done without the press. The small model is selected after.
   */
  const removeLargeModel = useCallback(async () => {
    await deleteModelFiles(LARGE_MODEL, activeManifest()).catch(() => undefined);
    recordError('transcript', 'large_model_deleted');
    if (!aliveRef.current) return;
    if (modelRef.current === LARGE_MODEL) chooseModel('base');
    else void refresh(modelRef.current);
    await refreshLargeBytes();
  }, [chooseModel, refresh, refreshLargeBytes]);

  const standing: LargeModelStanding = largeModelStanding({ device, largeFailedHere });
  const recommended = recommendedModel({ largeSupported: largeOffered, device, largeFailedHere });

  return {
    model,
    chooseModel,
    largeOffered,
    /** Where the large model stands here, and the model marked "Önerilen" (listed first). */
    standing,
    recommended,
    largeStoredBytes,
    smallStatus,
    status,
    job,
    download,
    start,
    trySmallModel,
    retryAfterLargeFailure,
    cancel,
    reset,
    removeModels,
    removeLargeModel,
  };
}

export type Transcription = ReturnType<typeof useTranscription>;
