import type { Metadata, Viewport } from 'next';

import { RootBody, rootMetadata, rootViewport } from '@/components/root/RootParts';
// On the server: the Turkish words, for what this layout and its pages write themselves.
import '@/i18n/messages';
import { TurkishProvider } from '@/i18n/TurkishProvider';

import '../globals.css';

export const metadata: Metadata = rootMetadata('tr');

export const viewport: Viewport = rootViewport;

/** The Turkish pages: `/`, `/editor`, `/yap/<id>`, `/gizlilik` (ADR-048: the English ones have their own root layout). */
export default function TurkishRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <RootBody provider={TurkishProvider}>{children}</RootBody>
    </html>
  );
}
