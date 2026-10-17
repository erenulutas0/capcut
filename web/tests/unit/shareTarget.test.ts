import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { inlineModule } from '../../scripts/lib/precache.mjs';
import {
  SHARE_CACHE,
  SHARE_TTL_MS,
  chooseSharedVideo,
  forgetShare,
  isVideoFile,
  newShareId,
  readShareEntry,
  readShareMarker,
  receiveShare,
  shareEntryPath,
  shareExpired,
  shareRedirect,
  sweepShares,
  type ShareCaches,
} from '../../scripts/lib/share-target.mjs';
import { shareTimeLeft, withHeldVideo } from '@/adapters/pwa/sharedVideo';

/**
 * "LiloCut'a paylaş" (ADR-047): the share target's inbox — what the service worker does with the
 * share sheet's POST, and how the stored copy is found, taken and swept. Driven here with real
 * `FormData` / `File` / `Response` and an in-memory Cache Storage; the browser's own run (the POST
 * through the real worker) is tests/e2e/share-target.spec.ts.
 */

const ORIGIN = 'https://app.test';

/** Cache Storage in memory: caches by name, entries by absolute URL (like the browser's). */
function memoryCaches(options: { failPut?: Error } = {}) {
  const stores = new Map<string, Map<string, Response>>();
  const created: string[] = [];
  const abs = (request: { url: string } | string) => new URL(typeof request === 'string' ? request : request.url, ORIGIN).href;
  const api: ShareCaches = {
    has: async (name) => stores.has(name),
    open: async (name) => {
      let entries = stores.get(name);
      if (!entries) {
        entries = new Map();
        stores.set(name, entries);
        created.push(name);
      }
      const map = entries;
      return {
        keys: async () => [...map.keys()].map((url) => ({ url })),
        match: async (request) => map.get(abs(request))?.clone(),
        put: async (request, response) => {
          if (options.failPut) {
            // Like the browser: the write fails part-way; nothing usable is left under the key.
            throw options.failPut;
          }
          // Read the body now, as the browser writes it to disk now.
          const body = await response.arrayBuffer();
          map.set(abs(request), new Response(body, { headers: response.headers }));
        },
        delete: async (request) => map.delete(abs(request)),
      };
    },
    delete: async (name) => stores.delete(name),
  };
  return { api, stores, created, entries: (name = SHARE_CACHE) => [...(stores.get(name)?.keys() ?? [])] };
}

function form(...files: Array<File | string>): { formData: () => Promise<FormData> } {
  const data = new FormData();
  for (const file of files) data.append('video', file);
  return { formData: async () => data };
}

const video = (name: string, bytes = 'video bytes', type = 'video/mp4') => new File([bytes], name, { type, lastModified: 1_700_000_000_000 });

describe('which shared file is the video (ADR-047)', () => {
  it('a video by its type; by its name only when the type says nothing', () => {
    expect(isVideoFile({ name: 'a.mp4', type: 'video/mp4' })).toBe(true);
    expect(isVideoFile({ name: 'IMG_1234', type: 'video/quicktime' })).toBe(true);
    expect(isVideoFile({ name: 'clip.MOV', type: '' })).toBe(true);
    expect(isVideoFile({ name: 'clip.webm', type: 'application/octet-stream' })).toBe(true);
    expect(isVideoFile({ name: 'photo.jpg', type: 'image/jpeg' })).toBe(false);
    expect(isVideoFile({ name: 'anim.gif', type: 'image/gif' })).toBe(false);
    // A wrong name does not make a picture a video.
    expect(isVideoFile({ name: 'photo.mp4', type: 'image/png' })).toBe(false);
    expect(isVideoFile({ name: 'notes.txt', type: '' })).toBe(false);
  });

  it('the first video of the share, and how many files came; text fields are not files', async () => {
    const data = await form(new File(['p'], 'photo.jpg', { type: 'image/jpeg' }), video('one.mp4'), video('two.mp4'), 'a caption').formData();
    data.append('other-field', video('three.mov', 'x', 'video/quicktime'));
    const chosen = chooseSharedVideo(data);
    expect(chosen.video?.name).toBe('one.mp4');
    expect(chosen.count).toBe(4);
    expect(chooseSharedVideo(await form('just text').formData())).toEqual({ video: null, count: 0 });
  });
});

describe('the address a share ends on', () => {
  it('the opening screen with the id, or with the reason; only well-formed markers are read back', () => {
    expect(shareRedirect('/capcut', { id: 'lq2x-abc123' })).toBe('/capcut/?paylasim=lq2x-abc123');
    expect(shareRedirect('', { error: 'video-degil' })).toBe('/?paylasim-hata=video-degil');
    expect(readShareMarker('?paylasim=lq2x-abc123')).toEqual({ id: 'lq2x-abc123' });
    expect(readShareMarker('?paylasim-hata=yer')).toEqual({ error: 'yer' });
    expect(readShareMarker('?paylasim-hata=bilinmeyen')).toBeNull();
    expect(readShareMarker('?paylasim=%3Cscript%3E')).toBeNull();
    expect(readShareMarker('')).toBeNull();
    expect(newShareId(1_700_000_000_000, 0.5)).toMatch(/^[a-z0-9]+-[a-z0-9]{6}$/);
    expect(newShareId(1_700_000_000_000, 0.5)).not.toBe(newShareId(1_700_000_000_000, 0.25));
  });

  it('a card carries the video in hand; a wizard address without one is unchanged', () => {
    expect(withHeldVideo('/yap/gif', { id: 'lq2x-abc123' })).toBe('/yap/gif?paylasim=lq2x-abc123');
    expect(withHeldVideo('/yap/kes', null)).toBe('/yap/kes');
  });
});

describe('the worker keeps the shared video (receiveShare)', () => {
  const now = 1_760_000_000_000;

  it('stores the first video with its facts, in its own cache, and redirects to the opening screen', async () => {
    const store = memoryCaches();
    const location = await receiveShare({
      request: form(new File(['p'], 'photo.jpg', { type: 'image/jpeg' }), video('tatil videosu.mp4', 'abcdef'), video('second.mp4')),
      cachesApi: store.api,
      base: '/capcut',
      now,
      random: 0.5,
    });
    const id = readShareMarker(new URL(location, ORIGIN).search);
    expect(id && 'id' in id).toBe(true);
    if (!id || !('id' in id)) return;
    expect(location).toBe(`/capcut/?paylasim=${id.id}`);
    expect([...store.stores.keys()]).toEqual([SHARE_CACHE]);
    expect(store.entries()).toEqual([`${ORIGIN}${shareEntryPath('/capcut', id.id)}`]);
    const cache = await store.api.open(SHARE_CACHE);
    const response = await cache.match(shareEntryPath('/capcut', id.id));
    expect(response && readShareEntry(response)).toEqual({
      name: 'tatil videosu.mp4',
      type: 'video/mp4',
      lastModified: 1_700_000_000_000,
      sharedAt: now,
      count: 3,
    });
    expect(await response?.text()).toBe('abcdef');
  });

  it('a new share replaces the old one: one shared video at a time', async () => {
    const store = memoryCaches();
    await receiveShare({ request: form(video('old.mp4')), cachesApi: store.api, base: '', now, random: 0.1 });
    const second = await receiveShare({ request: form(video('new.mp4')), cachesApi: store.api, base: '', now: now + 1, random: 0.2 });
    const marker = readShareMarker(new URL(second, ORIGIN).search);
    expect(store.entries()).toEqual([`${ORIGIN}/paylas/dosya/${marker && 'id' in marker ? marker.id : ''}`]);
  });

  it('no video, nothing at all, an unreadable form, a full disk: the reason, and nothing kept', async () => {
    const store = memoryCaches();
    const photo = new File(['p'], 'photo.jpg', { type: 'image/jpeg' });
    expect(await receiveShare({ request: form(photo), cachesApi: store.api, base: '/capcut', now, random: 0 })).toBe(
      '/capcut/?paylasim-hata=video-degil',
    );
    expect(await receiveShare({ request: form(), cachesApi: store.api, base: '/capcut', now, random: 0 })).toBe('/capcut/?paylasim-hata=bos');
    const broken = { formData: () => Promise.reject(new TypeError('Failed to parse')) };
    expect(await receiveShare({ request: broken, cachesApi: store.api, base: '/capcut', now, random: 0 })).toBe(
      '/capcut/?paylasim-hata=okunamadi',
    );
    // Looking created nothing: a share without a video leaves no cache behind.
    expect(store.created).toEqual([]);

    const full = memoryCaches({ failPut: new DOMException('Quota exceeded', 'QuotaExceededError') });
    expect(await receiveShare({ request: form(video('big.mp4')), cachesApi: full.api, base: '/capcut', now, random: 0 })).toBe(
      '/capcut/?paylasim-hata=yer',
    );
    expect(full.entries()).toEqual([]);
    const other = memoryCaches({ failPut: new TypeError('network error') });
    expect(await receiveShare({ request: form(video('big.mp4')), cachesApi: other.api, base: '', now, random: 0 })).toBe('/?paylasim-hata=okunamadi');
  });
});

describe('the stored copy does not pile up (sweepShares, forgetShare)', () => {
  const now = 1_760_000_000_000;

  async function shared(store: ReturnType<typeof memoryCaches>, at: number, random: number): Promise<string> {
    const location = await receiveShare({ request: form(video(`v${random}.mp4`)), cachesApi: store.api, base: '/capcut', now: at, random });
    const marker = readShareMarker(new URL(location, ORIGIN).search);
    return marker && 'id' in marker ? marker.id : '';
  }

  it('a page start keeps only the share its address is about, and only while it is fresh', async () => {
    const store = memoryCaches();
    const id = await shared(store, now, 0.3);
    // The page the redirect opened: kept.
    expect(await sweepShares({ cachesApi: store.api, now: now + 1000, keep: id })).toBe(0);
    expect(store.entries()).toHaveLength(1);
    // The same address, after the 15 minutes: gone, and the cache with it.
    expect(await sweepShares({ cachesApi: store.api, now: now + SHARE_TTL_MS, keep: id })).toBe(1);
    expect([...store.stores.keys()]).toEqual([]);

    // Any other start (no share in its address): gone at once.
    await shared(store, now, 0.4);
    expect(await sweepShares({ cachesApi: store.api, now: now + 1000, keep: '' })).toBe(1);
    expect([...store.stores.keys()]).toEqual([]);
  });

  it("the worker's activation deletes only what waited too long", async () => {
    const store = memoryCaches();
    await shared(store, now, 0.5);
    expect(await sweepShares({ cachesApi: store.api, now: now + SHARE_TTL_MS - 1 })).toBe(0);
    expect(await sweepShares({ cachesApi: store.api, now: now + SHARE_TTL_MS })).toBe(1);
  });

  it('a task took it: its copy goes; sweeping a browser never shared to creates nothing', async () => {
    const store = memoryCaches();
    const id = await shared(store, now, 0.6);
    expect(await forgetShare({ cachesApi: store.api, base: '/capcut', id })).toBe(true);
    expect([...store.stores.keys()]).toEqual([]);
    expect(await forgetShare({ cachesApi: store.api, base: '/capcut', id })).toBe(false);

    const empty = memoryCaches();
    expect(await sweepShares({ cachesApi: empty.api, now, keep: '' })).toBe(0);
    expect(empty.created).toEqual([]);
  });

  it('expiry: 15 minutes from the share; a time in the future is not trusted', () => {
    expect(shareExpired(now, now + SHARE_TTL_MS - 1)).toBe(false);
    expect(shareExpired(now, now + SHARE_TTL_MS)).toBe(true);
    expect(shareExpired(now + 10 * 60_000, now)).toBe(true);
    expect(shareExpired(Number.NaN, now)).toBe(true);
    // The opening screen's timer: what is left of the 15 minutes.
    expect(shareTimeLeft(now, now)).toBe(SHARE_TTL_MS);
    expect(shareTimeLeft(now, now + 60_000)).toBe(SHARE_TTL_MS - 60_000);
    expect(shareTimeLeft(now, now + SHARE_TTL_MS + 5)).toBe(0);
  });

  it('an entry that is not ours is swept', async () => {
    const store = memoryCaches();
    const cache = await store.api.open(SHARE_CACHE);
    await cache.put('/capcut/paylas/dosya/x', new Response('?'));
    expect(await sweepShares({ cachesApi: store.api, now, keep: 'x' })).toBe(1);
  });
});

describe('written into the worker as it is', () => {
  it('the module becomes plain code; a module with an import is refused', () => {
    const source = readFileSync(join(process.cwd(), 'scripts', 'lib', 'share-target.mjs'), 'utf8');
    const code = inlineModule(source);
    expect(code).not.toMatch(/^\s*(export|import)\b/m);
    expect(code).toContain('async function receiveShare(');
    // It parses as a classic script.
    expect(() => new Function(code)).not.toThrow();
    expect(() => inlineModule("import x from 'y';\nexport const a = 1;")).toThrow(/import or export/);
  });
});
