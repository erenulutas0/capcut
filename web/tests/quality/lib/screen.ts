/**
 * What is on the screen, as a sighted first-time user meets it: the text
 * that is really shown (not the screen-reader-only text, not what is folded
 * away in "Ayrıntılar"), and what kind of screen it is.
 */

import type { Page } from '@playwright/test';

import { countWords, mildJargon, strongJargon, type JargonHit } from './jargon';

export interface ScreenReading {
  /** Path + wizard step + heading: two readings with the same id are the same screen. */
  id: string;
  path: string;
  step: string | null;
  title: string;
  words: number;
  /** Groups of radio buttons shown: a choice the screen puts in front of the user. */
  choiceGroups: number;
  strong: JargonHit[];
  mild: JargonHit[];
  text: string;
}

/** Every piece of text a sighted user can see on the whole page, one piece per line. */
export function visibleText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const pieces: string[] = [];
    const shown = (element: Element): boolean => {
      if (element.closest('.visually-hidden, [hidden], script, style, noscript, template')) return false;
      const withCheck = element as Element & { checkVisibility?: (options?: Record<string, boolean>) => boolean };
      if (withCheck.checkVisibility && !withCheck.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
      // Text set at size 0 is not shown (a word kept for screen readers behind a logo).
      if (parseFloat(getComputedStyle(element).fontSize) < 1) return false;
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (text === '' || !node.parentElement || !shown(node.parentElement)) continue;
      pieces.push(text);
    }
    for (const input of document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input[placeholder], textarea[placeholder]')) {
      if (input.value === '' && input.placeholder && shown(input)) pieces.push(input.placeholder);
    }
    return pieces.join('\n');
  });
}

export async function readScreen(page: Page): Promise<ScreenReading> {
  const text = await visibleText(page);
  const facts = await page.evaluate(() => {
    const wizard = document.querySelector('[data-testid="wizard"]');
    const heading = [...document.querySelectorAll('h1')].find((h) => !h.closest('[hidden]'));
    const groups = new Set<string>();
    for (const radio of document.querySelectorAll<HTMLInputElement>('input[type="radio"]')) {
      const box = (radio.closest('label') ?? radio).getBoundingClientRect();
      if (box.width > 0 && box.height > 0) groups.add(radio.name);
    }
    return {
      path: window.location.pathname,
      step: wizard?.getAttribute('data-step') ?? null,
      title: (heading?.textContent ?? '').trim(),
      choiceGroups: groups.size,
    };
  });
  return {
    id: `${facts.path}|${facts.step ?? ''}|${facts.title}`,
    ...facts,
    words: countWords(text),
    strong: strongJargon(text),
    mild: mildJargon(text),
    text,
  };
}

export interface PageProblems {
  pageErrors: string[];
  consoleErrors: string[];
  unhandledRejections: string[];
}

/** Listens for everything a page can say about having broken; call before the page loads. */
export async function watchProblems(page: Page): Promise<PageProblems> {
  const problems: PageProblems = { pageErrors: [], consoleErrors: [], unhandledRejections: [] };
  page.on('pageerror', (error) => problems.pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.consoleErrors.push(message.text().slice(0, 300));
  });
  await page.exposeFunction('__qualityRejection', (reason: string) => {
    problems.unhandledRejections.push(reason.slice(0, 300));
  });
  await page.addInitScript(() => {
    window.addEventListener('unhandledrejection', (event) => {
      const report = (window as unknown as { __qualityRejection?: (reason: string) => void }).__qualityRejection;
      report?.(String((event.reason as { message?: string } | undefined)?.message ?? event.reason));
    });
  });
  return problems;
}

/** Uncaught errors (an unhandled rejection is one of them in Chromium) and console errors. */
export function problemCount(problems: PageProblems): number {
  return problems.pageErrors.length + problems.consoleErrors.length;
}
