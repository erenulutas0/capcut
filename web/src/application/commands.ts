/**
 * Application commands: pure `Project -> Project` transitions.
 *
 * No React, no DOM, no file handles. Every command that actually changes the
 * recipe bumps `revision` — that is what undo/redo, autosave (later) and the
 * export fingerprint hang off.
 */

import {
  DEFAULT_EXPORT_SPEC,
  type AspectRatio,
  type AssetV1,
  type CaptionCueV2,
  type CaptionStyleV2,
  type CaptionTrackV2,
  type ClipV1,
  type FitMode,
  type MusicV1,
  type Project,
} from '../domain/edl';
import {
  CAPTION_LIMITS,
  DEFAULT_CAPTION_STYLE,
  captionTextProblem,
  isCaptionLanguage,
  normalizeCaptionText,
  overlappingCue,
  primaryCaptionTrack,
  sortCues,
  type CaptionTextProblem,
} from '../domain/captions';
import { WEB_LOCAL_POLICY, type ExportPolicy } from '../domain/policy';
import { computeSourceView, viewZoom } from '../domain/transform';
import { MIN_CLIP_DURATION_US, type Micros } from '../domain/time';
import { totalOutputDurationUs } from '../domain/timeline';
import { splitPointAt, type SplitRejection } from '../domain/trim';
import { nextId } from './ids';

export function createEmptyProject(projectId = 'p_local_001'): Project {
  return {
    schemaVersion: 2,
    projectId,
    revision: 0,
    assets: [],
    canvas: { aspect: '16:9', background: '#000000' },
    clips: [],
    export: { ...DEFAULT_EXPORT_SPEC },
    captionTracks: [],
  };
}

function bump(project: Project, patch: Partial<Project>): Project {
  return { ...project, ...patch, revision: project.revision + 1 };
}

export function primaryVideoAsset(project: Project): AssetV1 | undefined {
  return project.assets.find((asset) => asset.kind === 'video');
}

export function audioAsset(project: Project): AssetV1 | undefined {
  return project.assets.find((asset) => asset.kind === 'audio');
}

export function findClip(project: Project, clipId: string): ClipV1 | undefined {
  return project.clips.find((clip) => clip.clipId === clipId);
}

export function nextClipId(project: Project): string {
  return nextId('c', project.clips.map((clip) => clip.clipId));
}

export function nextAssetId(project: Project, kind: 'video' | 'audio'): string {
  const prefix = kind === 'video' ? 'a_video' : 'a_music';
  return nextId(
    prefix,
    project.assets.map((asset) => asset.assetId),
  );
}

/**
 * W0 keeps a single video source. Picking a different file replaces it and
 * drops the moments that pointed at the old one — the UI confirms first.
 */
export function setVideoAsset(project: Project, asset: AssetV1): Project {
  const others = project.assets.filter((existing) => existing.kind !== 'video');
  const keptClips = project.clips.filter((clip) => clip.assetId === asset.assetId);
  return bump(project, {
    assets: [asset, ...others],
    clips: keptClips,
  });
}

export function removeVideoAsset(project: Project): Project {
  return bump(project, {
    assets: project.assets.filter((asset) => asset.kind !== 'video'),
    clips: [],
  });
}

export interface AddClipInput {
  sourceInUs: Micros;
  sourceOutUs: Micros;
  /** Defaults to the next free id. */
  clipId?: string;
}

export type CommandResult =
  | { ok: true; project: Project }
  | { ok: false; reason: AddClipRejection };

export type AddClipRejection =
  | 'no_source'
  | 'range_reversed'
  | 'range_out_of_source'
  | 'clip_too_short'
  | 'clip_limit_exceeded'
  | 'output_duration_exceeds_policy';

export function addClip(
  project: Project,
  input: AddClipInput,
  policy: ExportPolicy = WEB_LOCAL_POLICY,
): CommandResult {
  const asset = primaryVideoAsset(project);
  if (!asset) return { ok: false, reason: 'no_source' };
  if (input.sourceOutUs <= input.sourceInUs) return { ok: false, reason: 'range_reversed' };
  if (input.sourceInUs < 0 || input.sourceOutUs > asset.durationUs) {
    return { ok: false, reason: 'range_out_of_source' };
  }
  const durationUs = input.sourceOutUs - input.sourceInUs;
  if (durationUs < MIN_CLIP_DURATION_US) return { ok: false, reason: 'clip_too_short' };
  if (project.clips.length >= policy.maxClips) return { ok: false, reason: 'clip_limit_exceeded' };
  if (totalOutputDurationUs(project) + durationUs > policy.maxOutputDurationUs) {
    return { ok: false, reason: 'output_duration_exceeds_policy' };
  }

  const reference = project.clips[0];
  const view = reference
    ? { ...reference.view }
    : computeSourceView(
        asset.displayWidth ?? 0,
        asset.displayHeight ?? 0,
        project.canvas.aspect,
        'cover',
      );

  const clip: ClipV1 = {
    clipId: input.clipId ?? nextClipId(project),
    assetId: asset.assetId,
    sourceInUs: input.sourceInUs,
    sourceOutUs: input.sourceOutUs,
    sourceGainDb: 0,
    muted: false,
    view,
  };

  return { ok: true, project: bump(project, { clips: [...project.clips, clip] }) };
}

export function removeClip(project: Project, clipId: string): Project {
  const clips = project.clips.filter((clip) => clip.clipId !== clipId);
  if (clips.length === project.clips.length) return project;
  return bump(project, { clips });
}

export function moveClip(project: Project, clipId: string, delta: -1 | 1): Project {
  const index = project.clips.findIndex((clip) => clip.clipId === clipId);
  if (index < 0) return project;
  const target = index + delta;
  if (target < 0 || target >= project.clips.length) return project;

  const clips = [...project.clips];
  const moved = clips[index];
  const swapped = clips[target];
  if (!moved || !swapped) return project;
  clips[index] = swapped;
  clips[target] = moved;
  return bump(project, { clips });
}

export function updateClipRange(
  project: Project,
  clipId: string,
  range: { sourceInUs: Micros; sourceOutUs: Micros },
  policy: ExportPolicy = WEB_LOCAL_POLICY,
): CommandResult {
  const asset = primaryVideoAsset(project);
  if (!asset) return { ok: false, reason: 'no_source' };
  if (range.sourceOutUs <= range.sourceInUs) return { ok: false, reason: 'range_reversed' };
  if (range.sourceInUs < 0 || range.sourceOutUs > asset.durationUs) {
    return { ok: false, reason: 'range_out_of_source' };
  }
  const durationUs = range.sourceOutUs - range.sourceInUs;
  if (durationUs < MIN_CLIP_DURATION_US) return { ok: false, reason: 'clip_too_short' };

  const current = findClip(project, clipId);
  if (!current) return { ok: false, reason: 'no_source' };
  const otherTotal = totalOutputDurationUs(project) - (current.sourceOutUs - current.sourceInUs);
  if (otherTotal + durationUs > policy.maxOutputDurationUs) {
    return { ok: false, reason: 'output_duration_exceeds_policy' };
  }

  const clips = project.clips.map((clip) =>
    clip.clipId === clipId ? { ...clip, ...range } : clip,
  );
  return { ok: true, project: bump(project, { clips }) };
}

/**
 * Cuts one moment in two at a source time. Both halves keep every setting of
 * the original (gain, mute, view); the first keeps the clip id, the second
 * gets the next free id and sits right after it, so the output is unchanged
 * frame for frame — only the moment count grows.
 */
export function splitClip(
  project: Project,
  clipId: string,
  atSourceUs: Micros,
  policy: ExportPolicy = WEB_LOCAL_POLICY,
): { ok: true; project: Project; newClipId: string } | { ok: false; reason: SplitRejection } {
  const point = splitPointAt(project, clipId, { mode: 'source', sourceUs: atSourceUs }, policy);
  if (!point.ok) return point;

  const index = project.clips.findIndex((clip) => clip.clipId === clipId);
  const original = project.clips[index];
  if (!original) return { ok: false, reason: 'no_selection' };

  const newClipId = nextClipId(project);
  const first: ClipV1 = { ...original, view: { ...original.view }, sourceOutUs: point.sourceUs };
  const second: ClipV1 = {
    ...original,
    view: { ...original.view },
    clipId: newClipId,
    sourceInUs: point.sourceUs,
  };
  const clips = [...project.clips.slice(0, index), first, second, ...project.clips.slice(index + 1)];
  return { ok: true, project: bump(project, { clips }), newClipId };
}

export function setClipGain(project: Project, clipId: string, gainDb: number): Project {
  const clamped = Math.max(
    WEB_LOCAL_POLICY.minGainDb,
    Math.min(WEB_LOCAL_POLICY.maxGainDb, Math.round(gainDb)),
  );
  const clips = project.clips.map((clip) =>
    clip.clipId === clipId ? { ...clip, sourceGainDb: clamped } : clip,
  );
  return bump(project, { clips });
}

export function setClipMuted(project: Project, clipId: string, muted: boolean): Project {
  const clips = project.clips.map((clip) => (clip.clipId === clipId ? { ...clip, muted } : clip));
  return bump(project, { clips });
}

/**
 * Framing in W0 is project-wide: there is one source and one "Görüntü" panel.
 * It is still stored per clip, so per-clip crop can arrive later without an
 * EDL schema change.
 */
export function setFraming(
  project: Project,
  framing: { aspect?: AspectRatio; fit?: FitMode; zoom?: number },
): Project {
  const asset = primaryVideoAsset(project);
  const aspect = framing.aspect ?? project.canvas.aspect;
  const currentFit = project.clips[0]?.view.fit ?? 'cover';
  const fit = framing.fit ?? currentFit;
  const currentZoom =
    project.clips[0] && asset
      ? viewZoom(
          project.clips[0].view,
          asset.displayWidth ?? 0,
          asset.displayHeight ?? 0,
          project.canvas.aspect,
        )
      : 1;
  const zoom = framing.zoom ?? currentZoom;

  const view = computeSourceView(
    asset?.displayWidth ?? 0,
    asset?.displayHeight ?? 0,
    aspect,
    fit,
    zoom,
  );

  return bump(project, {
    canvas: { ...project.canvas, aspect },
    clips: project.clips.map((clip) => ({ ...clip, view: { ...view } })),
  });
}

export function currentFraming(project: Project): { fit: FitMode; zoom: number } {
  const asset = primaryVideoAsset(project);
  const clip = project.clips[0];
  if (!clip) return { fit: 'cover', zoom: 1 };
  return {
    fit: clip.view.fit,
    zoom: asset
      ? viewZoom(clip.view, asset.displayWidth ?? 0, asset.displayHeight ?? 0, project.canvas.aspect)
      : 1,
  };
}

export function setMusicAsset(project: Project, asset: AssetV1): Project {
  const others = project.assets.filter((existing) => existing.kind !== 'audio');
  const outputUs = totalOutputDurationUs(project);
  const selectionUs = Math.min(asset.durationUs, Math.max(MIN_CLIP_DURATION_US, outputUs));
  const music: MusicV1 = {
    assetId: asset.assetId,
    sourceInUs: 0,
    sourceOutUs: selectionUs,
    timelineStartUs: 0,
    gainDb: -12,
    muted: false,
    fadeInUs: 0,
    fadeOutUs: 0,
  };
  return bump(project, { assets: [...others, asset], music });
}

export type MusicRejection =
  | 'no_music'
  | 'range_reversed'
  | 'range_out_of_source'
  | 'fade_exceeds_selection'
  | 'music_start_after_output';

export function updateMusic(
  project: Project,
  patch: Partial<Omit<MusicV1, 'assetId'>>,
): { ok: true; project: Project } | { ok: false; reason: MusicRejection } {
  if (!project.music) return { ok: false, reason: 'no_music' };
  const asset = project.assets.find((item) => item.assetId === project.music?.assetId);
  const music: MusicV1 = { ...project.music, ...patch };

  if (music.sourceOutUs <= music.sourceInUs) return { ok: false, reason: 'range_reversed' };
  if (music.sourceInUs < 0 || (asset && music.sourceOutUs > asset.durationUs)) {
    return { ok: false, reason: 'range_out_of_source' };
  }
  const selectionUs = music.sourceOutUs - music.sourceInUs;
  if (music.fadeInUs < 0 || music.fadeOutUs < 0 || music.fadeInUs + music.fadeOutUs > selectionUs) {
    return { ok: false, reason: 'fade_exceeds_selection' };
  }
  const outputUs = totalOutputDurationUs(project);
  if (outputUs > 0 && music.timelineStartUs >= outputUs) {
    return { ok: false, reason: 'music_start_after_output' };
  }

  music.gainDb = Math.max(
    WEB_LOCAL_POLICY.minGainDb,
    Math.min(WEB_LOCAL_POLICY.maxGainDb, music.gainDb),
  );

  return { ok: true, project: bump(project, { music }) };
}

export function removeMusic(project: Project): Project {
  if (!project.music) return project;
  return bump(project, {
    music: undefined,
    assets: project.assets.filter((asset) => asset.kind !== 'audio'),
  });
}

export function setExportShortEdge(project: Project, shortEdge: number): Project {
  if (project.export.shortEdge === shortEdge) return project;
  return bump(project, { export: { ...project.export, shortEdge } });
}

/* ------------------------------------------------------------- captions */

export type CaptionRejection =
  | CaptionTextProblem
  | 'range_reversed'
  | 'caption_cue_too_short'
  | 'caption_cue_overlap'
  | 'caption_limit_exceeded'
  | 'caption_outside_output'
  | 'caption_not_found';

export interface CaptionCueInput {
  startUs: Micros;
  endUs: Micros;
  /** Raw text as typed; it is normalised here, once. */
  text: string;
}

export type CaptionResult =
  | { ok: true; project: Project; cueId: string }
  | { ok: false; reason: CaptionRejection };

/**
 * Checks one cue against the rules the validator enforces, plus one editing
 * rule: a new or moved cue must start inside the current output. Its end is
 * cut at the output end rather than refused, because the natural gesture is
 * "add a line here" near the end of a short video.
 */
function resolveCue(
  project: Project,
  cues: readonly CaptionCueV2[],
  input: CaptionCueInput,
  ignoreCueId?: string,
): { ok: true; cue: Omit<CaptionCueV2, 'cueId'> } | { ok: false; reason: CaptionRejection } {
  const text = normalizeCaptionText(input.text);
  const problem = captionTextProblem(text);
  if (problem) return { ok: false, reason: problem };

  const outputUs = totalOutputDurationUs(project);
  const startUs = Math.max(0, Math.round(input.startUs));
  if (startUs >= outputUs) return { ok: false, reason: 'caption_outside_output' };
  const endUs = Math.min(outputUs, Math.round(input.endUs));
  if (endUs <= startUs) return { ok: false, reason: 'range_reversed' };
  if (endUs - startUs < CAPTION_LIMITS.minCueDurationUs) {
    return { ok: false, reason: 'caption_cue_too_short' };
  }
  if (overlappingCue(cues, startUs, endUs, ignoreCueId)) {
    return { ok: false, reason: 'caption_cue_overlap' };
  }
  return { ok: true, cue: { startUs, endUs, text } };
}

function withTrack(project: Project, update: (track: CaptionTrackV2) => CaptionTrackV2): Project {
  const existing = primaryCaptionTrack(project) ?? {
    trackId: 't_001',
    origin: 'manual' as const,
    timeBase: 'output' as const,
    language: 'tr',
    style: { ...DEFAULT_CAPTION_STYLE },
    cues: [],
  };
  const next = update(existing);
  return bump(project, { captionTracks: [{ ...next, cues: sortCues(next.cues) }] });
}

export function addCaptionCue(project: Project, input: CaptionCueInput): CaptionResult {
  const cues = primaryCaptionTrack(project)?.cues ?? [];
  if (cues.length >= CAPTION_LIMITS.maxCuesPerTrack) {
    return { ok: false, reason: 'caption_limit_exceeded' };
  }
  const resolved = resolveCue(project, cues, input);
  if (!resolved.ok) return resolved;

  const cueId = nextId('q', cues.map((cue) => cue.cueId));
  return {
    ok: true,
    cueId,
    project: withTrack(project, (track) => ({
      ...track,
      cues: [...track.cues, { cueId, ...resolved.cue }],
    })),
  };
}

export function updateCaptionCue(
  project: Project,
  cueId: string,
  patch: Partial<CaptionCueInput>,
): CaptionResult {
  const cues = primaryCaptionTrack(project)?.cues ?? [];
  const current = cues.find((cue) => cue.cueId === cueId);
  if (!current) return { ok: false, reason: 'caption_not_found' };

  const resolved = resolveCue(project, cues, { ...current, ...patch }, cueId);
  if (!resolved.ok) return resolved;
  const unchanged =
    resolved.cue.startUs === current.startUs &&
    resolved.cue.endUs === current.endUs &&
    resolved.cue.text === current.text;
  if (unchanged) return { ok: true, cueId, project };

  return {
    ok: true,
    cueId,
    project: withTrack(project, (track) => ({
      ...track,
      cues: track.cues.map((cue) => (cue.cueId === cueId ? { cueId, ...resolved.cue } : cue)),
    })),
  };
}

export function removeCaptionCue(project: Project, cueId: string): Project {
  const track = primaryCaptionTrack(project);
  if (!track?.cues.some((cue) => cue.cueId === cueId)) return project;
  return withTrack(project, (current) => ({
    ...current,
    cues: current.cues.filter((cue) => cue.cueId !== cueId),
  }));
}

export function setCaptionStyle(project: Project, patch: Partial<CaptionStyleV2>): Project {
  const style = primaryCaptionTrack(project)?.style ?? DEFAULT_CAPTION_STYLE;
  const next = { ...style, ...patch };
  if (
    primaryCaptionTrack(project) &&
    next.preset === style.preset &&
    next.position === style.position &&
    next.size === style.size
  ) {
    return project;
  }
  return withTrack(project, (track) => ({ ...track, style: next }));
}

export function setCaptionLanguage(project: Project, language: string): Project {
  if (!isCaptionLanguage(language) || primaryCaptionTrack(project)?.language === language) {
    return project;
  }
  return withTrack(project, (track) => ({ ...track, language }));
}
