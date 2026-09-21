/**
 * What the silence dialog shows, derived purely from the recipe, the measured
 * envelopes and the user's parameters (ADR-018).
 *
 * Kept out of the component so the rules the user relies on ("the longest
 * cuts are pre-checked", "the summary is exactly what Apply will do") are
 * unit-tested rather than living in JSX.
 */

import type { Project } from '@/domain/edl';
import { WEB_LOCAL_POLICY, type ExportPolicy } from '@/domain/policy';
import { findSilences, type ClipSilence, type LoudnessEnvelope, type SilenceParams } from '@/domain/silence';
import { totalOutputDurationUs } from '@/domain/timeline';
import type { Micros } from '@/domain/time';
import { applySilenceCuts, selectWithinClipLimit } from './commands';

export interface ReviewedSuggestion extends ClipSilence {
  /** Stable while the parameters are unchanged; used for checkbox state. */
  id: string;
}

export type ClipReviewStatus = 'pending' | 'ok' | 'too_short' | 'low_contrast';

export interface ClipReview {
  clipId: string;
  /** 0-based position in the recipe, for "An 01" labels. */
  index: number;
  sourceInUs: Micros;
  sourceOutUs: Micros;
  status: ClipReviewStatus;
  suggestions: ReviewedSuggestion[];
}

export interface SilenceReview {
  clips: ClipReview[];
  suggestions: ReviewedSuggestion[];
  /** Pre-checked: the longest suggestions that fit the moment limit. */
  defaultIds: ReadonlySet<string>;
  /** Suggestions the moment limit kept out of the default selection. */
  leftOut: number;
  /** Moments that still have no envelope (analysis not run or failed). */
  pending: number;
}

export function suggestionId(suggestion: ClipSilence): string {
  return `${suggestion.clipId}@${suggestion.startUs}-${suggestion.endUs}`;
}

export function reviewSilences(
  project: Project,
  envelopeFor: (clip: { sourceInUs: Micros; sourceOutUs: Micros }) => LoudnessEnvelope | undefined,
  params: SilenceParams,
  policy: ExportPolicy = WEB_LOCAL_POLICY,
): SilenceReview {
  const clips: ClipReview[] = project.clips.map((clip, index) => {
    const base = { clipId: clip.clipId, index, sourceInUs: clip.sourceInUs, sourceOutUs: clip.sourceOutUs };
    const envelope = envelopeFor(clip);
    if (!envelope) return { ...base, status: 'pending', suggestions: [] };
    const analysis = findSilences(envelope, params);
    if (!analysis.ok) return { ...base, status: analysis.reason, suggestions: [] };
    const suggestions = analysis.suggestions
      // The envelope's last frame may run a few ms past the moment's end.
      .map((item) => ({
        clipId: clip.clipId,
        startUs: Math.max(clip.sourceInUs, item.startUs),
        endUs: Math.min(clip.sourceOutUs, item.endUs),
      }))
      .filter((item) => item.endUs > item.startUs)
      .map((item) => ({ ...item, id: suggestionId(item) }));
    return { ...base, status: 'ok', suggestions };
  });
  const suggestions = clips.flatMap((clip) => clip.suggestions);
  const { selected, leftOut } = selectWithinClipLimit(project, suggestions, policy);
  return {
    clips,
    suggestions,
    defaultIds: new Set(selected.map(suggestionId)),
    leftOut,
    pending: clips.filter((clip) => clip.status === 'pending').length,
  };
}

export type CutPreview =
  | { kind: 'none' }
  | { kind: 'limit'; clipsAfter: number; maxClips: number }
  | {
      kind: 'ok';
      outputBeforeUs: Micros;
      outputAfterUs: Micros;
      clipsBefore: number;
      clipsAfter: number;
      droppedPieces: number;
    };

/** The before/after summary is computed by the very command Apply runs. */
export function previewSilenceCuts(
  project: Project,
  chosen: readonly ClipSilence[],
  policy: ExportPolicy = WEB_LOCAL_POLICY,
): CutPreview {
  const result = applySilenceCuts(project, chosen, policy);
  if (!result.ok) {
    return result.reason === 'clip_limit_exceeded'
      ? { kind: 'limit', clipsAfter: result.clipsAfter, maxClips: policy.maxClips }
      : { kind: 'none' };
  }
  return {
    kind: 'ok',
    outputBeforeUs: totalOutputDurationUs(project),
    outputAfterUs: totalOutputDurationUs(result.project),
    clipsBefore: result.report.clipsBefore,
    clipsAfter: result.report.clipsAfter,
    droppedPieces: result.report.droppedPieces,
  };
}
