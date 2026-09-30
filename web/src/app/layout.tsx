import type { Metadata, Viewport } from 'next';

import { APP_NAME, APP_THEME } from '@/appIdentity';
import { PwaClient } from '@/components/pwa/PwaClient';

import './globals.css';

export const metadata: Metadata = {
  title: 'Clip — anlarını seç, videonu hazırla',
  description:
    'Kendi videondan tutmak istediğin bölümleri seç, sırala, görüntü ve sesi ayarla. Dosyalar cihazından çıkmaz.',
  // Links out (GitHub Issues, the host's privacy statement) carry no
  // Referer: the page address is nobody else's business. Nothing on the
  // site's own origin reads it. The Content-Security-Policy is not here but
  // written after the build (scripts/apply-csp.mjs, which explains why).
  referrer: 'no-referrer',
  // Installed app (ADR-031): the manifest comes from app/manifest.ts, the
  // home-screen icon for iOS from app/apple-icon.png.
  applicationName: APP_NAME,
  appleWebApp: { capable: true, title: APP_NAME, statusBarStyle: 'black' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: APP_THEME,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body>
        {children}
        <PwaClient />
      </body>
    </html>
  );
}
