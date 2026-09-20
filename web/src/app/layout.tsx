import type { Metadata, Viewport } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'Clip — anlarını seç, videonu hazırla',
  description:
    'Kendi videondan tutmak istediğin bölümleri seç, sırala, görüntü ve sesi ayarla. Dosyalar bilgisayarından çıkmaz.',
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
