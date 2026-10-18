'use client';

import { useEffect, useState, type ComponentType, type ReactNode } from 'react';

import { Icon } from '@/components/Icon';
import { useT } from '@/i18n/locale';
import type { MessageKey } from '@/i18n/messages';
import { CHUNK_ERROR_ATTRIBUTE } from '@/pageWatchdog';

type Words = (key: MessageKey) => string;

/** The part's own words when it is given some (`t`), the page's language otherwise (ADR-048). */
function wordsOf(props: object, page: Words): Words {
  const given = (props as { t?: unknown }).t;
  return typeof given === 'function' ? (given as Words) : page;
}

/**
 * "This part did not open" + "Tekrar dene", where the part would have been.
 * `data-clip-chunk-error` tells the page's watchdog that the user has been told.
 */
export function PartFailed({
  t,
  variant,
  onRetry,
  onClose,
}: {
  t: Words;
  variant: 'notice' | 'inline';
  onRetry: () => void;
  onClose?: () => void;
}) {
  const marker = { [CHUNK_ERROR_ATTRIBUTE]: '' };
  const buttons = (
    <>
      {onClose ? (
        <button type="button" className="update-notice-button" onClick={onClose} data-testid="part-close">
          {t('part.close')}
        </button>
      ) : null}
      <button type="button" className="update-notice-button update-notice-primary" onClick={onRetry} data-testid="part-retry">
        {t('part.retry')}
      </button>
    </>
  );
  if (variant === 'inline') {
    return (
      <div className="part-failed" role="alert" data-testid="part-failed" {...marker}>
        <p className="inline-error part-failed-text">
          <Icon name="alert" />
          <span>{t('part.failed')}</span>
        </p>
        <div className="update-notice-actions">{buttons}</div>
      </div>
    );
  }
  return (
    <div className="update-notice part-failed-notice" role="alert" data-testid="part-failed" {...marker}>
      <p className="update-notice-text">
        <b>{t('part.failed')}</b>
      </p>
      <div className="update-notice-actions">{buttons}</div>
    </div>
  );
}

/**
 * How long a part may take to arrive before the screen says it did not. Its code is at most a few
 * hundred kilobytes and usually comes from the stored copy; the page itself is given 45 s without
 * `load` (src/pageWatchdog.ts).
 */
export const PART_STUCK_MS = 30_000;

export interface LazyPartOptions<P> {
  /** Shown while the part's code arrives. */
  loading?: () => ReactNode;
  /** 'notice': a bar at the top of the screen (a dialog that could not open). 'inline': in the part's own place. */
  variant?: 'notice' | 'inline';
  /** The part's own way of being closed, when it has one ("Kapat" next to "Tekrar dene"). */
  close?: (props: P) => (() => void) | undefined;
  /** Draws the failure itself instead of the two variants above. */
  failed?: (retry: () => void, props: P) => ReactNode;
}

/**
 * A part of the app whose code is fetched when it is first shown (a dialog,
 * the editor opened from a wizard) — as `next/dynamic` with `ssr: false`
 * does, but a part that does not arrive SAYS so and can be asked for again
 * (ADR-044). With `next/dynamic` a failed fetch threw inside rendering: the
 * whole page was replaced by the framework's error screen, the open video
 * with it, and the failure was remembered for good.
 *
 * "Tekrar dene" really asks again: the bundler forgets a file that failed
 * (after its own single retry), so the next `import()` goes to the network.
 * A request that neither arrives nor fails is treated as failed after
 * `PART_STUCK_MS`; asking again then waits for that same request.
 */
export function lazyPart<P extends object>(load: () => Promise<ComponentType<P>>, options: LazyPartOptions<P> = {}): ComponentType<P> {
  let ready: ComponentType<P> | null = null;

  function LazyPart(props: P) {
    const pageWords = useT();
    const [Part, setPart] = useState<ComponentType<P> | null>(() => ready);
    const [failedAttempt, setFailedAttempt] = useState(-1);
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
      if (ready) return undefined;
      let current = true;
      // A request that stands still never fails: after a while the screen says so anyway. If the code
      // arrives after all, the part is shown.
      const stuck = window.setTimeout(() => {
        if (current) setFailedAttempt(attempt);
      }, PART_STUCK_MS);
      load().then(
        (part) => {
          ready = part;
          window.clearTimeout(stuck);
          if (current) setPart(() => part);
        },
        () => {
          window.clearTimeout(stuck);
          if (current) setFailedAttempt(attempt);
        },
      );
      return () => {
        current = false;
        window.clearTimeout(stuck);
      };
    }, [attempt]);

    if (Part) return <Part {...props} />;
    if (failedAttempt === attempt) {
      const retry = () => setAttempt((value) => value + 1);
      if (options.failed) return <>{options.failed(retry, props)}</>;
      return <PartFailed t={wordsOf(props, pageWords)} variant={options.variant ?? 'notice'} onRetry={retry} onClose={options.close?.(props)} />;
    }
    return <>{options.loading?.() ?? null}</>;
  }
  return LazyPart;
}
