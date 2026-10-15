'use client';

import { useBrowserValue } from '@/components/useBrowserValue';

/**
 * A phone or tablet: the main pointer is a finger and nothing hovers.
 * Decides wording such as "Kaydet" instead of "Bilgisayara kaydet"
 * (ADR-031); the layout itself still follows the window width
 * (useLayoutMode). False in the prerendered HTML.
 */
const QUERY = '(hover: none) and (pointer: coarse)';

function read(): boolean {
  return window.matchMedia(QUERY).matches;
}

function subscribe(onChange: () => void): () => void {
  const list = window.matchMedia(QUERY);
  list.addEventListener('change', onChange);
  return () => list.removeEventListener('change', onChange);
}

export function useTouchScreen(): boolean {
  return useBrowserValue(read, false, subscribe);
}
