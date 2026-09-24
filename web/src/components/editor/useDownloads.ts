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
import type { Project } from '@/domain/edl';
import type { ExportFailureCode, ExportResult, StorageShortfall } from '@/domain/exportEvents';
import { exportLogEntry, type AttemptEnd } from '@/domain/exportLog';
import {
  downloadKind,
  downloadRecipe,
  suggestedFileName,
  targetKey,
  type DownloadKind,
  type DownloadTarget,
  type KesitSettings,
} from '@/domain/kesit';
import { WEB_LOCAL_POLICY, outputOverrun, type OutputOverrun } from '@/domain/policy';
import { compileRenderPlan, type PlanRejection, type RenderPlan } from '@/domain/renderPlan';
import { totalOutputDurationUs } from '@/domain/timeline';

/**
 * One download button's state (ADR-026). Every state names the recipe
 * (`fingerprint`) it was made for, so a result is not shown on a kesit that
 * has changed since.
 */
export type DownloadState =
  | {
      phase: 'running';
      step: 'waiting' | 'preparing' | 'encoding' | 'finalizing' | 'verifying';
      progress: number | null;
      framesDone: number;
      totalFrames: number;
      /** The name picked in the save dialog; null on the fallback route. */
      fileName: string | null;
    }
  /** Written straight into the file the user picked. Nothing else to do. */
  | { phase: 'saved'; fileName: string; result: ExportResult; hdr: boolean }
  /** Fallback route (no save dialog): the file waits for "Bilgisayara kaydet". */
  | { phase: 'ready'; url: string; fileName: string; result: ExportResult; hdr: boolean }
  | {
      phase: 'blocked';
      /** `source_missing` and `capability` are UI states, not compiler verdicts. */
      reason: PlanRejection | 'source_missing' | 'capability';
      overrun: OutputOverrun | null;
      report: CapabilityReportV1 | null;
    }
  | {
      phase: 'failed';
      code: ExportFailureCode;
      /** The caption line to shorten, numbered as the user sees the list. */
      captionCue?: { index: number; text: string };
      storage?: StorageShortfall;
      /** The memory route's 5-minute sentence (ADR-021) for its refusals. */
      overrun: OutputOverrun | null;
    }
  | { phase: 'canceled' };

/**
 * `fingerprint`: the render plan the state belongs to (a finished file stays
 * shown while its kesit is unchanged). `revision`: the recipe revision when
 * it was set (a refusal is shown until the next edit).
 */
export type DownloadEntry = { key: string; kind: DownloadKind; fingerprint: string; revision: number } & DownloadState;

/** Whether a stored state still describes the download the button would make now. */
export function entryIsCurrent(entry: DownloadEntry, fingerprint: string | null, revision: number): boolean {
  if (entry.phase === 'running') return true;
  if (entry.phase === 'saved' || entry.phase === 'ready') return entry.fingerprint === fingerprint;
  return entry.revision === revision;
}

/** The save dialog of the File System Access API (Chromium). */
type SavePicker = (options: {
  suggestedName?: string;
  types?: Array<{ description: string; accept: Record<string, string[]> }>;
}) => Promise<FileSystemFileHandle>;

function savePicker(): SavePicker | null {
  const picker = (globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  return typeof picker === 'function' ? (picker as SavePicker).bind(globalThis) : null;
}

/** Whether the ⬇ buttons save straight to a file (true) or offer "Bilgisayara kaydet" after. */
export function canPickSaveFile(): boolean {
  return savePicker() !== null;
}

type CapabilityCheck = { key: string; promise: Promise<CapabilityReportV1> };

/**
 * The gate's encoder check depends on these, and only on these. The caption
 * font is checked whenever the project has lines at all, so one answer serves
 * every download of the project (a kesit without lines included).
 */
function capabilityKey(plan: RenderPlan, withFont: boolean, videoFile: File, audioFile: File | null): string {
  return [
    plan.width,
    plan.height,
    plan.fpsNum,
    plan.fpsDen,
    plan.videoBitrate,
    plan.audioBitrate,
    withFont ? 'font' : '-',
    videoFile.name,
    videoFile.size,
    videoFile.lastModified,
    audioFile ? `${audioFile.name}:${audioFile.size}` : '-',
  ].join('|');
}

interface Args {
  project: Project;
  settings: KesitSettings;
  videoFile: File | null;
  audioFile: File | null;
  videoName: string | null;
}

/**
 * The download buttons (ADR-026).
 *
 * Pressing ⬇ opens the browser's save dialog at once — `showSaveFilePicker`
 * must run inside the click, before anything is awaited — with a suggested
 * name, and the encoder then writes straight into the chosen file. Where the
 * browser has no save dialog, the proven OPFS/memory route runs and the file
 * is offered with "Bilgisayara kaydet" afterwards.
 *
 * The capability gate (doc 11: encoder configuration, a tiny self-test, the
 * source, HDR) takes a moment, so it runs in the background as soon as a
 * video is open and its answer is kept per encoder configuration. A press
 * only waits for it if it has not finished yet.
 */
export function useDownloads({ project, settings, videoFile, audioFile, videoName }: Args) {
  const [entries, setEntries] = useState<Record<string, DownloadEntry>>({});
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [capability, setCapability] = useState<{ key: string; report: CapabilityReportV1 } | null>(null);
  const clientRef = useRef<ExportWorkerClient | null>(null);
  const checkRef = useRef<CapabilityCheck | null>(null);
  const urlsRef = useRef<Map<string, string>>(new Map());
  const entryNamesRef = useRef<Set<string>>(new Set());
  const busyRef = useRef(false);
  /** "İptal et" pressed while the gate was still running: the encode must not start. */
  const cancelRequestedRef = useRef(false);

  const client = useCallback(() => {
    clientRef.current ??= new ExportWorkerClient();
    return clientRef.current;
  }, []);

  /** Stops offering fallback-route files: their URLs and temporary OPFS files go. */
  const releaseOffered = useCallback(() => {
    for (const url of urlsRef.current.values()) URL.revokeObjectURL(url);
    urlsRef.current.clear();
    for (const name of entryNamesRef.current) void removeExportEntry(name);
    entryNamesRef.current.clear();
    setEntries((current) => {
      const next: Record<string, DownloadEntry> = {};
      for (const [key, entry] of Object.entries(current)) if (entry.phase !== 'ready') next[key] = entry;
      return next;
    });
  }, []);

  useEffect(() => {
    // A tab closed right after an export never deletes its temporary file;
    // old leftovers are removed whenever the editor opens.
    void sweepExportEntries().catch(() => 0);
    const urls = urlsRef.current;
    const names = entryNamesRef.current;
    return () => {
      for (const url of urls.values()) URL.revokeObjectURL(url);
      for (const name of names) void removeExportEntry(name);
      clientRef.current?.dispose();
      clientRef.current = null;
    };
  }, []);

  /** Runs (or reuses) the capability gate for one plan's encoder configuration. */
  const ensureCapability = useCallback(
    (plan: RenderPlan, withFont: boolean, video: File, music: File | null): Promise<CapabilityReportV1> => {
      const key = capabilityKey(plan, withFont, video, music);
      if (checkRef.current?.key === key) return checkRef.current.promise;
      const promise = (async () => {
        const environment = checkEnvironment();
        try {
          // The source first: an HDR file adds the tone-mapping check.
          const source = await probeSource(video, music);
          const encoder = await client().checkCapability(probeConfigFromPlan(plan), {
            withCaptionFont: withFont,
            hdrTransfer: source.hdrTransfer,
          });
          const report = buildReport(environment, encoder, source);
          recordCapability(report);
          return report;
        } catch {
          const report = buildReport(environment, null, null);
          recordCapability(report);
          recordError('capability', 'worker_unavailable');
          return report;
        }
      })();
      checkRef.current = { key, promise };
      void promise.then((report) => {
        if (checkRef.current?.key === key) setCapability({ key, report });
      });
      return promise;
    },
    [client],
  );

  // The background check: once a video is open, and again when the output
  // size, the frame or the captions change what the encoder must do.
  const withFont = (project.captionTracks[0]?.cues.length ?? 0) > 0;
  // Any one second of the video gives the same encoder configuration as every
  // download of this project: size, frame rate and bit rates are the project's.
  const allRecipe = downloadRecipe(project, { kind: 'all' }, settings);
  const firstClip = allRecipe?.clips[0];
  const backgroundPlan =
    allRecipe && firstClip
      ? compileRenderPlan(
          {
            ...allRecipe,
            clips: [{ ...firstClip, sourceOutUs: Math.min(firstClip.sourceOutUs, firstClip.sourceInUs + 1_000_000) }],
          },
          WEB_LOCAL_POLICY,
        )
      : null;
  const backgroundKey =
    backgroundPlan?.ok && videoFile ? capabilityKey(backgroundPlan.plan, withFont, videoFile, audioFile) : null;
  const backgroundRef = useRef<RenderPlan | null>(null);
  useEffect(() => {
    backgroundRef.current = backgroundPlan?.ok ? backgroundPlan.plan : null;
  });
  useEffect(() => {
    if (!backgroundKey || !videoFile) return undefined;
    // A short pause so a burst of changes (dragging the zoom slider) checks once.
    const timer = window.setTimeout(() => {
      const plan = backgroundRef.current;
      if (plan && !busyRef.current) void ensureCapability(plan, withFont, videoFile, audioFile);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [audioFile, backgroundKey, ensureCapability, videoFile, withFont]);

  const setEntry = useCallback((key: string, entry: DownloadEntry | null) => {
    setEntries((current) => {
      const next = { ...current };
      if (entry) next[key] = entry;
      else delete next[key];
      return next;
    });
  }, []);

  /**
   * Starts one download. MUST be called synchronously from the click: the
   * save dialog is opened before the first `await`.
   */
  const start = useCallback(
    (target: DownloadTarget) => {
      if (busyRef.current) return;
      const key = targetKey(target);
      const kind = downloadKind(project, target);
      const revision = project.revision;
      const recipe = downloadRecipe(project, target, settings);
      const blocked = (
        reason: Extract<DownloadState, { phase: 'blocked' }>['reason'],
        fingerprint: string,
        extra: { overrun?: OutputOverrun | null; report?: CapabilityReportV1 | null } = {},
      ) => {
        recordError('plan', reason);
        setEntry(key, {
          key,
          kind,
          fingerprint,
          revision,
          phase: 'blocked',
          reason,
          overrun: extra.overrun ?? null,
          report: extra.report ?? null,
        });
      };
      if (!recipe) {
        blocked(videoFile ? 'no_clips' : 'source_missing', 'none');
        return;
      }
      const compiled = compileRenderPlan(recipe, WEB_LOCAL_POLICY);
      if (!compiled.ok) {
        // ADR-021: the output limit is the download's gate, said with the
        // same sentence as before, for this one download.
        const overrun =
          compiled.reason === 'output_duration_exceeds_policy'
            ? outputOverrun(totalOutputDurationUs(recipe), WEB_LOCAL_POLICY.maxOutputDurationUs)
            : null;
        blocked(compiled.reason, 'none', { overrun });
        return;
      }
      const plan = compiled.plan;
      if (!videoFile) {
        blocked('source_missing', plan.fingerprint);
        return;
      }
      const known =
        capability && capability.key === capabilityKey(plan, withFont, videoFile, audioFile) ? capability.report : null;
      if (known && !known.canExport) {
        blocked('capability', plan.fingerprint, { report: known });
        return;
      }

      const clip = target.kind === 'kesit' ? project.clips.find((item) => item.clipId === target.clipId) : undefined;
      const fileName = suggestedFileName(
        videoName ?? videoFile.name,
        clip
          ? { kind: 'kesit', sourceInUs: clip.sourceInUs, sourceOutUs: clip.sourceOutUs }
          : kind === 'kesit' && project.clips[0]
            ? { kind: 'kesit', sourceInUs: project.clips[0].sourceInUs, sourceOutUs: project.clips[0].sourceOutUs }
            : kind === 'merged'
              ? { kind: 'merged', count: project.clips.length }
              : { kind: 'whole' },
      );

      // Inside the click, before any await (user activation).
      const picker = savePicker();
      let picked: Promise<FileSystemFileHandle | null>;
      try {
        picked = picker
          ? picker({
              suggestedName: fileName,
              types: [{ description: 'MP4 video', accept: { 'video/mp4': ['.mp4'] } }],
            })
          : Promise.resolve(null);
      } catch (error) {
        picked = Promise.reject(error);
      }

      busyRef.current = true;
      cancelRequestedRef.current = false;
      setActiveKey(key);

      const run = async () => {
        let destination: FileSystemFileHandle | null = null;
        try {
          destination = await picked;
        } catch (error) {
          // The user closed the dialog: nothing happens, nothing is said.
          if (error instanceof DOMException && error.name === 'AbortError') return;
          // Any other refusal of the dialog: the fallback route still works.
          destination = null;
        }

        setEntry(key, {
          key,
          kind,
          fingerprint: plan.fingerprint,
                revision,
          phase: 'running',
          step: 'waiting',
          progress: null,
          framesDone: 0,
          totalFrames: plan.totalFrames,
          fileName: destination?.name ?? null,
        });

        const report = await ensureCapability(plan, withFont, videoFile, audioFile);
        if (cancelRequestedRef.current) {
          if (destination) await removeEmptyPick(destination);
          setEntry(key, { key, kind, fingerprint: plan.fingerprint, revision, phase: 'canceled' });
          return;
        }
        if (!report.canExport) {
          // The dialog already created the (empty) chosen file; take it back.
          if (destination) await removeEmptyPick(destination);
          blocked('capability', plan.fingerprint, { report });
          return;
        }

        // A new export ends what the worker still offers from the last one.
        releaseOffered();
        const startedAt = performance.now();
        const logAttempt = (end: AttemptEnd) => {
          void exportLog().append(exportLogEntry(plan, end, performance.now() - startedAt, new Date()));
        };
        const hdr = report.source?.isHdr === true;
        const running = (
          step: Extract<DownloadState, { phase: 'running' }>['step'],
          progress: number | null,
          framesDone: number,
        ) =>
          setEntry(key, {
            key,
            kind,
            fingerprint: plan.fingerprint,
                revision,
            phase: 'running',
            step,
            progress,
            framesDone,
            totalFrames: plan.totalFrames,
            fileName: destination?.name ?? null,
          });

        for await (const event of client().export(plan, videoFile, audioFile, {
          memoryRouteLimitUs: WEB_LOCAL_POLICY.maxMemoryRouteOutputDurationUs,
          destination,
        })) {
          switch (event.type) {
            case 'preparing':
              running('preparing', null, 0);
              if (cancelRequestedRef.current) client().cancel();
              break;
            case 'encoding':
              running('encoding', event.progress, event.framesDone);
              break;
            case 'finalizing':
            case 'verifying':
              running(event.type, null, plan.totalFrames);
              break;
            case 'succeeded': {
              logAttempt({
                outcome: 'succeeded',
                measuredDurationUs: event.result.probe.durationUs,
                width: event.result.probe.width,
                height: event.result.probe.height,
                route: event.result.route,
              });
              if (event.output.kind === 'file') {
                setEntry(key, {
                  key,
                  kind,
                  fingerprint: plan.fingerprint,
                revision,
                  phase: 'saved',
                  fileName: event.output.fileName,
                  result: event.result,
                  hdr,
                });
                break;
              }
              // The disk route hands over a disk-backed File: no copy into memory.
              const blob =
                event.output.kind === 'opfs'
                  ? event.output.file
                  : new Blob([event.output.data as BlobPart], { type: 'video/mp4' });
              if (event.output.kind === 'opfs') entryNamesRef.current.add(event.output.entryName);
              const url = URL.createObjectURL(blob);
              urlsRef.current.set(key, url);
              setEntry(key, {
                key,
                kind,
                fingerprint: plan.fingerprint,
                revision,
                phase: 'ready',
                url,
                fileName,
                result: event.result,
                hdr,
              });
              break;
            }
            case 'failed': {
              // The worker names a caption line by id; the user knows it by
              // its place in the caption list.
              const cues = project.captionTracks[0]?.cues ?? [];
              const position = event.cueId ? cues.findIndex((cue) => cue.cueId === event.cueId) : -1;
              const cue = position >= 0 ? cues[position] : undefined;
              recordError('export', event.code);
              logAttempt({ outcome: 'failed', code: event.code });
              const memoryRefusal =
                event.code === 'output_too_long_for_memory' ||
                (event.code === 'output_storage_insufficient' && event.storage?.reason !== 'file_reservation');
              setEntry(key, {
                key,
                kind,
                fingerprint: plan.fingerprint,
                revision,
                phase: 'failed',
                code: event.code,
                ...(cue ? { captionCue: { index: position + 1, text: cue.text } } : {}),
                ...(event.storage ? { storage: event.storage } : {}),
                overrun: memoryRefusal
                  ? outputOverrun(plan.requestedDurationUs, WEB_LOCAL_POLICY.maxMemoryRouteOutputDurationUs)
                  : null,
              });
              break;
            }
            case 'canceled':
              logAttempt({ outcome: 'canceled' });
              setEntry(key, { key, kind, fingerprint: plan.fingerprint,
                revision, phase: 'canceled' });
              break;
          }
        }
      };

      void run().finally(() => {
        busyRef.current = false;
        setActiveKey(null);
      });
    },
    [
      audioFile,
      capability,
      client,
      ensureCapability,
      project,
      releaseOffered,
      setEntry,
      settings,
      videoFile,
      videoName,
      withFont,
    ],
  );

  const cancel = useCallback(() => {
    // Before the encode starts there is nothing in the worker to stop yet.
    cancelRequestedRef.current = true;
    clientRef.current?.cancel();
  }, []);

  /** Forgets a finished state (the × on a message). */
  const dismiss = useCallback(
    (key: string) => {
      const url = urlsRef.current.get(key);
      if (url) {
        URL.revokeObjectURL(url);
        urlsRef.current.delete(key);
      }
      setEntry(key, null);
    },
    [setEntry],
  );

  const running = activeKey !== null;
  // A half-finished encode is real work in progress; warn before losing it.
  useEffect(() => {
    if (!running) return undefined;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [running]);

  return { entries, activeKey, start, cancel, dismiss, capability: capability?.report ?? null };
}

/** The save dialog creates the chosen file; if it is still empty, remove it again. */
async function removeEmptyPick(handle: FileSystemFileHandle): Promise<void> {
  try {
    const file = await handle.getFile();
    const removable = handle as FileSystemFileHandle & { remove?: () => Promise<void> };
    if (file.size === 0) await removable.remove?.();
  } catch {
    // Nothing to clean up, or no permission to; the file is empty either way.
  }
}

export type Downloads = ReturnType<typeof useDownloads>;
