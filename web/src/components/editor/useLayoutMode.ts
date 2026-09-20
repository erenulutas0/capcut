'use client';

import { useSyncExternalStore } from 'react';

/**
 * Which shell the editor renders.
 *
 * Panels are rendered per mode rather than hidden with CSS: a hidden copy of
 * the inspector would duplicate every input id and label, which breaks
 * label/for associations and assistive tech.
 *
 * wide   ≥1181  source panel + inspector inline
 * narrow  901…1180  source panel inline, inspector in a drawer
 * tablet  761…900   both in drawers, reached from the top bar
 * phone   ≤760      vertical layout with a bottom tool sheet
 */
export type LayoutMode = 'wide' | 'narrow' | 'tablet' | 'phone';

function read(): LayoutMode {
  const width = window.innerWidth;
  if (width <= 760) return 'phone';
  if (width <= 900) return 'tablet';
  if (width <= 1180) return 'narrow';
  return 'wide';
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
  return useSyncExternalStore(subscribe, read, () => 'wide');
}
