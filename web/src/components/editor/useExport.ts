'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  buildReport,
  checkEnvironment,
  probeConfigFromPlan,
  probeSource,
  type CapabilityReportV1,
} from '@/adapters/exportCapability';
import { recordCapability, recordError } from '@/adapters/diagnostics';
import { ExportWorkerClient } from '@/adapters/export/exportClient';
import { exportLog } from '@/adapters/exportLogStore';
import { removeExportEntry, sweepExportEntries } from '@/adapters/export/opfsEntries';
import type { ExportFailureCode, ExportResult, StorageShortfall } from '@/domain/exportEvents';
import type { Project } from '@/domain/edl';
import { exportLogEntry, type AttemptEnd } from '@/domain/exportLog';
import { WEB_LOCAL_POLICY } from '@/domain/policy';
import { compileRenderPlan, type PlanRejection, type RenderPlan } from '@/domain/renderPlan';

export type ExportUiState =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'ready'; report: CapabilityReportV1 }
  | {
      phase: 'blocked';
      report: CapabilityReportV1 | null;
      /** `source_missing` is a UI state, not a compiler verdict. */
      planRejection: PlanRejection | 'source_missing' | null;
    }
  | {
      phase: 'running';
      step: 'preparing' | 'encoding' | 'finalizing' | 'verifying';
      progress: number | null;
      framesDone: number;
      totalFrames: number;
    }
  | { phase: 'succeeded'; result: ExportResult; url: string; fileName: string }
  | {
      phase: 'failed';
      code: ExportFailureCode;
      /** The caption line to shorten, numbered as the user sees the list. */
      captionCue?: { index: number; text: string };
      /** Needed vs reported free space, with `output_storage_insufficient`. */
      storage?: StorageShortfall;
    }
  | { phase: 'canceled' };

function safeBaseName(name: string): string {
  const withoutExtension = name.replace(/\.[^.]+$/, '');
  const cleaned = withoutExtension.replace(/[^\p{L}\p{N}\-_ ]/gu, '').trim();
  return (cleaned || 'clip').slice(0, 60);
}

export function useExport(project: Project, videoFile: File | null, audioFile: File | null) {
  const [state, setState] = useState<ExportUiState>({ phase: 'idle' });
  const clientRef = useRef<ExportWorkerClient | null>(null);
  const urlRef = useRef<string | null>(null);
  /** OPFS entry behind the offered download, if the disk route was used. */
  const entryRef = useRef<string | null>(null);

  /**
   * Stops offering the previous result. For the disk route this also deletes
   * the temporary file, so exports never pile up in the user's storage.
   */
  const releaseUrl = useCallback(() => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    if (entryRef.current) {
      const name = entryRef.current;
      entryRef.current = null;
      void removeExportEntry(name);
    }
  }, []);

  useEffect(() => {
    // A tab closed right after an export never gets to delete its temporary
    // file. Old leftovers are removed whenever the editor opens, not only when
    // the next export starts, so they do not sit in the user's storage.
    void sweepExportEntries().catch(() => 0);
    return () => {
      releaseUrl();
      clientRef.current?.dispose();
      clientRef.current = null;
    };
  }, [releaseUrl]);

  const client = useCallback(() => {
    if (!clientRef.current) clientRef.current = new ExportWorkerClient();
    return clientRef.current;
  }, []);

  /** Runs the capability gate for the current project. Safe to call repeatedly. */
  const check = useCallback(async () => {
    releaseUrl();
    setState({ phase: 'checking' });

    const compiled = compileRenderPlan(project, WEB_LOCAL_POLICY);
    if (!compiled.ok) {
      recordError('plan', compiled.reason);
      setState({ phase: 'blocked', report: null, planRejection: compiled.reason });
      return;
    }
    if (!videoFile) {
      // The recipe is fine; the file just is not open in this tab. Still worth
      // a code in the session record: it is what the user saw instead of export.
      recordError('plan', 'source_missing');
      setState({ phase: 'blocked', report: null, planRejection: 'source_missing' });
      return;
    }

    const environment = checkEnvironment();
    try {
      const encoder = await client().checkCapability(probeConfigFromPlan(compiled.plan), {
        withCaptionFont: compiled.plan.captions !== null,
      });
      const source = await probeSource(videoFile, audioFile);
      const report = buildReport(environment, encoder, source);
      recordCapability(report);
      setState(report.canExport ? { phase: 'ready', report } : { phase: 'blocked', report, planRejection: null });
    } catch {
      const report = buildReport(environment, null, null);
      recordCapability(report);
      recordError('capability', 'worker_unavailable');
      setState({ phase: 'blocked', report, planRejection: null });
    }
  }, [audioFile, client, project, releaseUrl, videoFile]);

  const start = useCallback(async () => {
    if (!videoFile) {
      setState({ phase: 'blocked', report: null, planRejection: 'source_missing' });
      return;
    }
    const compiled = compileRenderPlan(project, WEB_LOCAL_POLICY);
    if (!compiled.ok) {
      setState({ phase: 'blocked', report: null, planRejection: compiled.reason });
      return;
    }
    const plan: RenderPlan = compiled.plan;

    releaseUrl();
    // Every attempt that starts ends in exactly one log entry (see
    // domain/exportLog.ts for what an entry may hold). Best effort: a browser
    // that refuses the write must not turn the export itself into a failure.
    const startedAt = performance.now();
    const logAttempt = (end: AttemptEnd) => {
      void exportLog().append(exportLogEntry(plan, end, performance.now() - startedAt, new Date()));
    };
    setState({
      phase: 'running',
      step: 'preparing',
      progress: null,
      framesDone: 0,
      totalFrames: plan.totalFrames,
    });

    for await (const event of client().export(plan, videoFile, audioFile, {
      memoryRouteLimitUs: WEB_LOCAL_POLICY.maxMemoryRouteOutputDurationUs,
    })) {
      switch (event.type) {
        case 'preparing':
          setState({
            phase: 'running',
            step: 'preparing',
            progress: null,
            framesDone: 0,
            totalFrames: plan.totalFrames,
          });
          break;
        case 'encoding':
          setState({
            phase: 'running',
            step: 'encoding',
            progress: event.progress,
            framesDone: event.framesDone,
            totalFrames: event.totalFrames,
          });
          break;
        case 'finalizing':
        case 'verifying':
          setState({
            phase: 'running',
            step: event.type,
            // These phases cannot be measured, so no percentage is shown.
            progress: null,
            framesDone: plan.totalFrames,
            totalFrames: plan.totalFrames,
          });
          break;
        case 'succeeded': {
          // The disk route hands over a disk-backed File: no copy into memory.
          const blob =
            event.output.kind === 'opfs'
              ? event.output.file
              : new Blob([event.output.data as BlobPart], { type: 'video/mp4' });
          if (event.output.kind === 'opfs') entryRef.current = event.output.entryName;
          const url = URL.createObjectURL(blob);
          urlRef.current = url;
          logAttempt({
            outcome: 'succeeded',
            measuredDurationUs: event.result.probe.durationUs,
            width: event.result.probe.width,
            height: event.result.probe.height,
            route: event.result.route,
          });
          setState({
            phase: 'succeeded',
            result: event.result,
            url,
            fileName: `${safeBaseName(videoFile.name)}-clip.mp4`,
          });
          break;
        }
        case 'failed': {
          // The worker names the cue by id; the user knows it by its place
          // in the caption list.
          const cues = project.captionTracks[0]?.cues ?? [];
          const position = event.cueId ? cues.findIndex((cue) => cue.cueId === event.cueId) : -1;
          const cue = position >= 0 ? cues[position] : undefined;
          recordError('export', event.code);
          logAttempt({ outcome: 'failed', code: event.code });
          setState({
            phase: 'failed',
            code: event.code,
            ...(cue ? { captionCue: { index: position + 1, text: cue.text } } : {}),
            ...(event.storage ? { storage: event.storage } : {}),
          });
          break;
        }
        case 'canceled':
          logAttempt({ outcome: 'canceled' });
          setState({ phase: 'canceled' });
          break;
      }
    }
  }, [audioFile, client, project, releaseUrl, videoFile]);

  const cancel = useCallback(() => {
    clientRef.current?.cancel();
  }, []);

  const reset = useCallback(() => {
    releaseUrl();
    setState({ phase: 'idle' });
  }, [releaseUrl]);

  const isRunning = state.phase === 'running';

  // A half-finished encode is real work in progress; warn before losing it.
  useEffect(() => {
    if (!isRunning) return undefined;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isRunning]);

  return { state, check, start, cancel, reset, isRunning };
}
