'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

import type { Project } from '@/domain/edl';
import {
  buildTimeline,
  dbToLinear,
  mapOutputToMusic,
  mapOutputToSource,
  totalOutputDurationUs,
} from '@/domain/timeline';
import { US_PER_SECOND, secondsToUs, type Micros } from '@/domain/time';
import type { PreviewMode } from './useEditorState';

/** Resync the music element when it drifts more than this from the master clock. */
const MUSIC_RESYNC_US = 150_000;

interface PlaybackArgs {
  /** DOM refs are owned by the component; the hook only drives them. */
  videoRef: RefObject<HTMLVideoElement | null>;
  musicRef: RefObject<HTMLAudioElement | null>;
  project: Project;
  mode: PreviewMode;
  hasVideo: boolean;
  hasMusicFile: boolean;
}

/**
 * Master clock for the two preview modes.
 *
 * Source mode is plain media playback. Result mode drives the same element
 * through the output timeline: at a clip end it seeks to the next clip's source
 * in-point. That is an ordered preview, not a rendered file — the boundary can
 * stall while the browser seeks, and the UI says so.
 */
export function usePlayback({
  videoRef,
  musicRef,
  project,
  mode,
  hasVideo,
  hasMusicFile,
}: PlaybackArgs) {
  const clipIndexRef = useRef(0);
  const frameRef = useRef<number | null>(null);
  /**
   * True while an edge drag shows a source frame that may lie outside the
   * piece being played (ADR-019). The output clock is parked meanwhile.
   */
  const peekingRef = useRef(false);

  const [playing, setPlaying] = useState(false);
  const [sourceTimeUs, setSourceTimeUs] = useState<Micros>(0);
  const [outputTimeUs, setOutputTimeUs] = useState<Micros>(0);
  const [playbackError, setPlaybackError] = useState(false);

  const outputDurationUs = totalOutputDurationUs(project);

  const stop = useCallback(() => {
    videoRef.current?.pause();
    musicRef.current?.pause();
    setPlaying(false);
  }, [videoRef, musicRef]);

  /**
   * Positions the video (and music) for an output timestamp. An edit passes
   * the recipe it just produced (`target`), because the rendered one is still
   * the old recipe until React re-renders.
   */
  const seekOutput = useCallback(
    (targetUs: Micros, target: Project = project) => {
      peekingRef.current = false;
      const video = videoRef.current;
      if (!video) return;
      const totalUs = totalOutputDurationUs(target);
      const clamped = Math.max(0, Math.min(targetUs, Math.max(0, totalUs - 1)));
      const position = mapOutputToSource(target, clamped);
      if (!position) {
        setOutputTimeUs(0);
        return;
      }
      clipIndexRef.current = position.entry.index;
      video.currentTime = position.sourceUs / US_PER_SECOND;
      setOutputTimeUs(clamped);
      setSourceTimeUs(position.sourceUs);

      const music = musicRef.current;
      if (music && target.music) {
        const musicPosition = mapOutputToMusic(target.music, clamped);
        if (musicPosition.sourceUs === null) {
          music.pause();
        } else {
          music.currentTime = musicPosition.sourceUs / US_PER_SECOND;
        }
      }
    },
    [project, videoRef, musicRef],
  );

  /**
   * Shows one source frame without moving the output clock: the frame at a
   * dragged edge. `endPeek` (or any seek) returns control to the clock.
   */
  const peekSource = useCallback(
    (sourceUs: Micros) => {
      const video = videoRef.current;
      if (!video) return;
      peekingRef.current = true;
      video.currentTime = Math.max(0, sourceUs) / US_PER_SECOND;
      setSourceTimeUs(Math.max(0, sourceUs));
    },
    [videoRef],
  );

  const seekSource = useCallback(
    (targetUs: Micros) => {
      const video = videoRef.current;
      if (!video) return;
      peekingRef.current = false;
      video.currentTime = Math.max(0, targetUs) / US_PER_SECOND;
      setSourceTimeUs(Math.max(0, targetUs));
    },
    [videoRef],
  );

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (playing) {
      stop();
      return;
    }
    if (mode === 'output') {
      if (outputDurationUs <= 0) return;
      // Re-seat the clock on the current recipe before playing: an undo or
      // redo may have changed the pieces while playback was parked.
      seekOutput(outputTimeUs >= outputDurationUs - 1 ? 0 : outputTimeUs);
    }
    // Playback can be refused (autoplay policy, unsupported stream); surface it
    // instead of leaving a dead play button.
    video
      .play()
      .then(() => {
        setPlaying(true);
        setPlaybackError(false);
      })
      .catch(() => {
        setPlaying(false);
        setPlaybackError(true);
      });
  }, [mode, outputDurationUs, outputTimeUs, playing, seekOutput, stop, videoRef]);

  // Master loop.
  useEffect(() => {
    if (!hasVideo) return undefined;

    const tick = () => {
      const video = videoRef.current;
      if (video) {
        const sourceUs = secondsToUs(video.currentTime);
        setSourceTimeUs(sourceUs);
        // A parked clock is only moved by seeks: while paused (or peeking at
        // a dragged edge) the video may show a frame outside the current
        // piece, and that must not advance the output time. A video that
        // ran to the end of the file is paused too, but still has to finish.
        const parked = peekingRef.current || (video.paused && !video.ended);

        if (mode === 'output' && parked) {
          // Nothing to follow.
        } else if (mode === 'output') {
          const timeline = buildTimeline(project);
          const entry = timeline[clipIndexRef.current];
          if (!entry) {
            video.pause();
            setPlaying(false);
          } else if (sourceUs >= entry.sourceOutUs - 1000) {
            const next = timeline[clipIndexRef.current + 1];
            if (next) {
              clipIndexRef.current += 1;
              video.currentTime = next.sourceInUs / US_PER_SECOND;
              setOutputTimeUs(next.startUs);
            } else {
              video.pause();
              musicRef.current?.pause();
              setPlaying(false);
              setOutputTimeUs(outputDurationUs);
            }
          } else {
            const outputUs = entry.startUs + Math.max(0, sourceUs - entry.sourceInUs);
            setOutputTimeUs(outputUs);

            const clip = project.clips[entry.index];
            video.volume = clip && !clip.muted ? dbToLinear(clip.sourceGainDb) : 0;
            video.muted = clip ? clip.muted : false;

            const music = musicRef.current;
            if (music && project.music && hasMusicFile) {
              const position = mapOutputToMusic(project.music, outputUs);
              if (position.sourceUs === null || project.music.muted) {
                if (!music.paused) music.pause();
              } else {
                music.volume = Math.max(
                  0,
                  Math.min(1, dbToLinear(project.music.gainDb) * position.fadeGain),
                );
                const drift = Math.abs(secondsToUs(music.currentTime) - position.sourceUs);
                if (drift > MUSIC_RESYNC_US) {
                  music.currentTime = position.sourceUs / US_PER_SECOND;
                }
                if (music.paused && !video.paused) {
                  void music.play().catch(() => undefined);
                }
              }
            }
          }
        } else {
          video.volume = 1;
          video.muted = false;
          musicRef.current?.pause();
        }
      }
      frameRef.current = window.requestAnimationFrame(tick);
    };

    frameRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    };
  }, [hasVideo, hasMusicFile, mode, outputDurationUs, project, videoRef, musicRef]);

  /**
   * Called by the mode switch, not from an effect: changing mode is a user
   * event, so playback parks at a defined position exactly once.
   */
  const prepareMode = useCallback(
    (next: PreviewMode) => {
      stop();
      if (next === 'output') {
        clipIndexRef.current = 0;
        const first = project.clips[0];
        const video = videoRef.current;
        if (first && video) {
          video.currentTime = first.sourceInUs / US_PER_SECOND;
        }
        setOutputTimeUs(0);
      }
    },
    [project.clips, stop, videoRef],
  );

  return {
    prepareMode,
    playing,
    playbackError,
    sourceTimeUs,
    outputTimeUs,
    outputDurationUs,
    togglePlay,
    stop,
    seekSource,
    seekOutput,
    peekSource,
  };
}
