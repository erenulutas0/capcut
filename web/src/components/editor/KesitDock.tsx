'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { Icon } from '@/components/Icon';
import type { MessageKey } from '@/i18n/messages';

type T = (key: MessageKey) => string;

/**
 * How much of the kesit list must be on screen before the bar steps aside:
 * about its heading ("Kesitler (3)"), so the bar never hides a list the user
 * cannot see yet.
 */
const LIST_VISIBLE_PX = 56;

interface Props {
  t: T;
  count: number;
  /** What the download half says: "Kesiti indir" (1) or "Hepsini birleştirip indir" (≥ 2). */
  downloadLabel: string;
  downloadDisabled: boolean;
  /** The same as the top download button. Must open the save dialog synchronously. */
  onDownload: () => void;
}

function prefersLessMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function kesitList(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="kesit-panel"]');
}

/**
 * Phone only (ADR-030, UX audit Ö3): on a phone the kesit list is below the
 * preview, the strip and the marks, so a kesit that was just added lands out
 * of sight and the download button at the top has scrolled away. While the
 * list is below the fold this bar sticks to the bottom: "Kesitler (3)" takes
 * the user to the list, the other half downloads exactly like the top button.
 * It steps aside as soon as the list is on screen.
 *
 * WCAG 2.4.11 (focus not obscured): while it is shown the page keeps its
 * height free at the bottom (`scroll-padding-bottom`), so the browser scrolls
 * a focused control above it, and a control that is focused under it anyway
 * (the bar appearing after "Bitişi işaretle") is scrolled into view.
 */
export function KesitDock({ t, count, downloadLabel, downloadDisabled, onDownload }: Props) {
  const barRef = useRef<HTMLElement | null>(null);
  // Hidden until the observer has looked: no flash over a list already in view.
  const [listInView, setListInView] = useState(true);

  useEffect(() => {
    const list = kesitList();
    if (!list || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (!entry) return;
        // The list is the last part of the page: either some of it shows,
        // or it is still below.
        setListInView(entry.isIntersecting || entry.boundingClientRect.top < 0);
      },
      { rootMargin: `0px 0px -${LIST_VISIBLE_PX}px 0px` },
    );
    observer.observe(list);
    return () => observer.disconnect();
  }, []);

  const shown = !listInView;

  useEffect(() => {
    const bar = barRef.current;
    if (!shown || !bar) return;
    const root = document.documentElement;
    const uncover = (target: Element | null) => {
      if (!(target instanceof HTMLElement) || bar.contains(target) || target === document.body) return;
      const barTop = bar.getBoundingClientRect().top;
      if (target.getBoundingClientRect().bottom > barTop) {
        target.scrollIntoView({ block: 'nearest', behavior: prefersLessMotion() ? 'auto' : 'smooth' });
      }
    };
    const reserve = () => {
      root.style.scrollPaddingBottom = `${Math.ceil(bar.getBoundingClientRect().height) + 8}px`;
      uncover(document.activeElement);
    };
    reserve();
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(reserve);
    resize?.observe(bar);
    const onFocusIn = (event: FocusEvent) => uncover(event.target as Element | null);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      resize?.disconnect();
      document.removeEventListener('focusin', onFocusIn);
      root.style.scrollPaddingBottom = '';
    };
  }, [shown]);

  /** Scrolls the list into view and puts the keyboard on its heading. */
  const goToList = useCallback(() => {
    const list = kesitList();
    if (!list) return;
    list.scrollIntoView({ block: 'start', behavior: prefersLessMotion() ? 'auto' : 'smooth' });
    document.getElementById('kesits-title')?.focus({ preventScroll: true });
  }, []);

  return (
    <aside
      ref={barRef}
      className="kesit-dock"
      aria-label={t('dock.label')}
      hidden={!shown}
      data-testid="kesit-dock"
    >
      <button type="button" className="btn kesit-dock-count" onClick={goToList} data-testid="kesit-dock-count">
        <Icon name="down" size={18} />
        {t('dock.count').replace('{n}', String(count))}
      </button>
      <button
        type="button"
        className="btn btn-accent kesit-dock-download"
        onClick={() => {
          // The save dialog opens inside this click (useDownloads); then the
          // list, where the progress and the result appear, comes into view.
          onDownload();
          goToList();
        }}
        disabled={downloadDisabled}
        data-testid="kesit-dock-download"
      >
        <Icon name="download" size={18} />
        {downloadLabel}
      </button>
    </aside>
  );
}
