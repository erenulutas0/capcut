import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

/**
 * False in the prerendered HTML and during hydration, true once React owns
 * the page. The editor is served as static HTML, so its controls are visible
 * before their handlers exist; anything that must not accept input early
 * (a file picked before hydration is silently lost) renders behind this.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
