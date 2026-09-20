/**
 * Render plan compilation (doc 09, phase 6 "Render planı derleme").
 *
 * Turns a validated EDL into a deterministic, framework-free description of
 * exactly which frames to produce. Every timing decision happens here and is
 * unit-tested, so the worker only executes — it never reinterprets the recipe.
 *
 * Output frames sit on a fixed fps grid. The EDL stays in microseconds; the
 * grid is derived once, with documented rounding, at this boundary only.
 */

import {
  outputPixelSize,
  type AspectRatio,
  type FitMode,
  type MusicV1,
  type ProjectV1,
} from './edl';
import type { ExportPolicy } from './policy';
import { totalOutputDurationUs } from './timeline';
import { cropPixels, type CropRect } from './transform';
import { US_PER_SECOND, type Micros } from './time';

/** Bumped whenever the compiler changes the frames it would produce. */
export const RENDER_PLAN_VERSION = 1;
export const RENDER_ENGINE_ID = 'web-webcodecs-mediabunny@1';

export interface RenderSegment {
  clipId: string;
  assetId: string;
  /** Half-open output frame range: [startFrame, endFrame). */
  startFrame: number;
  endFrame: number;
  sourceInUs: Micros;
  sourceOutUs: Micros;
  /** Source-pixel rectangle over the orientation-corrected image. */
  crop: CropRect;
  fit: FitMode;
  /** Linear gain already resolved from dB; 0 when muted. */
  gain: number;
  muted: boolean;
}

export interface RenderMusicPlan {
  assetId: string;
  sourceInUs: Micros;
  sourceOutUs: Micros;
  timelineStartUs: Micros;
  gain: number;
  fadeInUs: Micros;
  fadeOutUs: Micros;
}

export interface RenderAudioPlan {
  sampleRate: number;
  channelCount: number;
  /**
   * Common headroom reduction applied to the whole mix so two simultaneous
   * sources cannot clip (doc 09: `10^(-1/20) / max(1, maxConcurrentGainSum)`).
   */
  safetyGain: number;
  /**
   * True when at least one segment is unmuted, i.e. the user WANTS the source
   * audio. Whether the file actually has a decodable audio track is the
   * engine's question, not the editor's — it asks the demuxer.
   */
  wantsSourceAudio: boolean;
  music: RenderMusicPlan | null;
}

export interface RenderPlan {
  planVersion: typeof RENDER_PLAN_VERSION;
  engineId: string;
  fingerprint: string;
  container: 'mp4';
  videoCodec: 'avc';
  audioCodec: 'aac';
  width: number;
  height: number;
  aspect: AspectRatio;
  background: string;
  fpsNum: number;
  fpsDen: number;
  totalFrames: number;
  /** Exact duration the output must have, derived from the frame grid. */
  expectedDurationUs: Micros;
  /** Duration the EDL asks for, before frame quantisation. */
  requestedDurationUs: Micros;
  videoBitrate: number;
  audioBitrate: number;
  segments: RenderSegment[];
  audio: RenderAudioPlan;
}

export type PlanRejection =
  | 'no_clips'
  | 'missing_source_dimensions'
  | 'unknown_asset'
  | 'output_duration_exceeds_policy'
  | 'zero_frames';

export type PlanResult = { ok: true; plan: RenderPlan } | { ok: false; reason: PlanRejection };

export function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

/** Frame index for an output timestamp; the single rounding rule of the grid. */
export function frameAtUs(us: Micros, fpsNum: number, fpsDen: number): number {
  return Math.round((us * fpsNum) / (fpsDen * US_PER_SECOND));
}

export function frameToUs(frame: number, fpsNum: number, fpsDen: number): Micros {
  return Math.round((frame * fpsDen * US_PER_SECOND) / fpsNum);
}

/**
 * Target bitrates. Deliberately a small documented table rather than a
 * "quality" guess: the same recipe must give the same file on every run.
 */
function videoBitrateFor(width: number, height: number, fps: number): number {
  const pixelsPerSecond = width * height * fps;
  // ~0.09 bits per pixel: 1080p30 -> ~5.6 Mbit/s, 720p30 -> ~2.5 Mbit/s.
  const bitrate = Math.round(pixelsPerSecond * 0.09);
  return Math.max(500_000, Math.min(12_000_000, bitrate));
}

/** FNV-1a over the canonical plan body. Cache key only, not a security hash. */
function fingerprintOf(body: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < body.length; i += 1) {
    hash ^= body.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fp_${hash.toString(16).padStart(8, '0')}`;
}

function musicPlan(music: MusicV1): RenderMusicPlan {
  return {
    assetId: music.assetId,
    sourceInUs: music.sourceInUs,
    sourceOutUs: music.sourceOutUs,
    timelineStartUs: music.timelineStartUs,
    gain: music.muted ? 0 : dbToLinear(music.gainDb),
    fadeInUs: music.fadeInUs,
    fadeOutUs: music.fadeOutUs,
  };
}

export function compileRenderPlan(project: ProjectV1, policy: ExportPolicy): PlanResult {
  if (project.clips.length === 0) return { ok: false, reason: 'no_clips' };

  const requestedDurationUs = totalOutputDurationUs(project);
  if (requestedDurationUs > policy.maxOutputDurationUs) {
    return { ok: false, reason: 'output_duration_exceeds_policy' };
  }

  const { fpsNum, fpsDen, shortEdge, audioSampleRate } = project.export;
  const { width, height } = outputPixelSize(project.canvas.aspect, shortEdge);

  const segments: RenderSegment[] = [];
  let cursorUs = 0;
  let wantsSourceAudio = false;
  let maxSegmentGain = 0;

  for (const clip of project.clips) {
    const asset = project.assets.find((item) => item.assetId === clip.assetId);
    if (!asset) return { ok: false, reason: 'unknown_asset' };
    if (!asset.displayWidth || !asset.displayHeight) {
      return { ok: false, reason: 'missing_source_dimensions' };
    }

    const durationUs = clip.sourceOutUs - clip.sourceInUs;
    const startFrame = frameAtUs(cursorUs, fpsNum, fpsDen);
    const endFrame = frameAtUs(cursorUs + durationUs, fpsNum, fpsDen);
    const gain = clip.muted ? 0 : dbToLinear(clip.sourceGainDb);
    if (gain > 0) wantsSourceAudio = true;
    maxSegmentGain = Math.max(maxSegmentGain, gain);

    segments.push({
      clipId: clip.clipId,
      assetId: clip.assetId,
      startFrame,
      endFrame,
      sourceInUs: clip.sourceInUs,
      sourceOutUs: clip.sourceOutUs,
      crop: cropPixels(clip.view, asset.displayWidth, asset.displayHeight),
      fit: clip.view.fit,
      gain,
      muted: clip.muted,
    });

    cursorUs += durationUs;
  }

  const totalFrames = segments[segments.length - 1]?.endFrame ?? 0;
  if (totalFrames <= 0) return { ok: false, reason: 'zero_frames' };

  const music = project.music ? musicPlan(project.music) : null;

  // The loudest moment is one segment plus the music playing together.
  const concurrent = maxSegmentGain + (music?.gain ?? 0);
  const safetyGain = Math.pow(10, -1 / 20) / Math.max(1, concurrent);

  const fps = fpsNum / fpsDen;
  const audio: RenderAudioPlan = {
    sampleRate: audioSampleRate,
    channelCount: 2,
    safetyGain,
    wantsSourceAudio,
    music,
  };

  const body = JSON.stringify({
    v: RENDER_PLAN_VERSION,
    engine: RENDER_ENGINE_ID,
    width,
    height,
    fpsNum,
    fpsDen,
    totalFrames,
    codecs: ['avc', 'aac'],
    background: project.canvas.background,
    segments: segments.map((segment) => [
      segment.assetId,
      segment.startFrame,
      segment.endFrame,
      segment.sourceInUs,
      segment.sourceOutUs,
      segment.crop.x,
      segment.crop.y,
      segment.crop.width,
      segment.crop.height,
      segment.fit,
      segment.gain,
    ]),
    audio,
  });

  return {
    ok: true,
    plan: {
      planVersion: RENDER_PLAN_VERSION,
      engineId: RENDER_ENGINE_ID,
      fingerprint: fingerprintOf(body),
      container: 'mp4',
      videoCodec: 'avc',
      audioCodec: 'aac',
      width,
      height,
      aspect: project.canvas.aspect,
      background: project.canvas.background,
      fpsNum,
      fpsDen,
      totalFrames,
      expectedDurationUs: frameToUs(totalFrames, fpsNum, fpsDen),
      requestedDurationUs,
      videoBitrate: videoBitrateFor(width, height, fps),
      audioBitrate: 128_000,
      segments,
      audio,
    },
  };
}

/** Source timestamp (seconds) to sample for a given output frame. */
export function sourceTimeForFrame(
  segment: RenderSegment,
  frame: number,
  fpsNum: number,
  fpsDen: number,
): number {
  const offsetUs = frameToUs(frame - segment.startFrame, fpsNum, fpsDen);
  return (segment.sourceInUs + offsetUs) / US_PER_SECOND;
}
