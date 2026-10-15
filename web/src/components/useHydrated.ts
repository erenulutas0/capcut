import { useBrowserValue } from '@/components/useBrowserValue';

const live = () => true;

/**
 * False in the prerendered HTML and during hydration, true once React owns
 * the page. The editor is served as static HTML, so its controls are visible
 * before their handlers exist; anything that must not accept input early
 * (a file picked before hydration is silently lost) renders behind this.
 * The switch to true is a transition (components/useBrowserValue.ts).
 */
export function useHydrated(): boolean {
  return useBrowserValue(live, false);
}
