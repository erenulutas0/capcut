'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { recordFailure } from '@/adapters/diagnostics';
import { SoundChecker, type AnalysisFailure } from '@/adapters/silence/silenceClient';
import type { SoundListen } from '@/adapters/silence/protocol';
import type { ExportFailureDetail } from '@/domain/exportFailureDetail';
import type { SoundCheck } from '@/domain/soundFix';
import type { Micros } from '@/domain/time';

export type SoundCheckRun =
  | { status: 'idle' }
  /** `framesTotal` is 0 until the worker has opened the file. */
  | { status: 'running'; framesDone: number; framesTotal: number }
  | { status: 'done'; check: SoundCheck; listen: SoundListen | null }
  | { status: 'canceled' }
  /** `detail`: for "Ayrıntılar", when the failure was not a planned refusal (ADR-042). */
  | { status: 'failed'; reason: AnalysisFailure | 'worker_unavailable'; detail?: ExportFailureDetail };

/**
 * Drives "Sesi düzelt"'s measurement (ADR-049): started by the wizard when a
 * video is opened (the user's own act), stopped by "Vazgeç", forgotten when
 * another video is opened. A run that was overtaken by a newer one never
 * writes over its state.
 */
export function useSoundCheck() {
  const [run, setRun] = useState<SoundCheckRun>({ status: 'idle' });
  const checkerRef = useRef<SoundChecker | null>(null);
  const tokenRef = useRef(0);

  useEffect(
    () => () => {
      checkerRef.current?.dispose();
    },
    [],
  );

  const start = useCallback((file: File, durationUs: Micros) => {
    tokenRef.current += 1;
    const token = tokenRef.current;
    checkerRef.current ??= new SoundChecker();
    setRun({ status: 'running', framesDone: 0, framesTotal: 0 });
    void checkerRef.current
      .check(file, durationUs, (progress) => {
        if (tokenRef.current === token) setRun({ status: 'running', ...progress });
      })
      .then((outcome) => {
        if (tokenRef.current !== token) return;
        if (outcome.ok) setRun({ status: 'done', check: outcome.check, listen: outcome.listen });
        else if (outcome.reason === 'canceled') setRun({ status: 'canceled' });
        else {
          recordFailure('silence', outcome.reason, outcome.detail);
          setRun({ status: 'failed', reason: outcome.reason, ...(outcome.detail ? { detail: outcome.detail } : {}) });
        }
      });
  }, []);

  const cancel = useCallback(() => checkerRef.current?.cancel(), []);

  const reset = useCallback(() => {
    tokenRef.current += 1;
    checkerRef.current?.cancel();
    setRun({ status: 'idle' });
  }, []);

  return { run, start, cancel, reset };
}

/**
 * Plays one of the two five-second clips of the check (ADR-049), through the
 * page's own audio output; nothing is stored. One plays at a time: pressing
 * the playing one stops it, pressing the other switches.
 */
export function useListen(listen: SoundListen | null) {
  const [playing, setPlaying] = useState<'before' | 'after' | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);

  const stop = useCallback(() => {
    const source = sourceRef.current;
    sourceRef.current = null;
    if (source) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // Already ended.
      }
    }
    setPlaying(null);
  }, []);

  useEffect(() => stop, [listen, stop]);
  useEffect(
    () => () => {
      void contextRef.current?.close().catch(() => undefined);
      contextRef.current = null;
    },
    [],
  );

  const play = useCallback(
    (which: 'before' | 'after') => {
      if (!listen) return;
      const wasPlaying = playing;
      stop();
      if (wasPlaying === which) return;
      const channels = listen[which];
      const length = channels[0]?.length ?? 0;
      if (length === 0) return;
      try {
        const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Context) return;
        contextRef.current ??= new Context();
        const context = contextRef.current;
        void context.resume().catch(() => undefined);
        const buffer = context.createBuffer(channels.length, length, listen.sampleRate);
        channels.forEach((channel, index) => buffer.copyToChannel(Float32Array.from(channel), index));
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);
        source.onended = () => {
          if (sourceRef.current === source) {
            sourceRef.current = null;
            setPlaying(null);
          }
        };
        sourceRef.current = source;
        source.start();
        setPlaying(which);
      } catch {
        setPlaying(null);
      }
    },
    [listen, playing, stop],
  );

  return { playing, play, stop };
}
