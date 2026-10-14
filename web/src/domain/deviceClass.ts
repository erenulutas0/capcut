/**
 * What kind of device and browser the page is on — asked only to decide
 * whether the large speech model is one the app has SEEN work here
 * (ADR-036, addendum of 14 Oct 2026). Nothing of it is stored or sent.
 *
 * Two signals, both read by the adapter from `navigator`:
 *
 * - User-Agent Client Hints (`navigator.userAgentData`): `mobile`,
 *   `platform` and the brand list. Chromium-family browsers have it, and
 *   only in a secure context (the site is https; localhost counts). It is
 *   trusted only when it carries brands — an overridden user agent can leave
 *   an empty, all-false object behind.
 * - The User-Agent string, as the fallback (Firefox and Safari have no
 *   client hints) and as a second opinion: any sign of a phone or a tablet
 *   in either signal counts.
 *
 * Known limits (said in the ADR): an Android tablet in Chrome's default
 * "desktop site" mode, and a phone whose user asked for the desktop site,
 * look like a desktop computer to every signal a page can read; an iPad's
 * Safari says "Macintosh" — but Safari is not a Chromium browser, so the
 * large model is not counted as proven there anyway. A browser that lies
 * about itself is believed.
 *
 * Pure: the caller hands in what the browser said.
 */

export interface UserAgentHints {
  /** `navigator.userAgent`. */
  userAgent: string;
  /** `navigator.userAgentData`, when the browser has it. */
  data?: { mobile?: unknown; platform?: unknown; brands?: unknown } | null;
}

export interface DeviceClass {
  /** A phone or a tablet, by any signal. */
  handheld: boolean;
  /** A Chromium-family browser (Chrome, Edge, and the others built on Chromium). */
  chromium: boolean;
  /** Which signal the browser family came from. */
  source: 'client-hints' | 'user-agent';
}

/** Phones and tablets, by their User-Agent strings ("Mobile" is in iOS, Android phone and Firefox-for-Android strings). */
const HANDHELD_UA = /Android|iPhone|iPad|iPod|Mobile|Tablet|Silk|Kindle/i;
/** Chromium's own tokens. iOS browsers (CriOS, EdgiOS) run on WebKit and do not carry `Chrome/`. */
const CHROMIUM_UA = /(?:^|[\s(;])(?:Chrome|Chromium|HeadlessChrome)\/\d/;
const HANDHELD_PLATFORMS: ReadonlySet<string> = new Set(['android', 'ios', 'ipados']);
const CHROMIUM_BRANDS: ReadonlySet<string> = new Set(['chromium', 'google chrome', 'microsoft edge']);

function brandsOf(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry: unknown) => (typeof entry === 'object' && entry !== null ? (entry as { brand?: unknown }).brand : undefined))
    .filter((brand): brand is string => typeof brand === 'string' && brand.length > 0);
}

export function classifyDevice(hints: UserAgentHints): DeviceClass {
  const ua = typeof hints.userAgent === 'string' ? hints.userAgent : '';
  const uaHandheld = HANDHELD_UA.test(ua);
  const data = hints.data;
  const brands = brandsOf(data?.brands);
  if (data && brands.length > 0 && typeof data.mobile === 'boolean') {
    const platform = typeof data.platform === 'string' ? data.platform.toLowerCase() : '';
    return {
      handheld: data.mobile || HANDHELD_PLATFORMS.has(platform) || uaHandheld,
      chromium: brands.some((brand) => CHROMIUM_BRANDS.has(brand.toLowerCase())),
      source: 'client-hints',
    };
  }
  return { handheld: uaHandheld, chromium: CHROMIUM_UA.test(ua), source: 'user-agent' };
}
