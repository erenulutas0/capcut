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
 */
export function useCaptionFont(): CaptionFontStatus {
  const [status, setStatus] = useState<CaptionFontStatus>('loading');

  useEffect(() => {
    let cancelled = false;
    void loadCaptionFont(document.fonts, window.location.origin).then((ok) => {
      if (!cancelled) setStatus(ok ? 'ready' : 'failed');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return status;
}
