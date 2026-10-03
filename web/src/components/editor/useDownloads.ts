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
import { encoderKindLookup, type EncoderKindLookup } from '@/adapters/export/encoderKind';
import { ExportWorkerClient } from '@/adapters/export/exportClient';
import type { TargetSizeExport } from '@/adapters/export/protocol';
import { exportLog } from '@/adapters/exportLogStore';
import { removeExportEntry, sweepExportEntries } from '@/adapters/export/opfsEntries';
import { setAppBusy } from '@/adapters/pwa/serviceWorker';
import { shareVerdictFor, shareVideo } from '@/adapters/share';
import type { Project } from '@/domain/edl';
import type { ExportFailureCode, ExportResult, StorageShortfall, TargetSizeShortfall } from '@/domain/exportEvents';
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
import type { ShareVerdict } from '@/domain/share';
import { audioFileName, audioOnlyRecipe } from '@/domain/audioOnly';
import {
  estimateEncodeSeconds,
  maxTargetShortEdge,
  nativeShortEdge,
  planForTargetSize,
  planTargetSize,
  targetSizeFacts,
  type TargetSizeDecision,
  type TargetSizeRefusal,
  type TargetSizeRequest,
} from '@/domain/targetSize';
import { totalOutputDurationUs } from '@/domain/timeline';

/**
 * What a download should produce besides the ordinary video (ADR-035). The
 * task screens pass it to `start`; nothing passed is the ordinary download.
 */
export interface DownloadOptions {
  /** `audio`: only the sound of the selected ranges, as an .m4a file. Default `video`. */
  output?: 'video' | 'audio';
  /** The video must come out at or under `targetBytes` (see `SIZE_PRESETS`). Ignored for `audio`. */
  targetSize?: TargetSizeRequest;
}

/** What a target-size download would be, known before anything is encoded. */
export type TargetSizePreview =
  | {
      ok: true;
      /** Resolution, bitrates and `plannedBytes` ("≈ 48 MB, 720p"). */
      decision: TargetSizeDecision;
      durationUs: number;
      /** A rough encode time in seconds on this kind of encoder (ADR-035 says how rough). */
      estimatedSeconds: number;
    }
  /** The target cannot be met: `refusal.minBytes` is the smallest that can, `maxDurationUs` the longest that fits. */
  | { ok: false; reason: 'target_too_small'; refusal: TargetSizeRefusal }
  /** There is nothing to download (no video, no kesit, over the output limit). */
  | { ok: false; reason: 'unavailable' };

/**
 * Test hook only (`window.__clipExportOptions`): the options a press of the
 * ordinary download button should use, so e2e tests and the matrix can drive
 * a target-size or sound-only download through the real button. `forced` is
 * for measurements (an exact size and bitrate, encoded once). The app never
 * sets it.
 */
interface ExportOptionsHook extends DownloadOptions {
  forced?: TargetSizeExport['forced'];
}

function hookOptions(): ExportOptionsHook | null {
  const value = (globalThis as { __clipExportOptions?: unknown }).__clipExportOptions;
  return typeof value === 'object' && value !== null ? (value as ExportOptionsHook) : null;
}

/**
 * The finished video, ready for the system share sheet (ADR-031): the `File`
 * is made when the result arrives, so "Paylaş" can call `navigator.share`
 * straight from the click. `failed`: the last attempt was refused.
 */
export interface ShareOffer {
  verdict: Exclude<ShareVerdict, 'unsupported'>;
  file: File;
  failed: boolean;
}

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
      /** ADR-035: above 1 while a target-size download is encoded again to fit. */
      pass: number;
      /** ADR-035: `audio` while a sound-only file is being made. */
      output: 'video' | 'audio';
    }
  /** Written straight into the file the user picked. Nothing else to do. */
  | { phase: 'saved'; fileName: string; result: ExportResult; hdr: boolean; share: ShareOffer | null }
  /** Fallback route (no save dialog): the file waits for "Bilgisayara kaydet" / "Kaydet". */
  | { phase: 'ready'; url: string; fileName: string; result: ExportResult; hdr: boolean; share: ShareOffer | null }
  | {
      phase: 'blocked';
      /**
       * `source_missing` and `capability` are UI states, not compiler verdicts.
       * ADR-035: `no_audio_track` (sound-only download of a video without
       * sound) and `target_size_too_small` are refused before the save dialog.
       */
      reason: PlanRejection | 'source_missing' | 'capability' | 'no_audio_track' | 'target_size_too_small';
      overrun: OutputOverrun | null;
      report: CapabilityReportV1 | null;
      /** With `target_size_too_small`: the target and what would work instead. */
      targetSize?: TargetSizeShortfall;
    }
  | {
      phase: 'failed';
      code: ExportFailureCode;
      /** The caption line to shorten, numbered as the user sees the list. */
      captionCue?: { index: number; text: string };
      storage?: StorageShortfall;
      /** With `target_size_too_small` (ADR-035). */
      targetSize?: TargetSizeShortfall;
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

/**
 * What a caller may add to the export request beyond what every download
 * sets (ADR-034: the task wizards). The type follows the export client's own
 * options, so an option added there (a size target, audio-only output) can be
 * passed from a wizard without touching this hook.
 */
export type ExportExtras = Omit<
  Parameters<ExportWorkerClient['export']>[3],
  'memoryRouteLimitUs' | 'destination' | 'output' | 'targetSize'
> &
  DownloadOptions;

interface Args {
  project: Project;
  settings: KesitSettings;
  videoFile: File | null;
  audioFile: File | null;
  videoName: string | null;
  /** The name the save dialog suggests, instead of the kesit-based one (the task wizards). */
  fileName?: string | null;
  /** Extra options for the export request (the task wizards); none in the editor. */
  exportExtras?: ExportExtras;
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
export function useDownloads({
  project,
  settings,
  videoFile,
  audioFile,
  videoName,
  fileName: fileNameOverride = null,
  exportExtras,
}: Args) {
  const [entries, setEntries] = useState<Record<string, DownloadEntry>>({});
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [capability, setCapability] = useState<{ key: string; report: CapabilityReportV1 } | null>(null);
  const clientRef = useRef<ExportWorkerClient | null>(null);
  const checkRef = useRef<CapabilityCheck | null>(null);
  const urlsRef = useRef<Map<string, string>>(new Map());
  /** The OPFS file behind each offered (fallback-route) result, by entry key. */
  const entryNamesRef = useRef<Map<string, string>>(new Map());
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
    for (const name of entryNamesRef.current.values()) void removeExportEntry(name);
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
      for (const name of names.values()) void removeExportEntry(name);
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

  // ADR-035: which encoder this browser has at each size the target-size
  // planner may pick, asked once per frame shape so a press can refuse an
  // impossible target before the save dialog opens.
  const { aspect } = project.canvas;
  const { fpsNum, fpsDen } = project.export;
  const kindsRef = useRef<{ key: string; lookup: EncoderKindLookup } | null>(null);
  const kindsKey = `${aspect}|${fpsNum}/${fpsDen}`;
  useEffect(() => {
    let live = true;
    void encoderKindLookup(aspect, fpsNum, fpsDen).then((lookup) => {
      if (live) kindsRef.current = { key: kindsKey, lookup };
    });
    return () => {
      live = false;
    };
  }, [aspect, fpsDen, fpsNum, kindsKey]);

  /** Whether a download of `plan` would have any sound (the worker asks the file itself). */
  const planHasAudio = useCallback(
    (plan: RenderPlan): boolean => {
      const asset = project.assets.find((item) => item.kind === 'video');
      return (plan.audio.wantsSourceAudio && asset?.hasAudio !== false) || (plan.audio.music !== null && audioFile !== null);
    },
    [audioFile, project.assets],
  );

  /**
   * What a target-size download of `target` would be — resolution, expected
   * size, rough time — or why it cannot be made. Encodes nothing.
   */
  const previewTargetSize = useCallback(
    async (target: DownloadTarget, request: TargetSizeRequest): Promise<TargetSizePreview> => {
      const recipe = downloadRecipe(project, target, settings);
      const compiled = recipe ? compileRenderPlan(recipe, WEB_LOCAL_POLICY) : null;
      if (!compiled?.ok) return { ok: false, reason: 'unavailable' };
      const plan = compiled.plan;
      const lookup = await encoderKindLookup(plan.aspect, plan.fpsNum, plan.fpsDen);
      const planned = planTargetSize(
        request,
        targetSizeFacts(plan, {
          maxShortEdge: maxTargetShortEdge(project.export.shortEdge, nativeShortEdge(plan)),
          hasAudio: planHasAudio(plan),
          encoderKind: lookup,
        }),
      );
      if (!planned.ok) return { ok: false, reason: 'target_too_small', refusal: planned };
      return {
        ok: true,
        decision: planned,
        durationUs: plan.expectedDurationUs,
        estimatedSeconds: estimateEncodeSeconds(planned, plan.totalFrames),
      };
    },
    [planHasAudio, project, settings],
  );

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
    (target: DownloadTarget, requested?: DownloadOptions) => {
      if (busyRef.current) return;
      // What to make: the caller's options for this press, else the hook's
      // own (`exportExtras`: a wizard such as "Küçült" or "Sesini al"), else
      // the test hook, else the ordinary video.
      const { output: extrasOutput, targetSize: extrasTargetSize, ...otherExtras } = exportExtras ?? {};
      const fromExtras: DownloadOptions | null =
        extrasOutput !== undefined || extrasTargetSize !== undefined
          ? {
              ...(extrasOutput !== undefined ? { output: extrasOutput } : {}),
              ...(extrasTargetSize !== undefined ? { targetSize: extrasTargetSize } : {}),
            }
          : null;
      const hook = requested || fromExtras ? null : hookOptions();
      const options: DownloadOptions = requested ?? fromExtras ?? hook ?? {};
      const audioOnly = options.output === 'audio';
      const key = targetKey(target);
      const kind = downloadKind(project, target);
      const revision = project.revision;
      const recipe = downloadRecipe(project, target, settings);
      const blocked = (
        reason: Extract<DownloadState, { phase: 'blocked' }>['reason'],
        fingerprint: string,
        extra: {
          overrun?: OutputOverrun | null;
          report?: CapabilityReportV1 | null;
          targetSize?: TargetSizeShortfall;
        } = {},
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
          ...(extra.targetSize ? { targetSize: extra.targetSize } : {}),
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
      // ADR-035, sound only: a video without sound (and no music) is refused
      // here, before the save dialog. The worker asks the file itself again.
      if (audioOnly && !planHasAudio(plan)) {
        blocked('no_audio_track', plan.fingerprint);
        return;
      }
      // ADR-035, target size: what the worker will plan, decided here too so
      // an impossible target is refused before the save dialog, and the gate
      // checks the encoder at the size that will really be encoded.
      let targetSize: TargetSizeExport | null = null;
      let gatePlan = plan;
      if (!audioOnly && (options.targetSize || hook?.forced)) {
        targetSize = {
          targetBytes: options.targetSize?.targetBytes ?? Number.MAX_SAFE_INTEGER,
          ...(options.targetSize?.minShortEdge !== undefined ? { minShortEdge: options.targetSize.minShortEdge } : {}),
          maxShortEdge: maxTargetShortEdge(project.export.shortEdge, nativeShortEdge(plan)),
          ...(hook?.forced ? { forced: hook.forced } : {}),
        };
        const kinds = kindsRef.current?.key === `${plan.aspect}|${plan.fpsNum}/${plan.fpsDen}` ? kindsRef.current.lookup : null;
        if (kinds && !targetSize.forced) {
          const planned = planTargetSize(
            targetSize,
            targetSizeFacts(plan, { maxShortEdge: targetSize.maxShortEdge, hasAudio: planHasAudio(plan), encoderKind: kinds }),
          );
          if (!planned.ok) {
            blocked('target_size_too_small', plan.fingerprint, {
              targetSize: {
                targetBytes: planned.targetBytes,
                minBytes: planned.minBytes,
                maxDurationUs: planned.maxDurationUs,
              },
            });
            return;
          }
          gatePlan = planForTargetSize(plan, planned);
        }
      }
      const known =
        capability && capability.key === capabilityKey(gatePlan, withFont, videoFile, audioFile)
          ? capability.report
          : null;
      if (known && !known.canExport) {
        blocked('capability', plan.fingerprint, { report: known });
        return;
      }

      const clip = target.kind === 'kesit' ? project.clips.find((item) => item.clipId === target.clipId) : undefined;
      const videoFileName =
        fileNameOverride ??
        suggestedFileName(
          videoName ?? videoFile.name,
          clip
            ? { kind: 'kesit', sourceInUs: clip.sourceInUs, sourceOutUs: clip.sourceOutUs }
            : kind === 'kesit' && project.clips[0]
              ? { kind: 'kesit', sourceInUs: project.clips[0].sourceInUs, sourceOutUs: project.clips[0].sourceOutUs }
              : kind === 'merged'
                ? { kind: 'merged', count: project.clips.length }
                : { kind: 'whole' },
        );
      // ADR-035: the sound-only file is M4A (AAC in MP4), `audio/mp4`; a
      // suggested `.mp4` name (a wizard's) gets the `.m4a` ending too.
      const fileName = audioOnly ? audioFileName(videoFileName) : videoFileName;
      const mime = audioOnly ? 'audio/mp4' : 'video/mp4';
      // The plan the worker gets. Sound only: the same kesitler on the sample
      // grid, so the file is as long as the kesitler to the sample (the gate
      // and the entry keep the ordinary plan and its fingerprint).
      const audioCompiled = audioOnly ? compileRenderPlan(audioOnlyRecipe(recipe), WEB_LOCAL_POLICY) : null;
      const exportPlan = audioCompiled?.ok ? audioCompiled.plan : plan;

      // Inside the click, before any await (user activation).
      const picker = savePicker();
      let picked: Promise<FileSystemFileHandle | null>;
      try {
        picked = picker
          ? picker({
              suggestedName: fileName,
              types: audioOnly
                ? [{ description: 'M4A audio', accept: { 'audio/mp4': ['.m4a'] } }]
                : [{ description: 'MP4 video', accept: { 'video/mp4': ['.mp4'] } }],
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
          pass: 1,
          output: audioOnly ? 'audio' : 'video',
        });

        const report = await ensureCapability(gatePlan, withFont, videoFile, audioFile);
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
          pass = 1,
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
            pass,
            output: audioOnly ? 'audio' : 'video',
          });

        for await (const event of client().export(exportPlan, videoFile, audioFile, {
          ...otherExtras,
          // ADR-035: a sound-only file is small (60 min ≈ 58 MB), so the
          // memory route may hold the whole output limit, not only 5 minutes.
          memoryRouteLimitUs: audioOnly
            ? WEB_LOCAL_POLICY.maxOutputDurationUs
            : WEB_LOCAL_POLICY.maxMemoryRouteOutputDurationUs,
          destination,
          output: audioOnly ? 'audio' : 'video',
          targetSize,
        })) {
          switch (event.type) {
            case 'preparing':
              running('preparing', null, 0);
              if (cancelRequestedRef.current) client().cancel();
              break;
            case 'encoding':
              running('encoding', event.progress, event.framesDone, event.pass ?? 1);
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
                // The picked file, read back once for "Paylaş" (disk-backed, no copy).
                let saved: File | null = null;
                try {
                  saved = destination ? await destination.getFile() : null;
                } catch {
                  saved = null;
                }
                setEntry(key, {
                  key,
                  kind,
                  fingerprint: plan.fingerprint,
                revision,
                  phase: 'saved',
                  fileName: event.output.fileName,
                  result: event.result,
                  hdr,
                  share: saved ? shareOffer(new File([saved], event.output.fileName, { type: mime })) : null,
                });
                break;
              }
              // The disk route hands over a disk-backed File: no copy into memory.
              // Wrapping it under the offered name (for "Paylaş") copies nothing either.
              const blob = new File(
                [event.output.kind === 'opfs' ? event.output.file : (event.output.data as BlobPart)],
                fileName,
                { type: mime },
              );
              if (event.output.kind === 'opfs') entryNamesRef.current.set(key, event.output.entryName);
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
                share: shareOffer(blob),
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
                ...(event.targetSize ? { targetSize: event.targetSize } : {}),
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
      exportExtras,
      fileNameOverride,
      planHasAudio,
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
      // A closed result is no longer offered: its temporary file goes now,
      // not at the next download or the next visit (ADR-013).
      const name = entryNamesRef.current.get(key);
      if (name) {
        void removeExportEntry(name);
        entryNamesRef.current.delete(key);
      }
      setEntry(key, null);
    },
    [setEntry],
  );

  const entriesRef = useRef(entries);
  useEffect(() => {
    entriesRef.current = entries;
  });

  /**
   * "Paylaş": the system share sheet with the finished video. Called straight
   * from the click; `navigator.share` runs before anything is awaited.
   * Closing the sheet is not an error; a refusal is said on the card.
   */
  const share = useCallback((key: string) => {
    const entry = entriesRef.current[key];
    if (!entry || (entry.phase !== 'saved' && entry.phase !== 'ready') || entry.share?.verdict !== 'share') return;
    const offer = entry.share;
    void shareVideo(offer.file).then((outcome) => {
      if (outcome === 'failed') recordError('export', 'share_refused');
      const failed = outcome === 'failed';
      setEntries((current) => {
        const now = current[key];
        if (!now || (now.phase !== 'saved' && now.phase !== 'ready') || now.share?.file !== offer.file) return current;
        if (now.share.failed === failed) return current;
        return { ...current, [key]: { ...now, share: { ...now.share, failed } } };
      });
    });
  }, []);

  const running = activeKey !== null;
  // The "new version" notice must not reload the page under a running download.
  useEffect(() => {
    setAppBusy('download', running);
    return () => setAppBusy('download', false);
  }, [running]);
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

  return {
    entries,
    activeKey,
    start,
    previewTargetSize,
    cancel,
    dismiss,
    share,
    capability: capability?.report ?? null,
  };
}

function shareOffer(file: File): ShareOffer | null {
  const verdict = shareVerdictFor(file);
  return verdict === 'unsupported' ? null : { verdict, file, failed: false };
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
