'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { safeFileName } from '@/adapters/browserMedia';
import {
  SHARE_PICKED_ID,
  forgetSharedVideo,
  heldVideo,
  holdVideo,
  loadSharedVideo,
  readShareMarker,
  shareTimeLeft,
  subscribeHeldVideo,
  type HeldVideo,
  type ShareError,
} from '@/adapters/pwa/sharedVideo';
import { BASE_PATH } from '@/basePath';
import { useBrowserValue } from '@/components/useBrowserValue';
import { formatLengthShort } from '@/domain/time';
import { translator, type MessageKey } from '@/i18n/messages';

const t = translator('tr');

/** What a share that brought no video says (ADR-047). */
const SHARE_ERROR_TEXT: Record<ShareError, MessageKey> = {
  'video-degil': 'home.share.notVideo',
  bos: 'home.share.empty',
  yer: 'home.share.noSpace',
  okunamadi: 'home.share.unreadable',
};

type Notice = ShareError | 'gone' | null;

/** The video in hand, as the opening screen and its cards see it. */
export function useHeldVideo(): HeldVideo | null {
  return useSyncExternalStore(subscribeHeldVideo, heldVideo, () => null);
}

/** Module-level (useBrowserValue wants a stable reader): the page address's share marker. */
const readMarker = () => readShareMarker(window.location.search);

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}

/** The opening screen's address without the share's query: what a reload should show from now on. */
function clearShareAddress(): void {
  try {
    if (window.location.search !== '') window.history.replaceState(null, '', `${BASE_PATH}/`);
  } catch {
    // The address could not change: the stored copy is gone, so a reload says "artık burada değil".
  }
}

/**
 * The top of the opening screen: "Ne yapmak istiyorsun?" — or, with a video in hand ("LiloCut'a
 * paylaş", ADR-047), "Bu videoyla ne yapmak istiyorsun?" and under it that video: a small picture,
 * its name and length, and "Başka bir video seç". The cards under it open their task with this
 * video already picked (TaskFinder adds `?paylasim=<id>`).
 *
 * The page is static HTML first and knows nothing of a share: it says what it always said, and the
 * video appears once the stored copy has been read (a few milliseconds after the page came alive).
 * A share that brought no video says why, in the same place; the cards stay as they are.
 */
export function HomeIntro() {
  const video = useHeldVideo();
  // The address says which share this is (the service worker's redirect), or why there is none.
  const marker = useBrowserValue(readMarker, null);
  const markerId = marker && 'id' in marker ? marker.id : null;
  /** The address names a shared video that is no longer stored (taken, swept, expired). */
  const [goneId, setGoneId] = useState<string | null>(null);
  const objectUrl = video?.url ?? null;
  /** The length the picture's metadata gave, for the picture it came from. */
  const [length, setLength] = useState<{ url: string; us: number } | null>(null);
  const lengthUs = length && length.url === objectUrl ? length.us : null;
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!markerId) return undefined;
    const current = heldVideo();
    if (current && current.id === markerId) return undefined;
    let live = true;
    void loadSharedVideo(markerId).then((found) => {
      if (!live) return;
      if (found) holdVideo(found);
      else setGoneId(markerId);
    });
    return () => {
      live = false;
    };
  }, [markerId]);

  // Nobody took it: the stored copy goes 15 minutes after it came (the video in memory stays usable).
  useEffect(() => {
    if (!video || video.sharedAt === null) return undefined;
    const timer = window.setTimeout(() => void forgetSharedVideo(video.id), shareTimeLeft(video.sharedAt, Date.now()));
    return () => window.clearTimeout(timer);
  }, [video]);

  const pickAnother = (file: File) => {
    const previous = heldVideo();
    if (previous && previous.id !== SHARE_PICKED_ID) void forgetSharedVideo(previous.id);
    clearShareAddress();
    holdVideo({ id: SHARE_PICKED_ID, file, count: 1, sharedAt: null });
  };

  const notice: Notice = marker && 'error' in marker ? marker.error : goneId !== null && goneId === markerId ? 'gone' : null;
  const noticeText = notice === 'gone' ? t('home.share.gone') : notice ? t(SHARE_ERROR_TEXT[notice]) : null;
  const many = video && video.count > 1 ? fill(t('home.share.many'), { n: String(video.count) }) : null;

  return (
    <>
      <h1 className="home-title" data-testid="home-title">
        {video ? t('home.title.video') : t('home.title')}
      </h1>
      {video ? (
        <section
          className="home-video"
          aria-label={video.id === SHARE_PICKED_ID ? t('home.video.picked') : t('home.video.shared')}
          data-testid="home-video"
          data-source={video.id === SHARE_PICKED_ID ? 'picked' : 'shared'}
        >
          <div className="home-video-row">
            <span className="home-video-thumb" aria-hidden="true">
              {objectUrl ? (
                <video
                  // "#t=0.1": a picture, not an empty box.
                  src={`${objectUrl}#t=0.1`}
                  muted
                  playsInline
                  preload="metadata"
                  tabIndex={-1}
                  onLoadedMetadata={(event) => {
                    const seconds = event.currentTarget.duration;
                    if (Number.isFinite(seconds) && seconds > 0) setLength({ url: objectUrl, us: Math.round(seconds * 1_000_000) });
                  }}
                  data-testid="home-video-thumb"
                />
              ) : null}
            </span>
            <span className="home-video-text">
              <span className="home-video-name" data-testid="home-video-name">
                {safeFileName(video.file.name, 48)}
              </span>
              {lengthUs !== null ? (
                <span className="home-video-length" data-testid="home-video-length">
                  {formatLengthShort(lengthUs, { second: t('time.secondShort'), decimalMark: t('time.decimalMark') })}
                </span>
              ) : null}
            </span>
          </div>
          <p className="home-video-hint">{t('home.video.hint')}</p>
          {many ? (
            <p className="home-video-note" data-testid="home-share-many">
              {many}
            </p>
          ) : null}
          <button
            type="button"
            className="home-video-change"
            onClick={() => inputRef.current?.click()}
            data-testid="home-video-change"
          >
            {t('home.video.change')}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="video/*"
            className="visually-hidden"
            tabIndex={-1}
            aria-hidden="true"
            data-testid="home-video-input"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) pickAnother(file);
            }}
          />
        </section>
      ) : (
        <p className="home-lede">{t('home.lede')}</p>
      )}
      {noticeText && !video ? (
        <p className="home-share-notice" data-testid="home-share-notice" data-reason={notice ?? undefined}>
          {noticeText}
        </p>
      ) : null}
    </>
  );
}
