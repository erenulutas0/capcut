'use client';

import { useEffect, useState } from 'react';

import { US_PER_SECOND, type Micros } from '@/domain/time';

/** Small enough to keep 20 in memory as JPEG data URLs (a few KB each). */
const THUMB_HEIGHT = 54;

function keyOf(url: string, us: Micros): string {
  return `${url}@${us}`;
}

/**
 * Small pictures for the kesit cards: the frame at each kesit's start.
 *
 * One hidden `<video>` on the same object URL (the file is read from disk,
 * never copied or sent anywhere) seeks to each wanted time in turn and the
 * frame is drawn into a small canvas. Results are kept per time, so moving a
 * kesit in the list does not redraw it; changing its start does. A frame that
 * cannot be drawn is remembered as `null` and the card shows its number only.
 */
export function useThumbnails(videoUrl: string | null, times: readonly Micros[]): Record<string, string> {
  const [done, setDone] = useState<Record<string, string | null>>({});
  const wanted = videoUrl ? [...new Set(times)].filter((us) => !(keyOf(videoUrl, us) in done)) : [];
  const wantedKey = wanted.join(',');

  useEffect(() => {
    if (!videoUrl || wantedKey === '') return undefined;
    const queue = wantedKey.split(',').map(Number);
    let canceled = false;
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'auto';
    video.playsInline = true;
    video.src = videoUrl;

    const store = (us: Micros, data: string | null) =>
      setDone((current) => ({ ...current, [keyOf(videoUrl, us)]: data }));

    const next = () => {
      if (canceled) return;
      const us = queue.shift();
      if (us === undefined) return;
      const draw = () => {
        video.removeEventListener('seeked', draw);
        if (canceled) return;
        try {
          const width = Math.max(1, Math.round((video.videoWidth / Math.max(1, video.videoHeight)) * THUMB_HEIGHT));
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = THUMB_HEIGHT;
          const context = canvas.getContext('2d');
          if (!context) throw new Error('no 2d context');
          context.drawImage(video, 0, 0, width, THUMB_HEIGHT);
          store(us, canvas.toDataURL('image/jpeg', 0.7));
        } catch {
          store(us, null);
        }
        next();
      };
      video.addEventListener('seeked', draw);
      // A hair past the start: the start itself may sit before the first
      // decodable frame of a stream that does not begin at 0.
      video.currentTime = (us + 1000) / US_PER_SECOND;
    };

    const onReady = () => next();
    const onError = () => {
      for (const us of queue) store(us, null);
      queue.length = 0;
    };
    video.addEventListener('loadeddata', onReady, { once: true });
    video.addEventListener('error', onError, { once: true });
    return () => {
      canceled = true;
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('error', onError);
      video.removeAttribute('src');
      video.load();
    };
  }, [videoUrl, wantedKey]);

  const out: Record<string, string> = {};
  if (!videoUrl) return out;
  for (const us of times) {
    const data = done[keyOf(videoUrl, us)];
    if (data) out[String(us)] = data;
  }
  return out;
}
