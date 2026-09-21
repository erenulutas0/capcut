'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  SilenceAnalyzer,
  cachedEnvelope,
  envelopeKey,
  fileFingerprint,
  type AnalysisFailure,
} from '@/adapters/silence/silenceClient';
import type { LoudnessEnvelope } from '@/domain/silence';
import type { Micros } from '@/domain/time';

export type SilenceRun =
  | { status: 'idle' }
  /** `framesTotal` is 0 until the worker has opened the file and counted. */
  | { status: 'running'; framesDone: number; framesTotal: number }
  | { status: 'done' }
  | { status: 'canceled' }
  | { status: 'failed'; reason: AnalysisFailure | 'worker_unavailable' };

type Range = { sourceInUs: Micros; sourceOutUs: Micros };

/**
 * Drives the loudness worker for the silence dialog.
 *
 * Everything starts from a user event (the "Sessizlikleri bul" button, the
 * retry button), never from an effect: an analysis decodes the whole moment
 * range, and doing that because a component re-rendered would be wasteful
 * and surprising. The envelopes known to the dialog are React state, copied
 * from the session cache, so a finished run re-renders the list.
 */
export function useSilenceAnalysis() {
  const [run, setRun] = useState<SilenceRun>({ status: 'idle' });
  const [envelopes, setEnvelopes] = useState<ReadonlyMap<string, LoudnessEnvelope>>(() => new Map());
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const analyzerRef = useRef<SilenceAnalyzer | null>(null);
  // A canceled run resolves after the next one started; its answer must not
  // overwrite the newer run's state.
  const runTokenRef = useRef(0);

  useEffect(
    () => () => {
      analyzerRef.current?.dispose();
    },
    [],
  );

  const start = useCallback((file: File, ranges: readonly Range[]) => {
    const print = fileFingerprint(file);
    const keys = ranges.map((range) => envelopeKey(print, range.sourceInUs, range.sourceOutUs));
    const collect = () => {
      const found = new Map<string, LoudnessEnvelope>();
      for (const key of keys) {
        const envelope = cachedEnvelope(key);
        if (envelope) found.set(key, envelope);
      }
      return found;
    };

    setFingerprint(print);
    const known = collect();
    setEnvelopes(known);
    if (known.size === keys.length) {
      // Everything is cached: parameters only re-run the pure detector.
      setRun({ status: 'done' });
      return;
    }

    runTokenRef.current += 1;
    const token = runTokenRef.current;
    analyzerRef.current ??= new SilenceAnalyzer();
    setRun({ status: 'running', framesDone: 0, framesTotal: 0 });
    void analyzerRef.current
      .analyze(
        file,
        ranges.map((range) => ({ startUs: range.sourceInUs, endUs: range.sourceOutUs })),
        (progress) => {
          if (runTokenRef.current !== token) return;
          setRun({ status: 'running', ...progress });
        },
      )
      .then((outcome) => {
        if (runTokenRef.current !== token) return;
        // Envelopes that arrived before a cancel or failure are still shown.
        setEnvelopes(collect());
        if (outcome.ok) setRun({ status: 'done' });
        else if (outcome.reason === 'canceled') setRun({ status: 'canceled' });
        else setRun({ status: 'failed', reason: outcome.reason });
      });
  }, []);

  const cancel = useCallback(() => {
    analyzerRef.current?.cancel();
  }, []);

  /** The dialog closed: stop any decode and forget the run (not the cache). */
  const reset = useCallback(() => {
    runTokenRef.current += 1;
    analyzerRef.current?.cancel();
    setRun({ status: 'idle' });
  }, []);

  const envelopeFor = useCallback(
    (range: Range): LoudnessEnvelope | undefined =>
      fingerprint === null
        ? undefined
        : envelopes.get(envelopeKey(fingerprint, range.sourceInUs, range.sourceOutUs)),
    [envelopes, fingerprint],
  );

  return { run, start, cancel, reset, envelopeFor };
}
