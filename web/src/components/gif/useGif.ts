'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { GifMaker, type GifFailure, type GifJob } from '@/adapters/gif/gifClient';
import { recordError, recordFailure } from '@/adapters/diagnostics';
import { setAppBusy } from '@/adapters/pwa/serviceWorker';
import { removeEmptyPick, savePicker } from '@/adapters/saveFile';
import { shareVerdictFor, shareVideo } from '@/adapters/share';
import type { ShareOffer } from '@/components/editor/useDownloads';
import type { ExportFailureDetail } from '@/domain/exportFailureDetail';
import { GIF_MIME, estimateGifBytes } from '@/domain/gif';
import { inspectGif } from '@/domain/gifInspect';

/** What a finished GIF really is: read back from its own bytes (`inspectGif`), never copied from the plan. */
export interface GifResult {
  sizeBytes: number;
  width: number;
  height: number;
  frames: number;
  durationCs: number;
  loopsForever: boolean;
  framesMissing: number;
  elapsedMs: number;
}

export type GifFailureCode = GifFailure | 'worker_unavailable' | 'output_file_unavailable' | 'output_storage_full' | 'output_probe_failed';

export type GifDownloadState =
  | {
      phase: 'running';
      /** `waiting`: the save dialog's answer; `frames`: the part is being decoded; `encoding`: the GIF written; `saving`: into the file. */
      step: 'waiting' | 'frames' | 'encoding' | 'saving';
      done: number;
      total: number;
      /** 2: the GIF is written while the part is decoded a second time (its frames were too many to hold). */
      passes?: 1 | 2;
      fileName: string | null;
    }
  /** Written into the file picked in the save dialog. */
  | { phase: 'saved'; fileName: string; result: GifResult; share: ShareOffer | null }
  /** No save dialog in this browser: the file waits for the save link. */
  | { phase: 'ready'; url: string; fileName: string; result: GifResult; share: ShareOffer | null }
  | { phase: 'failed'; code: GifFailureCode; detail?: ExportFailureDetail }
  | { phase: 'canceled' };

/** Share of the bar each step takes: decoding is most of the time (ADR-046 measured ~85 %). */
const FRAMES_SHARE = 0.85;
/**
 * The same with two passes (ADR-046 memory addendum): writing the GIF decodes the part again, so
 * the second step is about as long as the first.
 */
const FRAMES_SHARE_TWO_PASSES = 0.5;

/** 0–100, from frames really done; null while nothing can be measured. */
export function gifPercent(state: Extract<GifDownloadState, { phase: 'running' }>): number | null {
  if (state.total <= 0) return state.step === 'saving' ? 100 : null;
  const share = state.done / state.total;
  const frames = state.passes === 2 ? FRAMES_SHARE_TWO_PASSES : FRAMES_SHARE;
  if (state.step === 'frames') return Math.round(share * frames * 100);
  if (state.step === 'encoding') return Math.round((frames + share * (1 - frames)) * 100);
  return state.step === 'saving' ? 100 : 0;
}

function shareOffer(file: File): ShareOffer | null {
  const verdict = shareVerdictFor(file);
  return verdict === 'unsupported' ? null : { verdict, file, failed: false };
}

/** What a write into the picked file failing means (a full disk is said as such). */
function writeFailure(error: unknown): GifFailureCode {
  return error instanceof DOMException && error.name === 'QuotaExceededError' ? 'output_storage_full' : 'output_file_unavailable';
}

/**
 * "GIF'i indir" (ADR-046): the save dialog inside the click (ADR-026), the
 * GIF made in its worker with real progress, read back, written into the
 * picked file — or offered with a download link where the browser has no
 * save dialog — and "Paylaş" where the browser can share a file.
 */
export function useGifDownload() {
  const makerRef = useRef<GifMaker | null>(null);
  const [state, setState] = useState<GifDownloadState | null>(null);
  const [busy, setBusy] = useState(false);
  const urlRef = useRef<string | null>(null);
  const busyRef = useRef(false);
  const cancelRequested = useRef(false);

  const maker = useCallback(() => {
    makerRef.current ??= new GifMaker();
    return makerRef.current;
  }, []);

  const releaseUrl = () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
  };

  useEffect(
    () => () => {
      makerRef.current?.dispose();
      makerRef.current = null;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  /** MUST be called synchronously from the click: the save dialog opens before anything is awaited. */
  const start = useCallback(
    (job: GifJob, fileName: string) => {
      if (busyRef.current) return;
      const picker = savePicker();
      let picked: Promise<FileSystemFileHandle | null>;
      try {
        picked = picker
          ? picker({ suggestedName: fileName, types: [{ description: 'GIF', accept: { [GIF_MIME]: ['.gif'] } }] })
          : Promise.resolve(null);
      } catch (error) {
        picked = Promise.reject(error);
      }
      busyRef.current = true;
      cancelRequested.current = false;
      releaseUrl();

      const run = async () => {
        let destination: FileSystemFileHandle | null = null;
        try {
          destination = await picked;
        } catch (error) {
          // The user closed the dialog: nothing happens, nothing is said.
          if (error instanceof DOMException && error.name === 'AbortError') return;
          destination = null;
        }
        const name = destination?.name ?? fileName;
        setState({ phase: 'running', step: 'waiting', done: 0, total: 0, fileName: destination?.name ?? null });
        if (cancelRequested.current) {
          if (destination) await removeEmptyPick(destination);
          setState({ phase: 'canceled' });
          return;
        }
        const outcome = await maker().make(job, (progress) => {
          setState({
            phase: 'running',
            step: progress.step,
            done: progress.done,
            total: progress.total,
            passes: progress.passes,
            fileName: destination?.name ?? null,
          });
        });
        if (!outcome.ok) {
          if (destination) await removeEmptyPick(destination);
          if (outcome.reason === 'canceled') {
            setState({ phase: 'canceled' });
            return;
          }
          recordFailure('export', `gif_${outcome.reason}`, outcome.detail);
          setState({ phase: 'failed', code: outcome.reason, ...(outcome.detail ? { detail: outcome.detail } : {}) });
          return;
        }
        // Never a "Kaydedildi" for something that is not a whole GIF.
        const inspected = inspectGif(outcome.bytes);
        if (!inspected.ok || inspected.gif.frames !== outcome.frames) {
          if (destination) await removeEmptyPick(destination);
          recordError('export', 'gif_output_probe_failed');
          setState({ phase: 'failed', code: 'output_probe_failed' });
          return;
        }
        const result: GifResult = {
          sizeBytes: outcome.bytes.byteLength,
          width: inspected.gif.width,
          height: inspected.gif.height,
          frames: inspected.gif.frames,
          durationCs: inspected.gif.durationCs,
          loopsForever: inspected.gif.loops === 0,
          framesMissing: outcome.framesMissing,
          elapsedMs: outcome.elapsedMs,
        };
        const file = new File([outcome.bytes as BlobPart], name, { type: GIF_MIME });
        if (destination) {
          setState({ phase: 'running', step: 'saving', done: 0, total: 0, fileName: destination.name });
          try {
            const writable = await destination.createWritable();
            await writable.write(file);
            await writable.close();
          } catch (error) {
            await removeEmptyPick(destination);
            recordError('export', 'gif_write');
            setState({ phase: 'failed', code: writeFailure(error) });
            return;
          }
          setState({ phase: 'saved', fileName: destination.name, result, share: shareOffer(file) });
          return;
        }
        const url = URL.createObjectURL(file);
        urlRef.current = url;
        setState({ phase: 'ready', url, fileName: name, result, share: shareOffer(file) });
      };
      void run().finally(() => {
        busyRef.current = false;
        setBusy(false);
      });
      setBusy(true);
    },
    [maker],
  );

  const cancel = useCallback(() => {
    cancelRequested.current = true;
    makerRef.current?.cancel();
  }, []);

  const dismiss = useCallback(() => {
    if (busyRef.current) return;
    releaseUrl();
    setState(null);
  }, []);

  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });

  /** "Paylaş": straight from the click, `navigator.share` before anything is awaited. */
  const share = useCallback(() => {
    const now = stateRef.current;
    if (!now || (now.phase !== 'saved' && now.phase !== 'ready') || now.share?.verdict !== 'share') return;
    const offer = now.share;
    void shareVideo(offer.file).then((outcome) => {
      if (outcome === 'failed') recordError('export', 'share_refused');
      setState((current) => {
        if (!current || (current.phase !== 'saved' && current.phase !== 'ready') || current.share?.file !== offer.file) return current;
        const failed = outcome === 'failed';
        return current.share.failed === failed ? current : { ...current, share: { ...current.share, failed } };
      });
    });
  }, []);

  // The "new version" notice must not reload the page under a GIF being made; leaving asks first.
  useEffect(() => {
    setAppBusy('download', busy);
    if (!busy) return () => setAppBusy('download', false);
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => {
      window.removeEventListener('beforeunload', handler);
      setAppBusy('download', false);
    };
  }, [busy]);

  return { state, busy, start, cancel, dismiss, share, maker };
}

export type GifEstimateState =
  | { status: 'idle' }
  | { status: 'measuring'; key: string }
  | { status: 'ready'; key: string; bytes: number; width: number; height: number; frames: number }
  | { status: 'failed'; key: string; reason: GifFailure | 'worker_unavailable'; detail?: ExportFailureDetail };

/** How long the screen waits after the last change before it measures again. */
const ESTIMATE_PAUSE_MS = 450;

/**
 * "yaklaşık 3 MB" (ADR-046): measured, not guessed — a few frames of the part
 * are made the GIF's way in the worker each time the part, the size or the
 * text has stood still for a moment. `key` says which choice a number is for:
 * a number for an older choice is never shown as the current one.
 */
export function useGifEstimate(maker: () => GifMaker, job: GifJob | null, key: string): GifEstimateState {
  const [state, setState] = useState<GifEstimateState>({ status: 'idle' });
  const jobRef = useRef(job);
  useEffect(() => {
    jobRef.current = job;
  });
  const hasJob = job !== null;
  useEffect(() => {
    const current = jobRef.current;
    if (!hasJob || !current) return undefined;
    let live = true;
    const timer = window.setTimeout(() => {
      setState({ status: 'measuring', key });
      void maker()
        .estimate(current)
        .then((outcome) => {
          if (!live) return;
          if (outcome.ok) {
            setState({
              status: 'ready',
              key,
              bytes: estimateGifBytes(outcome.sample, outcome.frames),
              width: outcome.width,
              height: outcome.height,
              frames: outcome.frames,
            });
          } else if (outcome.reason !== 'canceled') {
            setState({ status: 'failed', key, reason: outcome.reason, ...(outcome.detail ? { detail: outcome.detail } : {}) });
          }
        });
    }, ESTIMATE_PAUSE_MS);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [hasJob, key, maker]);
  return state;
}
