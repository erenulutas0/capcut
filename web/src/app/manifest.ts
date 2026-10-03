import type { MetadataRoute } from 'next';

import { APP_BACKGROUND, APP_NAME, APP_THEME } from '@/appIdentity';
import { withBasePath } from '@/basePath';

export const dynamic = 'force-static';

/**
 * The web app manifest (ADR-031): what "Uygulama olarak yükle" / "Ana Ekrana
 * Ekle" installs. Served at `<base>/manifest.webmanifest`; Next links it
 * from every page. Paths carry the base path (`/capcut` on GitHub Pages)
 * and the static export's trailing slash, so the installed app opens the
 * exact page the service worker keeps for offline use.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: withBasePath('/'),
    name: APP_NAME,
    short_name: APP_NAME,
    description: 'Videonla ne yapmak istediğini seç: kes, boşlukları at, dikey yap, müzik ekle. Video cihazından çıkmaz.',
    lang: 'tr',
    dir: 'ltr',
    // The opening screen (ADR-034): the installed app starts where the site does.
    start_url: withBasePath('/'),
    scope: withBasePath('/'),
    display: 'standalone',
    background_color: APP_BACKGROUND,
    theme_color: APP_THEME,
    icons: [
      { src: withBasePath('/icons/icon-192.png'), sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: withBasePath('/icons/icon-512.png'), sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: withBasePath('/icons/maskable-512.png'), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
