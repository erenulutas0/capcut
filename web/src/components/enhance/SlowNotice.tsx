'use client';

import { slowEnhanceNotice, slowEnhanceSeconds } from '@/domain/enhance';
import type { MessageKey } from '@/i18n/messages';
import type { EnhancePreviewPicture } from './useEnhancePreview';

interface Props {
  t: (key: MessageKey) => string;
  picture: EnhancePreviewPicture | null;
  className: string;
  testId: string;
}

/**
 * Said BEFORE the download where no graphics card does the work (the
 * reference renderer, or WebGL on a software rasteriser): enhancing is
 * correct there but slow — measured 36 minutes for a 5-minute 1080p video
 * (ADR-037). With about how long THIS video takes once that is two minutes
 * or more; an estimate from one computer's measurement, worded as one.
 */
export function EnhanceSlowNotice({ t, picture, className, testId }: Props) {
  if (!picture || picture.accelerated || picture.summary.nothing) return null;
  const notice = slowEnhanceNotice(slowEnhanceSeconds(picture.totalFrames, picture.width, picture.height));
  const text =
    notice.kind === 'general'
      ? t('enhance.slow')
      : t(notice.kind === 'hours' ? 'enhance.slow.hours' : 'enhance.slow.minutes').replace('{n}', String(notice.n));
  return (
    <p className={className} role="status" data-testid={testId} data-kind={notice.kind}>
      {text}
    </p>
  );
}
