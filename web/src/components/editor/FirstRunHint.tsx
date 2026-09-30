'use client';

import { useSyncExternalStore } from 'react';

import { Icon } from '@/components/Icon';
import type { MessageKey } from '@/i18n/messages';

type T = (key: MessageKey) => string;

/**
 * Remembered in this browser only (never sent anywhere). A browser that
 * refuses storage (private mode, blocked site data) throws on access: the
 * hint then simply shows, and "Anladım" hides it for this page's life.
 */
const STORAGE_KEY = 'clip.firstRunHint.dismissed';

const listeners = new Set<() => void>();
let dismissedInMemory = false;

function readDismissed(): boolean {
  if (dismissedInMemory) return true;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function dismiss(): void {
  dismissedInMemory = true;
  try {
    window.localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    // Storage refused: the hint stays hidden until the page reloads.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether the first-run hint was dismissed. The prerendered page shows it. */
export function useFirstRunHintDismissed(): boolean {
  return useSyncExternalStore(subscribe, readDismissed, () => false);
}

/**
 * The first-run hint (UX audit 2026-09-30): the three steps of the kesit flow
 * in the words the buttons use, where the kesit will appear. It stands in for
 * the empty list until the user says "Anladım".
 */
export function FirstRunHint({ t, hasVideo, onDismissed }: { t: T; hasVideo: boolean; onDismissed: () => void }) {
  return (
    <div className="first-run" data-testid="first-run-hint">
      <h3 className="first-run-title">
        <Icon name="info" size={16} />
        {t('hint.title')}
      </h3>
      <ol className="first-run-steps">
        <li>{t(hasVideo ? 'hint.step1' : 'hint.step1NoVideo')}</li>
        <li>{t('hint.step2')}</li>
        <li>{t('hint.step3')}</li>
      </ol>
      <p className="first-run-more">{t('hint.more')}</p>
      <button
        type="button"
        className="btn first-run-dismiss"
        onClick={() => {
          dismiss();
          onDismissed();
        }}
        data-testid="first-run-dismiss"
      >
        {t('hint.dismiss')}
      </button>
    </div>
  );
}
