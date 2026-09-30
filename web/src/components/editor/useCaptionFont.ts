'use client';

import { useEffect, useState } from 'react';

import { loadCaptionFont } from '@/adapters/captionRender';

export type CaptionFontStatus = 'loading' | 'ready' | 'failed';

/**
 * Loads the bundled caption font once for the page.
 *
 * Nothing is drawn or measured until it is 'ready': a fallback font would wrap
 * differently from the export and make the preview promise a layout the file
 * does not have (ADR-015). 'failed' is shown to the user, never hidden.
 *
 * The two font files (60 KB) are fetched once the page has loaded and the
 * main thread is idle (at most 2 s later), not while the editor itself is
 * still loading: nothing needs them before a caption is typed
 * (docs/perf/2026-09-30-load.md). Until then the status is 'loading', as it
 * was while the files downloaded.
 */
export function useCaptionFont(): CaptionFontStatus {
  const [status, setStatus] = useState<CaptionFontStatus>('loading');

  useEffect(() => {
    let cancelled = false;
    let idle: number | undefined;
    let timer: number | undefined;
    const start = () => {
      if (cancelled) return;
      void loadCaptionFont(document.fonts, window.location.origin).then((ok) => {
        if (!cancelled) setStatus(ok ? 'ready' : 'failed');
      });
    };
    const whenIdle = () => {
      if (typeof window.requestIdleCallback === 'function') idle = window.requestIdleCallback(start, { timeout: 2000 });
      else timer = window.setTimeout(start, 0);
    };
    if (document.readyState === 'complete') whenIdle();
    else window.addEventListener('load', whenIdle, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener('load', whenIdle);
      if (idle !== undefined) window.cancelIdleCallback(idle);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  return status;
}
