'use client';

import { useBrowserValue } from '@/components/useBrowserValue';

import { layoutModeFor, type LayoutMode } from './layoutMode';

export type { LayoutMode } from './layoutMode';

/**
 * Which shell the editor renders (the widths: `layoutModeFor`).
 *
 * Panels are rendered per mode rather than hidden with CSS: a hidden copy of
 * the inspector would duplicate every input id and label, which breaks
 * label/for associations and assistive tech.
 */
function read(): LayoutMode {
  return layoutModeFor(window.innerWidth);
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('resize', onChange);
  window.addEventListener('orientationchange', onChange);
  return () => {
    window.removeEventListener('resize', onChange);
    window.removeEventListener('orientationchange', onChange);
  };
}

export function useLayoutMode(): LayoutMode {
  // 'wide' in the prerendered HTML; the window's own mode once the page is live (a transition).
  return useBrowserValue<LayoutMode>(read, 'wide', subscribe);
}
