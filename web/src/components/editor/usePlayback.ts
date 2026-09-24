'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

import type { Project } from '@/domain/edl';
import { dbToLinear, mapOutputToMusic } from '@/domain/timeline';
import { US_PER_SECOND, secondsToUs, type Micros } from '@/domain/time';

/** Resync the music element when it drifts more than this from the video. */
const MUSIC_RESYNC_US = 150_000;

interface PlaybackArgs {
  /** DOM refs are owned by the component; the hook only drives them. */
  videoRef: RefObject<HTMLVideoElement | null>;
  musicRef: RefObject<HTMLAudioElement | null>;
  project: Project;
  hasVideo: boolean;
  hasMusicFile: boolean;
}

/** A kesit being played on its own (the card's ▶): its source range. */
export interface PlayingRange {
  clipId: string;
  inUs: Micros;
  outUs: Micros;
}

/**
 * The one clock of the editor (ADR-026): the video's own time.
 *
 * Watching is plain media playback of the source file. A kesit's ▶ plays
 * only that range — it starts at the kesit's start and stops at its end —
 * with the kesit's sound settings and the music as that kesit's own download
 * would have them (music starts with each downloaded video).
 */
export function usePlayback({ videoRef, musicRef, project, hasVideo, hasMusicFile }: PlaybackArgs) {
  const frameRef = useRef<number | null>(null);
  const rangeRef = useRef<PlayingRange | null>(null);
  /** True while an edge drag shows a frame; the clock is not followed then. */
  const peekingRef = useRef(false);

  const [playing, setPlaying] = useState(false);
  const [timeUs, setTimeUs] = useState<Micros>(0);
  const [range, setRange] = useState<PlayingRange | null>(null);
  const [playbackError, setPlaybackError] = useState(false);

  const endRange = useCallback(() => {
    rangeRef.current = null;
    setRange(null);
  }, []);

  const stop = useCallback(() => {
    videoRef.current?.pause();
    musicRef.current?.pause();
    setPlaying(false);
    endRange();
  }, [endRange, videoRef, musicRef]);

  /** Moves the playhead. Playback of a kesit's range ends here: the user went elsewhere. */
  const seek = useCallback(
    (targetUs: Micros) => {
      peekingRef.current = false;
      const video = videoRef.current;
      const us = Math.max(0, Math.round(targetUs));
      if (rangeRef.current && (us < rangeRef.current.inUs || us >= rangeRef.current.outUs)) {
        endRange();
        musicRef.current?.pause();
      }
      if (video) video.currentTime = us / US_PER_SECOND;
      setTimeUs(us);
    },
    [endRange, videoRef, musicRef],
  );

  /**
   * Shows one frame without moving the playhead state: the frame at an edge
   * being dragged. Any seek hands control back to the clock.
   */
  const peek = useCallback(
    (us: Micros) => {
      const video = videoRef.current;
      if (!video) return;
      peekingRef.current = true;
      video.currentTime = Math.max(0, us) / US_PER_SECOND;
    },
    [videoRef],
  );

  const start = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    // Playback can be refused (autoplay policy, unsupported stream); surface
    // it instead of leaving a dead play button.
    video
      .play()
      .then(() => {
        setPlaying(true);
        setPlaybackError(false);
      })
      .catch(() => {
        setPlaying(false);
        setPlaybackError(true);
        endRange();
      });
  }, [endRange, videoRef]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (playing) {
      stop();
      return;
    }
    peekingRef.current = false;
    // At the very end, play again from the start.
    if (video.ended || (video.duration > 0 && video.currentTime >= video.duration - 0.001)) {
      video.currentTime = 0;
      setTimeUs(0);
    }
    endRange();
    start();
  }, [endRange, playing, start, stop, videoRef]);

  /** ▶ on a kesit: plays exactly [in, out) and stops at its end. */
  const playRange = useCallback(
    (next: PlayingRange) => {
      const video = videoRef.current;
      if (!video) return;
      peekingRef.current = false;
      rangeRef.current = next;
      setRange(next);
      video.currentTime = next.inUs / US_PER_SECOND;
      setTimeUs(next.inUs);
      const music = musicRef.current;
      if (music && project.music && hasMusicFile) {
        const position = mapOutputToMusic(project.music, 0);
        if (position.sourceUs !== null) music.currentTime = position.sourceUs / US_PER_SECOND;
      }
      start();
    },
    [hasMusicFile, musicRef, project.music, start, videoRef],
  );

  // The clock follows the video element.
  useEffect(() => {
    if (!hasVideo) return undefined;

    const tick = () => {
      const video = videoRef.current;
      if (video && !peekingRef.current) {
        const us = secondsToUs(video.currentTime);
        setTimeUs(us);
        const active = rangeRef.current;
        if (active && !video.paused) {
          if (us >= active.outUs - 1000 || video.ended) {
            // The end of the kesit: stop on its last frame, not past it.
            video.pause();
            musicRef.current?.pause();
            setPlaying(false);
            rangeRef.current = null;
            setRange(null);
          } else {
            const clip = project.clips.find((item) => item.clipId === active.clipId);
            video.muted = clip ? clip.muted : false;
            video.volume = clip && !clip.muted ? dbToLinear(clip.sourceGainDb) : 1;
            const music = musicRef.current;
            if (music && project.music && hasMusicFile) {
              const position = mapOutputToMusic(project.music, us - active.inUs);
              if (position.sourceUs === null || project.music.muted) {
                if (!music.paused) music.pause();
              } else {
                music.volume = Math.max(0, Math.min(1, dbToLinear(project.music.gainDb) * position.fadeGain));
                const drift = Math.abs(secondsToUs(music.currentTime) - position.sourceUs);
                if (drift > MUSIC_RESYNC_US) music.currentTime = position.sourceUs / US_PER_SECOND;
                if (music.paused) void music.play().catch(() => undefined);
              }
            }
          }
        } else if (!active) {
          // Watching the video itself: its own sound, no music.
          video.muted = false;
          video.volume = 1;
          if (musicRef.current && !musicRef.current.paused) musicRef.current.pause();
        }
        if (video.paused && playing && !active) setPlaying(false);
      }
      frameRef.current = window.requestAnimationFrame(tick);
    };

    frameRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    };
  }, [hasMusicFile, hasVideo, musicRef, playing, project.clips, project.music, videoRef]);

  return {
    playing,
    playbackError,
    timeUs,
    range,
    togglePlay,
    stop,
    seek,
    peek,
    playRange,
  };
}
