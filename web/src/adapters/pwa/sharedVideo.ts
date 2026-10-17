/**
 * The page's side of "LiloCut'a paylaş" (ADR-047).
 *
 * The service worker keeps a shared video in Cache Storage (`clip-shared`, scripts/lib/share-target.mjs)
 * and opens the opening screen with `?paylasim=<id>`. From there:
 *
 * - the opening screen reads it back as a `File` (`loadSharedVideo`) and holds it in memory
 *   (`holdVideo`): its name, length and picture are shown, and every task card carries the id;
 * - the task's wizard takes it (`takeVideoForWizard`): from memory when the press was a soft
 *   navigation, from the stored copy when the page was loaded in full (offline, or after the 10 s
 *   fallback of ADR-044) — and deletes the stored copy at once;
 * - nobody took it: the opening screen's timer deletes it 15 minutes after it came, and every page
 *   start deletes every stored share its address is not about (`sweepSharedVideos`).
 *
 * The `File` read back is the stored copy's bytes on disk, not a copy in memory. Chrome keeps such a
 * file readable after its entry is deleted, for as long as the page holds it (e2e: the GIF is made
 * from it after the deletion).
 *
 * Nothing here makes a request: Cache Storage is this browser's own storage on this device.
 */
import {
  SHARE_CACHE,
  SHARE_PARAM,
  SHARE_PICKED_ID,
  SHARE_TTL_MS,
  forgetShare,
  readShareEntry,
  readShareMarker,
  shareEntryPath,
  sweepShares,
  type ShareCaches,
  type ShareError,
} from '../../../scripts/lib/share-target.mjs';
import { BASE_PATH } from '@/basePath';

export { SHARE_PARAM, SHARE_PICKED_ID, readShareMarker, type ShareError };

/** The video in hand: shared to the app, or picked on the opening screen. */
export interface HeldVideo {
  /** The stored share's id, or `SHARE_PICKED_ID` for a video picked on the opening screen. */
  id: string;
  file: File;
  /** How many files the share brought; only the first video was kept (1 for a picked video). */
  count: number;
  /** When it was shared (ms); null for a picked video. */
  sharedAt: number | null;
  /** A `blob:` address of the file, for the opening screen's small picture. */
  url: string;
}

type Listener = () => void;

let held: HeldVideo | null = null;
const listeners = new Set<Listener>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function heldVideo(): HeldVideo | null {
  return held;
}

export function subscribeHeldVideo(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The video in hand and an address of its picture for the opening screen (one per video, revoked when replaced). */
export function holdVideo(video: Omit<HeldVideo, 'url'> | null): void {
  if (held && (!video || video.file !== held.file)) URL.revokeObjectURL(held.url);
  held = video ? { ...video, url: held && video.file === held.file ? held.url : URL.createObjectURL(video.file) } : null;
  notify();
}

function cachesApi(): ShareCaches | null {
  try {
    return typeof caches === 'undefined' ? null : (caches as unknown as ShareCaches);
  } catch {
    return null;
  }
}

/** The stored shared video `id` as a `File`, or null when it is not there (taken, swept, never shared). */
export async function loadSharedVideo(id: string): Promise<Omit<HeldVideo, 'url'> | null> {
  const api = cachesApi();
  if (!api || id === SHARE_PICKED_ID) return null;
  try {
    if (!(await api.has(SHARE_CACHE))) return null;
    const cache = await api.open(SHARE_CACHE);
    const response = await cache.match(shareEntryPath(BASE_PATH, id));
    const facts = response ? readShareEntry(response) : null;
    if (!response || !facts) return null;
    const blob = await response.blob();
    const file = new File([blob], facts.name, { type: facts.type, lastModified: facts.lastModified });
    return { id, file, count: facts.count, sharedAt: facts.sharedAt };
  } catch {
    return null;
  }
}

/** Deletes the stored copy of shared video `id` (the `File` already read from it stays readable). */
export async function forgetSharedVideo(id: string): Promise<void> {
  const api = cachesApi();
  if (!api || id === SHARE_PICKED_ID) return;
  try {
    await forgetShare({ cachesApi: api, base: BASE_PATH, id });
  } catch {
    // Storage that cannot be reached now is swept at the next start.
  }
}

/**
 * Every page start (PwaClient): deletes every stored share but the one this address is about, and
 * any that waited longer than 15 minutes. Creates nothing: a browser never shared to has no
 * `clip-shared` cache.
 */
export async function sweepSharedVideos(search: string): Promise<void> {
  const api = cachesApi();
  if (!api) return;
  const marker = readShareMarker(search);
  try {
    await sweepShares({ cachesApi: api, now: Date.now(), keep: marker && 'id' in marker ? marker.id : '' });
  } catch {
    // As above.
  }
}

/** How long the stored copy of a share may still wait (ms; 0: delete it now). */
export function shareTimeLeft(sharedAt: number, now: number): number {
  return Math.max(0, Math.min(SHARE_TTL_MS, sharedAt + SHARE_TTL_MS - now));
}

/** The address a task card opens with the video in hand: `/yap/gif?paylasim=<id>`. */
export function withHeldVideo(href: string, video: Pick<HeldVideo, 'id'> | null): string {
  return video ? `${href}?${SHARE_PARAM}=${encodeURIComponent(video.id)}` : href;
}

/**
 * What a wizard page opens with, when its address says `?paylasim=<id>`: the video in hand, or the
 * stored share (then held, so "Geri" to the opening screen still has it). The stored copy is deleted
 * as soon as it is taken. `gone`: the address names a shared video that is no longer here; `lost`:
 * a video picked on the opening screen did not survive a full page load (it was only in memory).
 */
export async function takeVideoForWizard(search: string): Promise<{ file: File } | 'gone' | 'lost' | null> {
  const id = new URLSearchParams(search).get(SHARE_PARAM);
  if (!id) return null;
  let video: Omit<HeldVideo, 'url'> | null = held && held.id === id ? held : null;
  if (!video && id === SHARE_PICKED_ID) return 'lost';
  if (!video) {
    video = await loadSharedVideo(id);
    if (video) holdVideo(video);
  }
  if (!video) return 'gone';
  await forgetSharedVideo(id);
  return { file: video.file };
}
