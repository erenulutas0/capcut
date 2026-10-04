'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { canvasMeasure, loadCaptionFont } from '@/adapters/captionRender';
import { deleteStoredModels, modelStatus, type ModelStatus } from '@/adapters/transcript/modelStore';
import {
  TranscriptClient,
  activeManifest,
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
import { CUE_RULES, transcriptToCues, type FitsFrame } from '@/domain/subtitleSegmentation';
import type { Micros } from '@/domain/time';
import type { TranscriptModelId } from '@/domain/transcriptModels';

export type TranscriptionJob =
  | { kind: 'idle' }
  | { kind: 'downloading'; progress: DownloadProgress | null }
  | { kind: 'download-failed'; reason: DownloadFailure | 'worker_unavailable' }
  | { kind: 'transcribing'; progress: TranscribeProgress | null; startedAt: number }
  | { kind: 'failed'; reason: TranscribeFailure | 'worker_unavailable' | 'nothing_heard' }
  | {
      kind: 'done';
      stats: TranscribeStats;
      /** Lines written, spans that could not be written, lines a rule refused. */
      lines: number;
      unclear: number;
      skipped: number;
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
async function frameTest(style: CaptionStyleV2): Promise<FitsFrame> {
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
  const [model, setModel] = useState<TranscriptModelId>('base');
  const [status, setStatus] = useState<ModelStatus | null>(null);
  const [largeOffered, setLargeOffered] = useState(false);
  const [job, setJob] = useState<TranscriptionJob>({ kind: 'idle' });
  const aliveRef = useRef(true);

  const client = () => {
    clientRef.current ??= new TranscriptClient();
    return clientRef.current;
  };

  const refresh = useCallback(async (which: TranscriptModelId) => {
    try {
      const next = await modelStatus(which, activeManifest());
      if (aliveRef.current) setStatus(next);
    } catch {
      if (aliveRef.current) setStatus(null);
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    void supportsLargeModel().then((ok) => {
      if (aliveRef.current) setLargeOffered(ok);
    });
    return () => {
      aliveRef.current = false;
      clientRef.current?.dispose();
      clientRef.current = null;
    };
  }, []);

  useEffect(() => {
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
  }, [model]);

  const chooseModel = useCallback((next: TranscriptModelId) => {
    setStatus(null);
    setModel(next);
  }, []);

  /** "Modeli indir": only ever from this click. */
  const download = useCallback(async () => {
    setJob({ kind: 'downloading', progress: null });
    const outcome = await client().download(model, (progress) => {
      if (aliveRef.current) setJob({ kind: 'downloading', progress });
    });
    if (!aliveRef.current) return;
    await refresh(model);
    if (outcome.ok || outcome.reason === 'canceled') setJob({ kind: 'idle' });
    else setJob({ kind: 'download-failed', reason: outcome.reason });
  }, [model, refresh]);

  const start = useCallback(
    async (target: TranscriptionTarget) => {
      setJob({ kind: 'transcribing', progress: null, startedAt: Date.now() });
      const startedAt = Date.now();
      const outcome = await client().transcribe(target.file, model, (progress) => {
        if (aliveRef.current) setJob({ kind: 'transcribing', progress, startedAt });
      });
      if (!aliveRef.current) return;
      if (!outcome.ok) {
        if (outcome.reason === 'canceled') setJob({ kind: 'idle' });
        else setJob({ kind: 'failed', reason: outcome.reason });
        if (outcome.reason === 'model_missing') void refresh(model);
        return;
      }
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
      setJob({
        kind: 'done',
        stats: outcome.stats,
        lines: applied.report.imported,
        unclear: made.unclear.length,
        skipped: applied.report.skipped.length,
      });
    },
    [model, refresh],
  );

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
    await refresh(model);
  }, [model, refresh]);

  return { model, chooseModel, largeOffered, status, job, download, start, cancel, reset, removeModels };
}

export type Transcription = ReturnType<typeof useTranscription>;
