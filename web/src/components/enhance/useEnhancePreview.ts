'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ExportWorkerClient } from '@/adapters/export/exportClient';
import type { EnhanceAnalysis, EnhancePreviewFailure, EnhancePreviewResult } from '@/adapters/export/protocol';
import { enhancePreviewFrame } from '@/application/taskRecipes';
import type { Project } from '@/domain/edl';
import type { EnhanceParams, EnhanceSummary } from '@/domain/enhance';
import { downloadRecipe, type KesitSettings } from '@/domain/kesit';
import { WEB_LOCAL_POLICY } from '@/domain/policy';
import { compileRenderPlan } from '@/domain/renderPlan';

/** One real frame of the video before and after, as the export would make it. */
export interface EnhancePreviewPicture {
  before: ImageBitmap;
  after: ImageBitmap;
  width: number;
  height: number;
  frame: number;
  summary: EnhanceSummary;
  params: EnhanceParams;
  engine: 'webgl2' | 'cpu';
  /** The plan this picture belongs to. */
  fingerprint: string;
}

type PreviewFailure = Exclude<EnhancePreviewFailure, 'canceled' | 'not_enhanced'>;

export type EnhancePreviewState =
  /** Nothing to show: no video, or the recipe does not ask for enhancement. */
  | { status: 'idle' }
  /** `progress`: the share of the frames looked at so far (real), null while the frame itself is made. */
  | { status: 'loading'; progress: number | null; previous: EnhancePreviewPicture | null }
  | { status: 'ready'; picture: EnhancePreviewPicture }
  | { status: 'failed'; reason: PreviewFailure };

interface Args {
  /** The recipe as the editor state holds it; the whole video while it has no kesit. */
  project: Project;
  settings: KesitSettings;
  videoFile: File | null;
  /** Which of the preview frames to show (`enhancePreviewFrame`). */
  shot: number;
  /** False: nothing is requested (the setting is off, or its panel is closed). */
  enabled?: boolean;
}

/** What the worker answered for one request. */
interface Answer {
  request: string;
  file: File;
  picture: EnhancePreviewPicture | null;
  failure: PreviewFailure | null;
  analysis: EnhanceAnalysis | null;
}

/**
 * The before/after preview of "İyileştir" (ADR-037).
 *
 * The picture is not made here: the export worker decodes the frame, looks
 * at the video and enhances the frame with the very code the download runs
 * (`ExportWorkerClient.enhancePreview`), and hands back two bitmaps. This
 * hook only asks, keeps the measurements for the next strength and for the
 * download (`analysis`), and owns the bitmaps.
 *
 * It uses a worker of its own, so a preview never competes with the
 * capability check or a running download for the same worker.
 */
export function useEnhancePreview({ project, settings, videoFile, shot, enabled = true }: Args) {
  const clientRef = useRef<ExportWorkerClient | null>(null);
  const analysisRef = useRef<{ file: File; analysis: EnhanceAnalysis } | null>(null);
  const pictureRef = useRef<EnhancePreviewPicture | null>(null);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [progress, setProgress] = useState<{ request: string; share: number } | null>(null);
  const [attempt, setAttempt] = useState(0);

  // The same recipe and plan the download compiles (`useDownloads`), so the
  // measurements made here are the ones the export would make.
  const plan = useMemo(() => {
    if (!enabled || !videoFile || !project.enhance) return null;
    const recipe = downloadRecipe(project, { kind: 'all' }, settings);
    const compiled = recipe ? compileRenderPlan(recipe, WEB_LOCAL_POLICY) : null;
    return compiled?.ok ? compiled.plan : null;
  }, [enabled, project, settings, videoFile]);
  const fingerprint = plan?.fingerprint ?? null;
  const request = fingerprint === null ? null : `${fingerprint}|${shot}|${attempt}`;
  const planRef = useRef(plan);
  useEffect(() => {
    planRef.current = plan;
  });

  useEffect(() => {
    const current = planRef.current;
    if (!current || !videoFile || request === null) return undefined;
    clientRef.current ??= new ExportWorkerClient();
    const client = clientRef.current;
    let live = true;
    const known = analysisRef.current?.file === videoFile ? analysisRef.current.analysis : null;
    void client
      .enhancePreview(current, videoFile, enhancePreviewFrame(current.totalFrames, shot), {
        analysis: known,
        onProgress: (share) => {
          if (live) setProgress({ request, share });
        },
      })
      .then((result: EnhancePreviewResult) => {
        if (!live) {
          if (result.ok) {
            result.before.close();
            result.after.close();
          }
          return;
        }
        if (!result.ok) {
          if (result.reason === 'canceled' || result.reason === 'not_enhanced') return;
          setAnswer({ request, file: videoFile, picture: null, failure: result.reason, analysis: known });
          return;
        }
        const picture: EnhancePreviewPicture = {
          before: result.before,
          after: result.after,
          width: result.width,
          height: result.height,
          frame: result.frame,
          summary: result.summary,
          params: result.params,
          engine: result.engine,
          fingerprint: current.fingerprint,
        };
        const old = pictureRef.current;
        pictureRef.current = picture;
        analysisRef.current = { file: videoFile, analysis: result.analysis };
        setAnswer({ request, file: videoFile, picture, failure: null, analysis: result.analysis });
        // Whoever showed the old bitmaps has copied them into its canvases by now; they can go.
        old?.before.close();
        old?.after.close();
      });
    return () => {
      live = false;
      client.cancel();
    };
  }, [request, shot, videoFile]);

  useEffect(
    () => () => {
      clientRef.current?.dispose();
      clientRef.current = null;
      pictureRef.current?.before.close();
      pictureRef.current?.after.close();
      pictureRef.current = null;
    },
    [],
  );

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  // What the screen shows follows from the request that is wanted now and the
  // last answer: no state is set while rendering or inside an effect body.
  const answered = answer !== null && request !== null && answer.request === request && answer.file === videoFile;
  const lastPicture = answer?.file === videoFile ? (answer.picture ?? null) : null;
  let state: EnhancePreviewState;
  if (request === null) state = { status: 'idle' };
  else if (answered && answer.picture) state = { status: 'ready', picture: answer.picture };
  else if (answered && answer.failure) state = { status: 'failed', reason: answer.failure };
  else {
    state = {
      status: 'loading',
      progress: progress && progress.request === request ? progress.share : null,
      previous: lastPicture,
    };
  }

  return {
    state,
    /** Whether `state` is the answer for the recipe as it is now (not for an earlier strength). */
    current: state.status === 'ready',
    /** The measurements of this video, for the download (`exportExtras.enhanceAnalysis`). */
    analysis: answer !== null && answer.file === videoFile ? answer.analysis : null,
    retry,
  };
}

export type EnhancePreview = ReturnType<typeof useEnhancePreview>;
