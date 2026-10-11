/**
 * The frame a download will have, said before it is made (ADR-041): the
 * same recipe and the same compiler the download itself uses, so the size on
 * the screen is the size in the file.
 */

import type { Project } from '@/domain/edl';
import { downloadRecipe, type DownloadTarget, type KesitSettings } from '@/domain/kesit';
import { outputSizeFor, type OutputSize } from '@/domain/outputSize';
import { WEB_LOCAL_POLICY, type ExportPolicy } from '@/domain/policy';
import { compileRenderPlan } from '@/domain/renderPlan';

export interface DownloadFrame {
  width: number;
  height: number;
  /** Why it is this size: the user's limit, the picture's own pixels, or the smallest frame. */
  rule: OutputSize['rule'];
  /**
   * The frame subtitles are judged against: the same one, or — for a picture
   * under 360 px — the larger frame a download with burned-in subtitles gets.
   */
  captionFrame: { width: number; height: number };
}

const ALL: DownloadTarget = { kind: 'all' };

/** Null while there is nothing to download (no video, a recipe the compiler refuses). */
export function downloadFrame(
  project: Project,
  settings: KesitSettings,
  target: DownloadTarget = ALL,
  policy: ExportPolicy = WEB_LOCAL_POLICY,
): DownloadFrame | null {
  const recipe = downloadRecipe(project, target, settings);
  const compiled = recipe ? compileRenderPlan(recipe, policy) : null;
  if (!compiled?.ok) return null;
  const { plan } = compiled;
  const withCaptions = outputSizeFor(plan.aspect, project.export.shortEdge, plan.segments, { captions: true });
  return {
    width: plan.width,
    height: plan.height,
    rule: plan.sizeRule,
    captionFrame: { width: withCaptions.width, height: withCaptions.height },
  };
}
