/**
 * Renders the install icons (ADR-031) from the site's scissors logo
 * (src/app/icon.svg) with the local Playwright Chromium: no image library,
 * no outside service. The PNGs are committed; run this again only when the
 * logo changes.
 *
 *   node scripts/generate-app-icons.mjs
 *
 * - public/icons/icon-192.png, icon-512.png: the logo as it is (rounded
 *   lime square, transparent corners), purpose "any".
 * - public/icons/maskable-512.png: full-bleed lime, the scissors inside the
 *   maskable safe zone (a centred circle of 80 % diameter; the glyph's
 *   diagonal is 71 %), so Android's circle/squircle masks never cut it.
 * - src/app/apple-icon.png (180 px): opaque, iOS rounds the corners itself
 *   and would paint transparent corners black. Next links it as
 *   <link rel="apple-touch-icon">.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const logo = readFileSync(join(root, 'src', 'app', 'icon.svg'), 'utf8');
const glyph = /<g [\s\S]*<\/g>/.exec(logo)?.[0];
if (!glyph) throw new Error('icon.svg: no <g> with the scissors');
const LIME = '#d2ef78';

/** The scissors (a 24-unit icon) centred on a full-bleed square, `share` of its width. */
function fullBleed(share) {
  const scale = (30 * share) / 24;
  const offset = (30 - 24 * scale) / 2;
  const inner = glyph.replace(/transform="[^"]*"/, `transform="translate(${offset} ${offset}) scale(${scale})"`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30"><rect width="30" height="30" fill="${LIME}"/>${inner}</svg>`;
}

const icons = [
  { file: join(root, 'public', 'icons', 'icon-192.png'), size: 192, svg: logo },
  { file: join(root, 'public', 'icons', 'icon-512.png'), size: 512, svg: logo },
  { file: join(root, 'public', 'icons', 'maskable-512.png'), size: 512, svg: fullBleed(0.5) },
  { file: join(root, 'src', 'app', 'apple-icon.png'), size: 180, svg: fullBleed(0.6) },
];

const browser = await chromium.launch();
try {
  for (const icon of icons) {
    const page = await browser.newPage({ viewport: { width: icon.size, height: icon.size } });
    const sized = icon.svg.replace('<svg ', `<svg width="${icon.size}" height="${icon.size}" `);
    await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${sized}</body></html>`);
    await page.screenshot({ path: icon.file, omitBackground: true, clip: { x: 0, y: 0, width: icon.size, height: icon.size } });
    await page.close();
    console.log(`${icon.file} (${icon.size}×${icon.size})`);
  }
} finally {
  await browser.close();
}
