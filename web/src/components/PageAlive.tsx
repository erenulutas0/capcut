'use client';

import { useEffect } from 'react';

import { markPageAlive } from '@/pageWatchdog';

/**
 * In the root layout: its effect runs only once React has taken over the
 * page, and that is the sign the page's watchdog waits for (src/pageWatchdog.ts,
 * ADR-044). Draws nothing.
 */
export function PageAlive() {
  useEffect(() => {
    markPageAlive();
  }, []);
  return null;
}
