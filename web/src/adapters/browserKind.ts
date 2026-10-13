/**
 * Is this a Chromium browser (Chrome, Edge, Opera, Brave, Samsung Internet…)?
 *
 * Asked for one reason only: "try Chrome or Edge" is advice for a browser
 * that is NOT one of them. Said to someone already in Chrome it sends them
 * off to install another browser and meet the same message there (10 Oct
 * 2026: a half-downloaded file was blamed on the browser). So the sentence is
 * shown only where this answers false.
 *
 * Read from the browser's own brand list where it has one, from the user
 * agent otherwise. Unknown (no navigator) counts as Chromium: no advice is
 * better than wrong advice.
 */
export function isChromiumBrowser(): boolean {
  if (typeof navigator === 'undefined') return true;
  const brands = (navigator as Navigator & { userAgentData?: { brands?: ReadonlyArray<{ brand: string }> } }).userAgentData
    ?.brands;
  if (brands && brands.length > 0) return brands.some(({ brand }) => /chromium|chrome|edge/i.test(brand));
  const agent = navigator.userAgent ?? '';
  return /\b(Chrome|Chromium|CriOS|Edg)\//.test(agent);
}

/**
 * iPhone or iPad, whichever browser (iPadOS calls itself a Mac with a touch
 * screen). Asked for one reason only: every browser there runs on the same
 * engine, so "try another browser" is wrong advice on these devices
 * (domain/browserAdvice.ts). Unknown (no navigator) counts as no.
 */
export function isIosDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (
    /\b(iPhone|iPad|iPod)\b/.test(navigator.userAgent ?? '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}
