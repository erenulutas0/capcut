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
  outputCues,
  overlappingCue,
  primaryCaptionTrack,
  sortCues,
  type CaptionTextProblem,
} from '../domain/captions';
import { WEB_LOCAL_POLICY, type ExportPolicy } from '../domain/policy';
import { computeSourceView, viewZoom } from '../domain/transform';
import { MIN_CLIP_DURATION_US, type Micros } from '../domain/time';
import { buildTimeline, totalOutputDurationUs } from '../domain/timeline';
import { piecesAfterRemoval, type ClipSilence } from '../domain/silence';
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
  | 'range_out_of_source'
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
 * The clock a track's cue times run on, and where it ends: the output for
 * output tracks, the anchored video file for source tracks (ADR-016).
 */
function trackClock(project: Project): { endUs: Micros; outside: CaptionRejection } {
  const track = primaryCaptionTrack(project);
  if (track?.timeBase === 'source') {
    const asset = project.assets.find((item) => item.assetId === track.assetId);
    return { endUs: asset?.durationUs ?? 0, outside: 'range_out_of_source' };
  }
  return { endUs: totalOutputDurationUs(project), outside: 'caption_outside_output' };
}

/**
 * Checks one cue against the rules the validator enforces, plus one editing
 * rule: a new or moved cue must start inside its clock (the output, or the
 * anchored video). Its end is cut there rather than refused, because the
 * natural gesture is "add a line here" near the end.
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

  const clock = trackClock(project);
  const startUs = Math.max(0, Math.round(input.startUs));
  if (startUs >= clock.endUs) return { ok: false, reason: clock.outside };
  const endUs = Math.min(clock.endUs, Math.round(input.endUs));
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

/* ------------------------------------------- caption time base (ADR-016) */

export interface CaptionConversionReport {
  /** Cues that became more than one cue (split at a cut, or a repeated range). */
  split: number;
  /** Cues, or pieces of cues, that could not survive (unused or too short). */
  dropped: number;
}

export type CaptionConversionResult =
  | { ok: true; project: Project; report: CaptionConversionReport }
  | {
      ok: false;
      reason: 'caption_no_track' | 'caption_no_video' | 'caption_conversion_conflict';
      /** For a conflict: the cues that would land on the same source instant. */
      cueIds?: string[];
    };

type CuePiece = Omit<CaptionCueV2, 'cueId'> & { from: string };

/** Keeps the original id on the first piece of each cue; later pieces get fresh ids. */
function reassignIds(pieces: readonly CuePiece[]): CaptionCueV2[] {
  const used = new Set<string>();
  const taken = pieces.map((piece) => piece.from);
  return pieces.map((piece) => {
    const cueId = used.has(piece.from) ? nextId('q', [...taken, ...used]) : piece.from;
    used.add(cueId);
    return { cueId, startUs: piece.startUs, endUs: piece.endUs, text: piece.text };
  });
}

/**
 * Re-anchors the caption track to the other clock, keeping what the viewer
 * sees in the CURRENT output identical (ADR-016).
 *
 * - output → source: each line is mapped onto the video file. A line that
 *   spans a cut becomes one line per moment (joined again when the moments
 *   are contiguous in the file). Two different lines that would land on the
 *   same instant of the file — possible when a range is used twice — make
 *   the conversion refuse instead of guessing which one wins.
 * - source → output: each appearance becomes its own output line; lines no
 *   moment shows are dropped and counted.
 *
 * Pieces shorter than the minimum cue length are dropped and counted, never
 * silently stretched.
 */
export function convertCaptionTimeBase(
  project: Project,
  target: CaptionTrackV2['timeBase'],
): CaptionConversionResult {
  const track = primaryCaptionTrack(project);
  if (!track) return { ok: false, reason: 'caption_no_track' };
  if (track.timeBase === target) return { ok: true, project, report: { split: 0, dropped: 0 } };

  if (target === 'output') {
    const shown = outputCues(project);
    const kept = shown.filter((cue) => cue.endUs - cue.startUs >= CAPTION_LIMITS.minCueDurationUs);
    const appearances = new Map<string, number>();
    for (const cue of shown) appearances.set(cue.cueId, (appearances.get(cue.cueId) ?? 0) + 1);
    const unused = track.cues.filter((cue) => !appearances.has(cue.cueId)).length;
    const split = [...appearances.values()].filter((count) => count > 1).length;
    const cues = reassignIds(kept.map((cue) => ({ ...cue, from: cue.cueId })));
    return {
      ok: true,
      report: { split, dropped: unused + (shown.length - kept.length) },
      project: withTrack(project, (current) => {
        const { assetId: _unused, ...rest } = current;
        return { ...rest, timeBase: 'output', cues };
      }),
    };
  }

  const video = primaryVideoAsset(project);
  if (!video) return { ok: false, reason: 'caption_no_video' };
  const outputEnd = totalOutputDurationUs(project);
  const timeline = buildTimeline(project);

  const pieces: CuePiece[] = [];
  let dropped = 0;
  let split = 0;
  for (const cue of track.cues) {
    const to = Math.min(cue.endUs, outputEnd);
    const mine: CuePiece[] = [];
    for (const entry of timeline) {
      if (entry.assetId !== video.assetId) continue;
      const a = Math.max(cue.startUs, entry.startUs);
      const b = Math.min(to, entry.endUs);
      if (b <= a) continue;
      const startUs = entry.sourceInUs + (a - entry.startUs);
      const endUs = entry.sourceInUs + (b - entry.startUs);
      const previous = mine[mine.length - 1];
      // Consecutive moments that are contiguous in the file: one line again.
      if (previous && previous.endUs === startUs) previous.endUs = endUs;
      else mine.push({ from: cue.cueId, startUs, endUs, text: cue.text });
    }
    const long = mine.filter((piece) => piece.endUs - piece.startUs >= CAPTION_LIMITS.minCueDurationUs);
    dropped += mine.length === 0 ? 1 : mine.length - long.length;
    if (long.length > 1) split += 1;
    pieces.push(...long);
  }

  pieces.sort((a, b) => a.startUs - b.startUs);
  for (let index = 1; index < pieces.length; index += 1) {
    const before = pieces[index - 1];
    const current = pieces[index];
    if (!before || !current || current.startUs >= before.endUs) continue;
    if (before.from === current.from) {
      // The same line over a range used twice: one source line covers both.
      before.endUs = Math.max(before.endUs, current.endUs);
      pieces.splice(index, 1);
      index -= 1;
      continue;
    }
    return { ok: false, reason: 'caption_conversion_conflict', cueIds: [before.from, current.from] };
  }

  return {
    ok: true,
    report: { split, dropped },
    project: withTrack(project, (current) => ({
      ...current,
      timeBase: 'source',
      assetId: video.assetId,
      cues: reassignIds(pieces),
    })),
  };
}

export type ShiftCaptionsResult =
  | { ok: true; project: Project }
  | { ok: false; reason: 'caption_no_track' | 'caption_shift_out_of_range' };

/**
 * Moves every line by the same amount (sync fix for a file that runs early or
 * late). Refused, not clamped, when any line would leave its clock: clamping
 * would squash lines together at the edge.
 */
export function shiftCaptions(project: Project, deltaUs: Micros): ShiftCaptionsResult {
  const track = primaryCaptionTrack(project);
  if (!track || track.cues.length === 0) return { ok: false, reason: 'caption_no_track' };
  const delta = Math.round(deltaUs);
  if (delta === 0) return { ok: true, project };
  const clock = trackClock(project);
  const moved = track.cues.map((cue) => ({ ...cue, startUs: cue.startUs + delta, endUs: cue.endUs + delta }));
  const outOfRange = moved.some(
    (cue) => cue.startUs < 0 || (track.timeBase === 'source' && cue.endUs > clock.endUs),
  );
  if (outOfRange) return { ok: false, reason: 'caption_shift_out_of_range' };
  return { ok: true, project: withTrack(project, (current) => ({ ...current, cues: moved })) };
}

export interface ImportedCueInput {
  startUs: Micros;
  endUs: Micros;
  text: string;
}

export type ImportSkipReason =
  | CaptionTextProblem
  | 'range_reversed'
  | 'caption_cue_too_short'
  | 'caption_cue_overlap'
  | 'range_out_of_source'
  | 'caption_limit_exceeded';

export interface CaptionImportReport {
  imported: number;
  /** `index` is the line's position in the file (0-based), for the user report. */
  skipped: { index: number; reason: ImportSkipReason }[];
}

export type CaptionImportResult =
  | { ok: true; project: Project; report: CaptionImportReport }
  | { ok: false; reason: 'caption_no_video' | 'caption_import_empty'; report?: CaptionImportReport };

/**
 * Replaces the caption track with lines from a subtitle file.
 *
 * The caller MUST say which clock the file was timed against (ADR-009: never
 * guess the time base silently). Every line that breaks a rule is skipped and
 * reported by its position in the file; nothing is stretched or merged to
 * make it fit. Output-time lines past the current end are kept, like typed
 * lines (the render plan cuts them); source-time lines must lie in the video.
 * Style and language of an existing track are kept. One undo step.
 */
export function importCaptionTrack(
  project: Project,
  cues: readonly ImportedCueInput[],
  timeBase: CaptionTrackV2['timeBase'],
): CaptionImportResult {
  const video = primaryVideoAsset(project);
  if (timeBase === 'source' && !video) return { ok: false, reason: 'caption_no_video' };

  const skipped: CaptionImportReport['skipped'] = [];
  const accepted: Omit<CaptionCueV2, 'cueId'>[] = [];
  const order = cues
    .map((cue, index) => ({ cue, index }))
    .sort((a, b) => a.cue.startUs - b.cue.startUs || a.index - b.index);

  for (const { cue, index } of order) {
    const text = normalizeCaptionText(cue.text);
    const problem = captionTextProblem(text);
    const startUs = Math.round(cue.startUs);
    const endUs = Math.round(cue.endUs);
    const last = accepted[accepted.length - 1];
    let reason: ImportSkipReason | null = null;
    if (problem) reason = problem;
    else if (!(endUs > startUs) || startUs < 0) reason = 'range_reversed';
    else if (endUs - startUs < CAPTION_LIMITS.minCueDurationUs) reason = 'caption_cue_too_short';
    else if (timeBase === 'source' && video && endUs > video.durationUs) reason = 'range_out_of_source';
    else if (last && startUs < last.endUs) reason = 'caption_cue_overlap';
    else if (accepted.length >= CAPTION_LIMITS.maxCuesPerTrack) reason = 'caption_limit_exceeded';

    if (reason) skipped.push({ index, reason });
    else accepted.push({ startUs, endUs, text });
  }
  skipped.sort((a, b) => a.index - b.index);
  const report = { imported: accepted.length, skipped };
  if (accepted.length === 0) return { ok: false, reason: 'caption_import_empty', report };

  const numbered = accepted.map((cue, position) => ({
    cueId: `q_${String(position + 1).padStart(3, '0')}`,
    ...cue,
  }));
  const next = withTrack(project, (current) => {
    const { assetId: _unused, ...rest } = current;
    return {
      ...rest,
      origin: 'imported',
      timeBase,
      ...(timeBase === 'source' && video ? { assetId: video.assetId } : {}),
      cues: numbered,
    };
  });
  return { ok: true, project: next, report };
}

/* --------------------------------------------- silence cuts (ADR-018) */

export interface SilenceCutReport {
  /** Output time removed. */
  removedUs: Micros;
  clipsBefore: number;
  clipsAfter: number;
  /** Pieces shorter than a moment may be (0.1 s) that were left out. */
  droppedPieces: number;
}

export type SilenceCutResult =
  | { ok: true; project: Project; report: SilenceCutReport }
  | { ok: false; reason: 'clip_limit_exceeded'; clipsAfter: number }
  | { ok: false; reason: 'nothing_to_remove' };

/**
 * Removes the user-approved source ranges from their moments, in one undo
 * step (doc 31: suggestions are applied only after the user reviewed them).
 *
 * Each moment becomes the pieces that remain, in order; the first piece
 * keeps the moment's id, the others get new ids, and every piece keeps the
 * moment's settings (gain, mute, view). A remainder shorter than the minimum
 * moment length is left out and counted. The moment limit is never relaxed:
 * a result that would exceed it is refused, so the caller can offer fewer
 * cuts (`selectWithinClipLimit`).
 */
export function applySilenceCuts(
  project: Project,
  removals: readonly ClipSilence[],
  policy: ExportPolicy = WEB_LOCAL_POLICY,
): SilenceCutResult {
  if (removals.length === 0) return { ok: false, reason: 'nothing_to_remove' };

  const clips: ClipV1[] = [];
  const taken = project.clips.map((clip) => clip.clipId);
  let dropped = 0;
  let removedUs = 0;
  for (const clip of project.clips) {
    const mine = removals.filter((removal) => removal.clipId === clip.clipId);
    if (mine.length === 0) {
      clips.push(clip);
      continue;
    }
    const pieces = piecesAfterRemoval(clip.sourceInUs, clip.sourceOutUs, mine);
    const kept = pieces.filter((piece) => piece.endUs - piece.startUs >= MIN_CLIP_DURATION_US);
    dropped += pieces.length - kept.length;
    const keptUs = kept.reduce((sum, piece) => sum + (piece.endUs - piece.startUs), 0);
    removedUs += clip.sourceOutUs - clip.sourceInUs - keptUs;
    kept.forEach((piece, index) => {
      const clipId = index === 0 ? clip.clipId : nextId('c', taken);
      if (index > 0) taken.push(clipId);
      clips.push({
        ...clip,
        clipId,
        sourceInUs: piece.startUs,
        sourceOutUs: piece.endUs,
        view: { ...clip.view },
      });
    });
  }

  if (removedUs === 0) return { ok: false, reason: 'nothing_to_remove' };
  if (clips.length > policy.maxClips) {
    return { ok: false, reason: 'clip_limit_exceeded', clipsAfter: clips.length };
  }
  return {
    ok: true,
    project: bump(project, { clips }),
    report: { removedUs, clipsBefore: project.clips.length, clipsAfter: clips.length, droppedPieces: dropped },
  };
}

/**
 * Picks the longest suggestions that still fit the moment limit. An inner cut
 * adds a moment, an edge cut does not, so a shorter edge cut can still be
 * taken after a longer inner one no longer fits. Returns what fits and how
 * many were left out, so the UI can say so instead of silently dropping them.
 */
export function selectWithinClipLimit(
  project: Project,
  suggestions: readonly ClipSilence[],
  policy: ExportPolicy = WEB_LOCAL_POLICY,
): { selected: ClipSilence[]; leftOut: number } {
  const byLength = [...suggestions].sort(
    (a, b) => b.endUs - b.startUs - (a.endUs - a.startUs) || a.startUs - b.startUs,
  );
  const selected: ClipSilence[] = [];
  const countFor = (chosen: readonly ClipSilence[]) =>
    project.clips.reduce((total, clip) => {
      const mine = chosen.filter((removal) => removal.clipId === clip.clipId);
      if (mine.length === 0) return total + 1;
      return (
        total +
        piecesAfterRemoval(clip.sourceInUs, clip.sourceOutUs, mine).filter(
          (piece) => piece.endUs - piece.startUs >= MIN_CLIP_DURATION_US,
        ).length
      );
    }, 0);
  for (const suggestion of byLength) {
    if (countFor([...selected, suggestion]) <= policy.maxClips) selected.push(suggestion);
  }
  selected.sort((a, b) => a.startUs - b.startUs);
  return { selected, leftOut: suggestions.length - selected.length };
}
