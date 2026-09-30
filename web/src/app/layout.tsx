import type { Metadata, Viewport } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'Clip — anlarını seç, videonu hazırla',
  description:
    'Kendi videondan tutmak istediğin bölümleri seç, sırala, görüntü ve sesi ayarla. Dosyalar bilgisayarından çıkmaz.',
  // Links out (GitHub Issues, the host's privacy statement) carry no
  // Referer: the page address is nobody else's business. Nothing on the
  // site's own origin reads it. The Content-Security-Policy is not here but
  // written after the build (scripts/apply-csp.mjs, which explains why).
  referrer: 'no-referrer',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#101315',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
