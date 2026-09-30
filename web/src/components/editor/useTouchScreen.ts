'use client';

import { useSyncExternalStore } from 'react';

/**
 * A phone or tablet: the main pointer is a finger and nothing hovers.
 * Decides wording such as "Kaydet" instead of "Bilgisayara kaydet"
 * (ADR-031); the layout itself still follows the window width
 * (useLayoutMode). False in the prerendered HTML.
 */
const QUERY = '(hover: none) and (pointer: coarse)';

function subscribe(onChange: () => void): () => void {
  const list = window.matchMedia(QUERY);
  list.addEventListener('change', onChange);
  return () => list.removeEventListener('change', onChange);
}

export function useTouchScreen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
