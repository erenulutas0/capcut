'use client';

import { startTransition, useEffect, useState } from 'react';

/** True once React has taken over the page this tab loaded; a later mount (a client-side navigation) starts from the browser's value. */
let pageHydrated = false;

/**
 * A value only the browser knows (the window's width, the kind of pointer, "React owns the page"),
 * drawn first as it was in the prerendered HTML (`server`) and switched to the browser's own value once
 * the page is live.
 *
 * `useSyncExternalStore` does the same, but makes the switch a synchronous re-render right after
 * hydration: in the editor that was the whole editor again in one long task (14 Oct 2026: about 80 ms
 * under phone throttling, a third of the editor's blocking time at load). Here the switch is a
 * transition, which React renders in short slices; later changes (a resize, a rotation) are ordinary
 * updates. Components that mount after the page is live (a client-side navigation, a part shown later)
 * start from the browser's value, as with `useSyncExternalStore`.
 *
 * `read` and `subscribe` must be stable (module-level functions).
 */
export function useBrowserValue<T>(read: () => T, server: T, subscribe?: (onChange: () => void) => () => void): T {
  const [value, setValue] = useState<T>(() => (pageHydrated ? read() : server));
  useEffect(() => {
    pageHydrated = true;
    const update = () => {
      const next = read();
      setValue(() => next);
    };
    startTransition(update);
    return subscribe?.(update);
  }, [read, subscribe]);
  return value;
}
