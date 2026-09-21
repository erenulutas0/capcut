'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  buildReport,
  checkEnvironment,
  probeConfigFromPlan,
  probeSource,
  type CapabilityReportV1,
} from '@/adapters/exportCapability';
import { ExportWorkerClient } from '@/adapters/export/exportClient';
import type { ExportFailureCode, ExportResult } from '@/domain/exportEvents';
import type { ProjectV1 } from '@/domain/edl';
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
  | { phase: 'failed'; code: ExportFailureCode }
  | { phase: 'canceled' };

function safeBaseName(name: string): string {
  const withoutExtension = name.replace(/\.[^.]+$/, '');
  const cleaned = withoutExtension.replace(/[^\p{L}\p{N}\-_ ]/gu, '').trim();
  return (cleaned || 'clip').slice(0, 60);
}

export function useExport(project: ProjectV1, videoFile: File | null, audioFile: File | null) {
  const [state, setState] = useState<ExportUiState>({ phase: 'idle' });
  const clientRef = useRef<ExportWorkerClient | null>(null);
  const urlRef = useRef<string | null>(null);

  const releaseUrl = useCallback(() => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, []);

  useEffect(
    () => () => {
      releaseUrl();
      clientRef.current?.dispose();
      clientRef.current = null;
    },
    [releaseUrl],
  );

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
      setState({ phase: 'blocked', report: null, planRejection: compiled.reason });
      return;
    }
    if (!videoFile) {
      // The recipe is fine; the file just is not open in this tab.
      setState({ phase: 'blocked', report: null, planRejection: 'source_missing' });
      return;
    }

    const environment = checkEnvironment();
    try {
      const encoder = await client().checkCapability(probeConfigFromPlan(compiled.plan));
      const source = await probeSource(videoFile, audioFile);
      const report = buildReport(environment, encoder, source);
      setState(report.canExport ? { phase: 'ready', report } : { phase: 'blocked', report, planRejection: null });
    } catch {
      const report = buildReport(environment, null, null);
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
    setState({
      phase: 'running',
      step: 'preparing',
      progress: null,
      framesDone: 0,
      totalFrames: plan.totalFrames,
    });

    for await (const event of client().export(plan, videoFile, audioFile)) {
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
          const blob = new Blob([event.data as BlobPart], { type: 'video/mp4' });
          const url = URL.createObjectURL(blob);
          urlRef.current = url;
          setState({
            phase: 'succeeded',
            result: event.result,
            url,
            fileName: `${safeBaseName(videoFile.name)}-clip.mp4`,
          });
          break;
        }
        case 'failed':
          setState({ phase: 'failed', code: event.code });
          break;
        case 'canceled':
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
