/**
 * Which shell the editor renders, by the window's width. Pure: `useLayoutMode`
 * reads it in the page, and the quality layer (tests/quality/lib/states.ts)
 * uses it to wait until the editor is laid out for its window.
 *
 * wide   ≥1181  source panel + inspector inline
 * narrow  901…1180  source panel inline, inspector in a drawer
 * tablet  761…900   both in drawers, reached from the top bar
 * phone   ≤760      vertical layout with a bottom tool sheet
 */
export type LayoutMode = 'wide' | 'narrow' | 'tablet' | 'phone';

export function layoutModeFor(width: number): LayoutMode {
  if (width <= 760) return 'phone';
  if (width <= 900) return 'tablet';
  if (width <= 1180) return 'narrow';
  return 'wide';
}
