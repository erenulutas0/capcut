/**
 * Content-Security-Policy for a site whose host cannot send headers
 * (GitHub Pages): the policy is a <meta http-equiv> written into every built
 * HTML file after `next build` (docs/security/2026-09-30-static-site-hardening.md).
 *
 * Why after the build and not in the root layout: the only scripts that are
 * not files are Next's inline bootstrap scripts (the React Server Component
 * payload, `self.__next_f.push(...)`). They are fixed at build time, so they
 * can be allowed by hash instead of 'unsafe-inline'. But the payload embeds
 * the rendered <head>; a CSP written by the layout would contain its own
 * hashes, which is circular. Inserting the tag afterwards keeps the payload
 * unchanged, and React 19 tolerates the extra <head> element.
 *
 * The tag goes right after <meta charset>: a meta policy only governs what
 * the parser meets after it, and Next writes its <script src> tags early.
 *
 * Directives a <meta> cannot carry (frame-ancestors, report-uri/report-to,
 * sandbox) are deliberately absent: browsers ignore them there.
 */
import { createHash } from 'node:crypto';

export const CSP_META_MARKER = 'data-clip-csp';

const META_RE = new RegExp(`<meta http-equiv="Content-Security-Policy" ${CSP_META_MARKER}="" content="[^"]*"/>`, 'g');
// A <script> without a src attribute; its text is hashed byte for byte.
const INLINE_SCRIPT_RE = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g;
const INLINE_STYLE_RE = /<style[^>]*>([\s\S]*?)<\/style>/g;
// A style attribute; the browser hashes its decoded value.
const STYLE_ATTR_RE = /\sstyle="([^"]*)"/g;

const sha256 = (text) => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;

/** Decodes the entities React writes into attribute values. */
export function decodeAttribute(value) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

const unique = (values) => [...new Set(values)].sort();

/** The hashes a page needs: its inline scripts, inline styles and style attributes. */
export function inlineHashes(html) {
  const body = html.replace(META_RE, '');
  const scripts = unique([...body.matchAll(INLINE_SCRIPT_RE)].map((m) => sha256(m[1])));
  // Markup only: script text (the RSC payload) is data, not attributes.
  const markup = body.replace(INLINE_SCRIPT_RE, '').replace(INLINE_STYLE_RE, '');
  const attributes = [...markup.matchAll(STYLE_ATTR_RE)].map((m) => sha256(decodeAttribute(m[1])));
  const styles = unique([...[...body.matchAll(INLINE_STYLE_RE)].map((m) => sha256(m[1])), ...attributes]);
  return { scripts, styles, hasStyleAttributes: attributes.length > 0 };
}

/**
 * The policy. Every relaxation beyond 'self' has a reason:
 * - script-src hashes: Next's inline bootstrap scripts (see above).
 * - NOT here: 'wasm-unsafe-eval'. "Yazıya dök" runs the speech model with
 *   onnxruntime-web, which compiles WebAssembly, and the founder approved
 *   adding the keyword for it (4 Oct 2026, ADR-036). It turned out not to be
 *   needed: the compile happens inside the transcript WORKER, and a worker
 *   started from a URL is governed by its own response headers, not by this
 *   <meta>. Measured with the keyword taken out of the page's policy
 *   (scripts/transcript/csp-experiment.mjs): transcription works in Chromium
 *   153, Chrome 154, Edge 154 and Firefox 155 with zero violations. So
 *   script-src stays exactly as it was. If a browser that applies the page's
 *   policy to workers must be supported, the approved change is one word in
 *   the line below — and the tests in tests/unit/csp.test.ts and
 *   tests/e2e/cspWatch.ts must then be told about it.
 * - style-src 'unsafe-hashes' + hashes: server-rendered `style` attributes
 *   (icon sizes, the timeline playhead). Only these exact values; styles set
 *   later through the DOM (React) are not affected by CSP.
 * - img-src data: blob: — thumbnails and frame grabs made in the page.
 * - media-src blob: — the selected file plays from an object URL.
 * - worker-src blob: — mediabunny starts small helper workers from blobs.
 */
export function buildPolicy({ scripts, styles, hasStyleAttributes }) {
  const styleSrc = ["'self'", ...(hasStyleAttributes ? ["'unsafe-hashes'"] : []), ...styles];
  return [
    "default-src 'self'",
    `script-src ${["'self'", ...scripts].join(' ')}`,
    `style-src ${styleSrc.join(' ')}`,
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join('; ');
}

/** Writes (or rewrites) the policy tag into one HTML document. */
export function applyCsp(html) {
  const policy = buildPolicy(inlineHashes(html));
  const tag = `<meta http-equiv="Content-Security-Policy" ${CSP_META_MARKER}="" content="${policy}"/>`;
  const stripped = html.replace(META_RE, '');
  const charset = /<meta charSet="utf-8"\/>|<meta charset="utf-8"\/?>/i.exec(stripped);
  if (!charset) throw new Error('csp: no <meta charset> to anchor the policy after');
  const at = charset.index + charset[0].length;
  const firstScript = stripped.search(/<script[\s>]/);
  if (firstScript !== -1 && firstScript < at) throw new Error('csp: a <script> comes before <meta charset>');
  return { html: `${stripped.slice(0, at)}${tag}${stripped.slice(at)}`, policy };
}
