/**
 * "LiloCut'a paylaş" (ADR-047): the Web Share Target's inbox, in one place for both sides.
 *
 * - The service worker (scripts/lib/service-worker.js) receives the POST that Android's share sheet
 *   makes to `<base>/paylas/` and keeps the first video of it here (`receiveShare`). build-sw.mjs
 *   writes this file into sw.js as it is, without its `export` words (precache.mjs, `inlineModule`):
 *   so it is written as plain functions, no imports, nothing the worker does not have.
 * - The page (src/adapters/pwa/sharedVideo.ts) reads that copy back (`readShareEntry`) and deletes it
 *   as soon as a task has taken the video; every page start and a timer sweep the rest
 *   (`sweepShares`).
 *
 * Where: Cache Storage, a cache of its own (`clip-shared`), one entry at most. Not IndexedDB (the
 * projects' database, whose schema this must not touch) and never OPFS (the export's files). Cache
 * Storage is the one store both a service worker and a page reach without a schema, and `cache.put`
 * writes the shared file to disk as it comes, without reading it into memory first.
 *
 * Nothing here sends anything anywhere: the file goes from the request the browser made on this
 * device into this browser's own storage, and from there into the page.
 */

/** The cache that holds a shared video until a task takes it. Not `clip-app-*`: the offline copy's own sweep must not touch it. */
export const SHARE_CACHE = 'clip-shared';

/** A shared video nobody took is deleted this long after it arrived (page timer, every start, the worker's activation). */
export const SHARE_TTL_MS = 15 * 60 * 1000;

/** The share target's address under the base path (manifest `share_target.action`). */
export const SHARE_ACTION_PATH = '/paylas/';

/** The page's address carries which shared video it is about: `?paylasim=<id>`. */
export const SHARE_PARAM = 'paylasim';

/** …or why there is none: `?paylasim-hata=<reason>`. */
export const SHARE_ERROR_PARAM = 'paylasim-hata';

/** A wizard opened from the opening screen with a video the user picked there (not shared): `?paylasim=secilen`. */
export const SHARE_PICKED_ID = 'secilen';

/** Why a share did not leave a video behind. */
export const SHARE_ERRORS = ['video-degil', 'bos', 'yer', 'okunamadi'];

const HEADER_NAME = 'x-clip-name';
const HEADER_MODIFIED = 'x-clip-modified';
const HEADER_AT = 'x-clip-shared-at';
const HEADER_COUNT = 'x-clip-shared-count';

/** File name endings of videos, for a file that arrives without a type (some apps share `application/octet-stream`). */
const VIDEO_ENDINGS = /\.(mp4|m4v|mov|qt|3gp|3g2|webm|mkv|avi|mpg|mpeg|ts|mts|m2ts|wmv|flv)$/i;

/** The shared entry's key: an address nothing serves (the worker never answers it, the host has no such file). */
export function shareEntryPath(base, id) {
  return `${base}/paylas/dosya/${id}`;
}

/** A form value that is a file (the browser's `File`, or anything with its shape in a test). */
function isFile(value) {
  return value !== null && typeof value === 'object' && typeof value.name === 'string' && typeof value.size === 'number';
}

/** Is this shared file a video? By its type; by its name only when it has no real type. */
export function isVideoFile(file) {
  const type = typeof file.type === 'string' ? file.type.toLowerCase() : '';
  if (type.startsWith('video/')) return true;
  if (type !== '' && type !== 'application/octet-stream') return false;
  return VIDEO_ENDINGS.test(file.name);
}

/**
 * The files of a share, in the order the sending app gave them, from every field of the form (the
 * manifest names one, `video`; an app that names its own is still heard): the first video, and how
 * many files came in all.
 */
export function chooseSharedVideo(form) {
  const files = [];
  for (const entry of form.entries()) {
    const value = entry[1];
    if (isFile(value) && (value.size > 0 || value.name !== '')) files.push(value);
  }
  const video = files.find(isVideoFile) ?? null;
  return { video, count: files.length };
}

/** The address the share ends on: the opening screen, with what happened. */
export function shareRedirect(base, outcome) {
  const home = `${base}/`;
  if ('id' in outcome) return `${home}?${SHARE_PARAM}=${encodeURIComponent(outcome.id)}`;
  return `${home}?${SHARE_ERROR_PARAM}=${encodeURIComponent(outcome.error)}`;
}

/** A short id: the time it came, and a few random letters (two shares in one millisecond stay apart). */
export function newShareId(now, random) {
  const letters = Math.floor(random * 36 ** 6)
    .toString(36)
    .padStart(6, '0');
  return `${now.toString(36)}-${letters}`;
}

function quotaError(error) {
  return Boolean(error) && (error.name === 'QuotaExceededError' || error.code === 22);
}

/** Deletes every shared video but `keep` (one share at a time: a new one replaces the old). */
async function clearShares(cachesApi, keep) {
  if (!(await cachesApi.has(SHARE_CACHE))) return 0;
  const cache = await cachesApi.open(SHARE_CACHE);
  let removed = 0;
  for (const request of await cache.keys()) {
    if (keep && request.url.endsWith(`/${keep}`)) continue;
    if (await cache.delete(request)) removed += 1;
  }
  return removed;
}

/**
 * The worker's side: the share POST → the redirect's address. The first video of the form is put in
 * `clip-shared` under a new id, with its name, type, time and the number of files that came in its
 * headers; any older shared video is deleted first. A share with no video in it, a form that cannot
 * be read and a full disk each end on the opening screen with the reason, and nothing is kept.
 */
export async function receiveShare({ request, cachesApi, base, now, random }) {
  let form;
  try {
    form = await request.formData();
  } catch {
    return shareRedirect(base, { error: 'okunamadi' });
  }
  const { video, count } = chooseSharedVideo(form);
  if (!video) return shareRedirect(base, { error: count === 0 ? 'bos' : 'video-degil' });
  await clearShares(cachesApi, null);
  const id = newShareId(now, random);
  try {
    const cache = await cachesApi.open(SHARE_CACHE);
    const headers = {
      'content-type': video.type || 'application/octet-stream',
      [HEADER_NAME]: encodeURIComponent(video.name || 'video'),
      [HEADER_MODIFIED]: String(typeof video.lastModified === 'number' ? video.lastModified : now),
      [HEADER_AT]: String(now),
      [HEADER_COUNT]: String(count),
    };
    await cache.put(shareEntryPath(base, id), new Response(video, { headers }));
  } catch (error) {
    // Half a copy is no copy: nothing of this share stays behind.
    await clearShares(cachesApi, null).catch(() => 0);
    return shareRedirect(base, { error: quotaError(error) ? 'yer' : 'okunamadi' });
  }
  return shareRedirect(base, { id });
}

/** What a page start's address says about a share: `{ id }`, `{ error }` or nothing. */
export function readShareMarker(search) {
  const params = new URLSearchParams(search);
  const id = params.get(SHARE_PARAM);
  if (id && /^[a-z0-9-]{1,40}$/.test(id)) return { id };
  const error = params.get(SHARE_ERROR_PARAM);
  if (error && SHARE_ERRORS.includes(error)) return { error };
  return null;
}

/** The stored entry's facts (the response's headers), or null when they are not ours. */
export function readShareEntry(response) {
  const at = Number(response.headers.get(HEADER_AT));
  if (!Number.isFinite(at) || at <= 0) return null;
  let name = 'video';
  try {
    name = decodeURIComponent(response.headers.get(HEADER_NAME) ?? 'video') || 'video';
  } catch {
    // A name that does not decode: the plain word.
  }
  const modified = Number(response.headers.get(HEADER_MODIFIED));
  const count = Number(response.headers.get(HEADER_COUNT));
  return {
    name,
    type: response.headers.get('content-type') ?? '',
    lastModified: Number.isFinite(modified) && modified > 0 ? modified : at,
    sharedAt: at,
    count: Number.isFinite(count) && count > 0 ? Math.floor(count) : 1,
  };
}

/** Has this shared video waited longer than it may? */
export function shareExpired(sharedAt, now) {
  return !(now - sharedAt < SHARE_TTL_MS) || sharedAt > now + 60_000;
}

/**
 * Sweep: every shared video older than `SHARE_TTL_MS`, and — when `keep` is given (a page start says
 * which one its address is about, or `''` for none) — every one but that. `keep: undefined` (the
 * worker's activation) deletes only the expired. The cache itself is never created by looking:
 * a browser that was never shared to has no `clip-shared` at all. Returns how many were deleted.
 */
export async function sweepShares({ cachesApi, now, keep }) {
  if (!(await cachesApi.has(SHARE_CACHE))) return 0;
  const cache = await cachesApi.open(SHARE_CACHE);
  let removed = 0;
  for (const request of await cache.keys()) {
    const id = request.url.slice(request.url.lastIndexOf('/') + 1);
    let drop = typeof keep === 'string' && id !== keep;
    if (!drop) {
      const response = await cache.match(request);
      const facts = response ? readShareEntry(response) : null;
      drop = !facts || shareExpired(facts.sharedAt, now);
    }
    if (drop && (await cache.delete(request))) removed += 1;
  }
  const left = await cache.keys();
  if (left.length === 0) await cachesApi.delete(SHARE_CACHE);
  return removed;
}

/** A task took shared video `id`: its stored copy goes (and the cache with it when it was the last). */
export async function forgetShare({ cachesApi, base, id }) {
  if (!(await cachesApi.has(SHARE_CACHE))) return false;
  const cache = await cachesApi.open(SHARE_CACHE);
  const removed = await cache.delete(shareEntryPath(base, id));
  if ((await cache.keys()).length === 0) await cachesApi.delete(SHARE_CACHE);
  return removed;
}
