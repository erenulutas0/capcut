/**
 * Output timeline maths.
 *
 * Output time and source time are two different clocks and the UI must never
 * blur them (doc 09 "Zaman modeli"). Clips are laid out back to back with no
 * gaps; position is derived from array order, never stored.
 */

import type { MusicV1, Project } from './edl';
import type { Micros } from './time';

export interface TimelineEntry {
  clipId: string;
  assetId: string;
  index: number;
  /** Half-open output range: [startUs, endUs). */
  startUs: Micros;
  endUs: Micros;
  durationUs: Micros;
  sourceInUs: Micros;
  sourceOutUs: Micros;
}

export interface OutputPosition {
  entry: TimelineEntry;
  /** Offset inside the clip, i.e. outputUs - entry.startUs. */
  offsetInClipUs: Micros;
  /** The source timestamp that should be shown at this output time. */
  sourceUs: Micros;
}

export function clipDurationUs(clip: { sourceInUs: Micros; sourceOutUs: Micros }): Micros {
  return clip.sourceOutUs - clip.sourceInUs;
}

export function buildTimeline(project: Pick<Project, 'clips'>): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  let cursor = 0;
  project.clips.forEach((clip, index) => {
    const durationUs = clipDurationUs(clip);
    entries.push({
      clipId: clip.clipId,
      assetId: clip.assetId,
      index,
      startUs: cursor,
      endUs: cursor + durationUs,
      durationUs,
      sourceInUs: clip.sourceInUs,
      sourceOutUs: clip.sourceOutUs,
    });
    cursor += durationUs;
  });
  return entries;
}

/** Total output duration = sum of clip durations (no transitions, no speed). */
export function totalOutputDurationUs(project: Pick<Project, 'clips'>): Micros {
  return project.clips.reduce((total, clip) => total + clipDurationUs(clip), 0);
}

export function totalSourceDurationUs(project: Pick<Project, 'assets'>): Micros {
  return project.assets
    .filter((asset) => asset.kind === 'video')
    .reduce((total, asset) => total + asset.durationUs, 0);
}

/**
 * Maps an output timestamp to the clip and source timestamp playing there.
 * Half-open: outputUs === totalDuration belongs to no clip.
 */
export function mapOutputToSource(
  project: Pick<Project, 'clips'>,
  outputUs: Micros,
): OutputPosition | null {
  if (outputUs < 0) return null;
  const timeline = buildTimeline(project);
  for (const entry of timeline) {
    if (outputUs >= entry.startUs && outputUs < entry.endUs) {
      const offsetInClipUs = outputUs - entry.startUs;
      return {
        entry,
        offsetInClipUs,
        sourceUs: entry.sourceInUs + offsetInClipUs,
      };
    }
  }
  return null;
}

/**
 * Inverse mapping for a chosen clip occurrence. The same source range may be
 * used twice, so the clip index — not the source time — identifies the answer.
 */
export function mapSourceToOutput(
  project: Pick<Project, 'clips'>,
  clipIndex: number,
  sourceUs: Micros,
): Micros | null {
  const timeline = buildTimeline(project);
  const entry = timeline[clipIndex];
  if (!entry) return null;
  if (sourceUs < entry.sourceInUs || sourceUs >= entry.sourceOutUs) return null;
  return entry.startUs + (sourceUs - entry.sourceInUs);
}

export interface MusicPosition {
  /** Source timestamp inside the music file, or null when music is silent here. */
  sourceUs: Micros | null;
  /** Linear fade multiplier in [0, 1] from the fade in/out envelope. */
  fadeGain: number;
}

/**
 * doc 09: `musicSourceTime = sourceIn + (outputTime - timelineStart)`, applied
 * only inside the valid range. Short music never loops by itself.
 */
export function mapOutputToMusic(music: MusicV1, outputUs: Micros): MusicPosition {
  const offset = outputUs - music.timelineStartUs;
  const selectionUs = music.sourceOutUs - music.sourceInUs;
  if (offset < 0 || offset >= selectionUs) {
    return { sourceUs: null, fadeGain: 0 };
  }

  let fadeGain = 1;
  if (music.fadeInUs > 0 && offset < music.fadeInUs) {
    fadeGain = offset / music.fadeInUs;
  }
  if (music.fadeOutUs > 0 && offset > selectionUs - music.fadeOutUs) {
    const remaining = selectionUs - offset;
    fadeGain = Math.min(fadeGain, remaining / music.fadeOutUs);
  }

  return {
    sourceUs: music.sourceInUs + offset,
    fadeGain: Math.max(0, Math.min(1, fadeGain)),
  };
}

export function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

/**
 * doc 09 mix-safety proposal: `10^(-1/20) / max(1, maxConcurrentGainSum)`.
 * This is headroom protection, not loudness normalisation, and the UI says so.
 */
export function mixSafetyGain(concurrentLinearGains: number[]): number {
  const sum = concurrentLinearGains.reduce((total, gain) => total + gain, 0);
  return Math.pow(10, -1 / 20) / Math.max(1, sum);
}
