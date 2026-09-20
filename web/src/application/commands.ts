/**
 * Application commands: pure `ProjectV1 -> ProjectV1` transitions.
 *
 * No React, no DOM, no file handles. Every command that actually changes the
 * recipe bumps `revision` — that is what undo/redo, autosave (later) and the
 * export fingerprint hang off.
 */

import {
  DEFAULT_EXPORT_SPEC,
  type AspectRatio,
  type AssetV1,
  type ClipV1,
  type FitMode,
  type MusicV1,
  type ProjectV1,
} from '../domain/edl';
import { WEB_LOCAL_POLICY, type ExportPolicy } from '../domain/policy';
import { computeSourceView, viewZoom } from '../domain/transform';
import { MIN_CLIP_DURATION_US, type Micros } from '../domain/time';
import { totalOutputDurationUs } from '../domain/timeline';
import { nextId } from './ids';

export function createEmptyProject(projectId = 'p_local_001'): ProjectV1 {
  return {
    schemaVersion: 1,
    projectId,
    revision: 0,
    assets: [],
    canvas: { aspect: '16:9', background: '#000000' },
    clips: [],
    export: { ...DEFAULT_EXPORT_SPEC },
  };
}

function bump(project: ProjectV1, patch: Partial<ProjectV1>): ProjectV1 {
  return { ...project, ...patch, revision: project.revision + 1 };
}

export function primaryVideoAsset(project: ProjectV1): AssetV1 | undefined {
  return project.assets.find((asset) => asset.kind === 'video');
}

export function audioAsset(project: ProjectV1): AssetV1 | undefined {
  return project.assets.find((asset) => asset.kind === 'audio');
}

export function findClip(project: ProjectV1, clipId: string): ClipV1 | undefined {
  return project.clips.find((clip) => clip.clipId === clipId);
}

export function nextClipId(project: ProjectV1): string {
  return nextId('c', project.clips.map((clip) => clip.clipId));
}

export function nextAssetId(project: ProjectV1, kind: 'video' | 'audio'): string {
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
export function setVideoAsset(project: ProjectV1, asset: AssetV1): ProjectV1 {
  const others = project.assets.filter((existing) => existing.kind !== 'video');
  const keptClips = project.clips.filter((clip) => clip.assetId === asset.assetId);
  return bump(project, {
    assets: [asset, ...others],
    clips: keptClips,
  });
}

export function removeVideoAsset(project: ProjectV1): ProjectV1 {
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
  | { ok: true; project: ProjectV1 }
  | { ok: false; reason: AddClipRejection };

export type AddClipRejection =
  | 'no_source'
  | 'range_reversed'
  | 'range_out_of_source'
  | 'clip_too_short'
  | 'clip_limit_exceeded'
  | 'output_duration_exceeds_policy';

export function addClip(
  project: ProjectV1,
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

export function removeClip(project: ProjectV1, clipId: string): ProjectV1 {
  const clips = project.clips.filter((clip) => clip.clipId !== clipId);
  if (clips.length === project.clips.length) return project;
  return bump(project, { clips });
}

export function moveClip(project: ProjectV1, clipId: string, delta: -1 | 1): ProjectV1 {
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
  project: ProjectV1,
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

export function setClipGain(project: ProjectV1, clipId: string, gainDb: number): ProjectV1 {
  const clamped = Math.max(
    WEB_LOCAL_POLICY.minGainDb,
    Math.min(WEB_LOCAL_POLICY.maxGainDb, Math.round(gainDb)),
  );
  const clips = project.clips.map((clip) =>
    clip.clipId === clipId ? { ...clip, sourceGainDb: clamped } : clip,
  );
  return bump(project, { clips });
}

export function setClipMuted(project: ProjectV1, clipId: string, muted: boolean): ProjectV1 {
  const clips = project.clips.map((clip) => (clip.clipId === clipId ? { ...clip, muted } : clip));
  return bump(project, { clips });
}

/**
 * Framing in W0 is project-wide: there is one source and one "Görüntü" panel.
 * It is still stored per clip, so per-clip crop can arrive later without an
 * EDL schema change.
 */
export function setFraming(
  project: ProjectV1,
  framing: { aspect?: AspectRatio; fit?: FitMode; zoom?: number },
): ProjectV1 {
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

export function currentFraming(project: ProjectV1): { fit: FitMode; zoom: number } {
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

export function setMusicAsset(project: ProjectV1, asset: AssetV1): ProjectV1 {
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
  project: ProjectV1,
  patch: Partial<Omit<MusicV1, 'assetId'>>,
): { ok: true; project: ProjectV1 } | { ok: false; reason: MusicRejection } {
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

export function removeMusic(project: ProjectV1): ProjectV1 {
  if (!project.music) return project;
  return bump(project, {
    music: undefined,
    assets: project.assets.filter((asset) => asset.kind !== 'audio'),
  });
}

export function setExportShortEdge(project: ProjectV1, shortEdge: number): ProjectV1 {
  if (project.export.shortEdge === shortEdge) return project;
  return bump(project, { export: { ...project.export, shortEdge } });
}
