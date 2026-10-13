'use client';

import { isChromiumBrowser, isIosDevice } from '@/adapters/browserKind';
import { checkEnvironment, environmentPasses, type CapabilityReportV1 } from '@/adapters/exportCapability';
import { Icon } from '@/components/Icon';
import { useHydrated } from '@/components/useHydrated';
import { browserAdvice, isBrowserSideRefusal, type BrowserAdvice } from '@/domain/browserAdvice';
import type { ExportFailureCode } from '@/domain/exportEvents';
import type { MessageKey } from '@/i18n/messages';

/** The way forward for a refusal that is the browser's; 'none' inside Chrome / Edge or for any other refusal. */
export function adviceFor(environmentFailed: boolean, blockers: readonly ExportFailureCode[]): BrowserAdvice {
  return browserAdvice({ chromium: isChromiumBrowser(), ios: isIosDevice(), environmentFailed, blockers });
}

/**
 * Said BEFORE the user spends time on a task this browser cannot finish
 * (13 Oct 2026: in Firefox and WebKit every wizard let the user pick a video
 * and make the choice, and only "İndir" said the file cannot be made).
 *
 * Shown when the browser lacks what every export needs (known at once), or
 * when the background check of the open video came back with a refusal that
 * is the browser's (an encoder it does not have). Nothing is shown for a
 * refusal that is the video's, and nothing during prerendering.
 */
export function BrowserNotice({ t, capability }: { t: (key: MessageKey) => string; capability: CapabilityReportV1 | null }) {
  const hydrated = useHydrated();
  if (!hydrated) return null;
  const environmentFailed = !environmentPasses(capability?.environment ?? checkEnvironment());
  const blockers = capability?.blockers ?? [];
  if (!isBrowserSideRefusal({ environmentFailed, blockers })) return null;
  const advice = adviceFor(environmentFailed, blockers);
  return (
    <div className="inline-error browser-notice" role="alert" data-testid="browser-unsupported" data-advice={advice}>
      <Icon name="alert" />
      <span>
        <b>{t('browser.cannotExport')}</b> {t('browser.cannotExportNote')}
        {advice === 'none' ? null : <> {t(`browser.advice.${advice}` as MessageKey)}</>}
      </span>
    </div>
  );
}
