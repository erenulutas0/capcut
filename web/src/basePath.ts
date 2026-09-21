/**
 * The sub-path the app is served from ('' locally, '/capcut' on GitHub
 * Pages). `next/link` adds it by itself; everything that builds a URL by hand
 * (plain anchors that open a new tab, font files fetched by a worker) must
 * add it through this helper, or it breaks only in production.
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export function withBasePath(path: string): string {
  return `${BASE_PATH}${path}`;
}
