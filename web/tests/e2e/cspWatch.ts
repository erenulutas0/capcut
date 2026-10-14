/**
 * Watches a browser context for Content-Security-Policy violations
 * (docs/security/2026-09-30-static-site-hardening.md). Three independent
 * channels, so one quiet channel cannot hide a violation:
 *
 * 1. the `securitypolicyviolation` event in every document of the context,
 *    re-logged to the console with a marker;
 * 2. the browser's own console message ("... violates the following Content
 *    Security Policy directive ...") on pages and workers;
 * 3. Chromium's DevTools issue (`ContentSecurityPolicyIssue`), per page.
 *
 * Workers started from a URL (export, silence) carry no policy on a static
 * host, so nothing can be violated there. Workers started from a blob:
 * (mediabunny's helpers) inherit the page's policy, and a violation inside
 * one does not reach the page: those are covered by the work they do
 * succeeding (the exports in the session test).
 */

import { expect, type BrowserContext, type Page, type Worker } from '@playwright/test';

import { cloudOriginFromEnv } from '../../scripts/lib/cloudOrigin.mjs';

/**
 * What `connect-src` must be, exactly. `'self'` — unless the build under test
 * was given the transcript proxy's origin (ADR-039) and the test run is told
 * the same (`NEXT_PUBLIC_CLOUD_TRANSCRIPT_URL` in the environment of both the
 * build and the tests, as a deploy with the route on sets it): then that one
 * origin more, and nothing else. A build and a test run that disagree fail.
 */
export function expectedConnectSrc(): string {
  const origin = cloudOriginFromEnv();
  return origin ? `'self' ${origin}` : "'self'";
}

/**
 * Against the PUBLISHED site (playwright.live.config.ts) the test run is not told how the site was built:
 * the route may be off or on there. Then `connect-src` may be `'self'`, or `'self'` and exactly one more
 * origin — the proxy Worker the live config names (`LIVE_CLOUD_ORIGIN`) — and nothing else. Everywhere
 * else this is the one exact value above.
 */
export function allowedConnectSrc(): string[] {
  const live = (process.env.LIVE_CLOUD_ORIGIN ?? '').trim();
  if (cloudOriginFromEnv() || !live) return [expectedConnectSrc()];
  return ["'self'", `'self' ${live}`];
}

/** The value a live run has seen: every page of one published site must carry the same one. */
let liveConnectSrc: string | null = null;

function expectConnectSrc(value: string | undefined): void {
  const allowed = allowedConnectSrc();
  if (allowed.length === 1) {
    expect(value, 'connect-src').toBe(allowed[0]);
    return;
  }
  expect(allowed, `connect-src "${value}" of the published site`).toContain(value);
  liveConnectSrc ??= value ?? null;
  expect(value, 'connect-src: the same on every page of the published site').toBe(liveConnectSrc);
}

const MARKER = '[csp-violation]';
const CSP_TEXT = /Content Security Policy|\[csp-violation\]/i;

export interface CspWatch {
  violations: string[];
  /** Starts the DevTools issue channel for a page (Chromium only). */
  attach(page: Page): Promise<void>;
}

export async function watchCsp(context: BrowserContext): Promise<CspWatch> {
  const violations: string[] = [];
  await context.addInitScript((marker) => {
    document.addEventListener('securitypolicyviolation', (event) => {
      console.error(
        `${marker} ${event.effectiveDirective} blocked=${event.blockedURI} at ${event.sourceFile}:${event.lineNumber} sample=${event.sample}`,
      );
    });
  }, MARKER);

  const onWorker = (worker: Worker) =>
    worker.on('console', (message) => {
      if (CSP_TEXT.test(message.text())) violations.push(`worker ${worker.url().slice(0, 60)}: ${message.text()}`);
    });

  const attached = new WeakSet<Page>();
  const attach = async (page: Page) => {
    if (attached.has(page)) return;
    attached.add(page);
    page.on('console', (message) => {
      if (CSP_TEXT.test(message.text())) violations.push(`${page.url()}: ${message.text()}`);
    });
    page.on('worker', onWorker);
    try {
      const cdp = await context.newCDPSession(page);
      cdp.on('Audits.issueAdded', ({ issue }) => {
        if (issue.code === 'ContentSecurityPolicyIssue') {
          violations.push(`${page.url()}: issue ${JSON.stringify(issue.details.contentSecurityPolicyIssueDetails)}`);
        }
      });
      await cdp.send('Audits.enable');
    } catch {
      // Not Chromium: the other two channels still apply.
    }
  };
  context.on('page', (page) => void attach(page));
  for (const page of context.pages()) await attach(page);
  return { violations, attach };
}

/**
 * The page carries the shipped policy, first in <head> after the charset,
 * with no 'unsafe-inline' or 'unsafe-eval' for scripts. Returns the policy.
 */
export async function expectPolicy(page: Page): Promise<string> {
  const head = await page.evaluate(() => {
    const [first, second] = Array.from(document.head.children);
    return {
      first: first?.outerHTML ?? '',
      policy: second?.getAttribute('http-equiv') === 'Content-Security-Policy' ? second.getAttribute('content') : null,
      count: document.querySelectorAll('meta[http-equiv="Content-Security-Policy"]').length,
    };
  });
  expect(head.first.toLowerCase()).toContain('charset="utf-8"');
  expect(head.count, 'exactly one policy tag').toBe(1);
  const policy = head.policy ?? '';
  expect(policy).toContain("default-src 'self'");
  const script = /script-src ([^;]*)/.exec(policy)?.[1] ?? '';
  expect(script.startsWith("'self'")).toBe(true);
  expect(script).not.toContain('unsafe-inline');
  expect(script).not.toContain('unsafe-eval');
  expect(script).not.toContain('*');
  expectConnectSrc(/connect-src ([^;]*);/.exec(policy)?.[1]);
  expect(policy).toContain("object-src 'none'");
  expect(policy).toContain("base-uri 'self'");
  expect(policy).toContain("form-action 'none'");
  return policy;
}
