'use client';

import Link from 'next/link';
import { createContext, useContext, type ComponentProps, type ReactNode } from 'react';

import { isPlainPress, useNavigationFallback } from '@/components/home/navigationFallback';
import { useLocalePath, useT } from '@/i18n/locale';

type Scope = ReturnType<typeof useNavigationFallback>;

const NavigationFallbackContext = createContext<Scope | null>(null);

/**
 * One guard for one screen (ADR-044, addendum of 14 Oct 2026): every
 * `FallbackLink` and the task cards inside this scope share it, so the
 * full load after a press that never completes happens at most once per
 * screen, whichever link was pressed. Put it around a screen whose links
 * go through Next's client router.
 */
export function NavigationFallbackScope({ children }: { children: ReactNode }) {
  const scope = useNavigationFallback();
  return <NavigationFallbackContext.Provider value={scope}>{children}</NavigationFallbackContext.Provider>;
}

/** The screen's guard: which path is opening (for "Açılıyor…") and `begin(path)` for a press. */
export function useNavigationScope(): Scope {
  const scope = useContext(NavigationFallbackContext);
  if (!scope) throw new Error('useNavigationScope: no NavigationFallbackScope above this screen');
  return scope;
}

type LinkProps = Omit<ComponentProps<typeof Link>, 'href' | 'prefetch'> & {
  href: string;
  /**
   * What the link shows while its page is opening. Default: "Açılıyor…" in
   * place of the children. `false` keeps the children (a logo) and says it
   * to assistive technology only (`aria-busy`, `aria-label`).
   */
  opening?: ReactNode | false;
};

/**
 * A `next/link` on a screen that must never seem dead: the pressed link
 * says "Açılıyor…" at once, and a navigation whose page data never arrives
 * ends in a full load of the same address after 10 s, once per screen
 * (`navigationFallback.ts`; the first was the opening screen's task cards).
 *
 * `prefetch={false}` always: Next 16's static export writes nested segment
 * payloads under a different name than its prefetcher requests, which 404s
 * on GitHub Pages (app/page.tsx). A press that opens a new tab or window is
 * the browser's own and is not watched.
 */
export function FallbackLink({ href: path, opening, children, onClick, ...rest }: LinkProps) {
  const t = useT();
  // In the page's own language (ADR-048): '/editor' is '/en/editor' on an English page.
  const href = useLocalePath()(path);
  const { pendingPath, begin } = useNavigationScope();
  const isOpening = pendingPath === href;
  const label = opening === undefined ? t('home.opening') : opening;
  return (
    <Link
      {...rest}
      href={href}
      prefetch={false}
      onClick={(event) => {
        onClick?.(event);
        if (isPlainPress(event)) begin(href);
      }}
      aria-busy={isOpening || undefined}
      aria-label={isOpening && label === false ? t('home.opening') : rest['aria-label']}
      data-pending={isOpening || undefined}
    >
      {isOpening && label !== false ? label : children}
    </Link>
  );
}
