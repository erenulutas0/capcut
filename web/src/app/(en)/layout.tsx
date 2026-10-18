import type { Metadata, Viewport } from 'next';

import { RootBody, rootMetadata, rootViewport } from '@/components/root/RootParts';
// On the server: the English words, for what this layout and its pages write themselves.
import '@/i18n/messages.en';
import '@/i18n/cloudMessages.en';
import { EnglishProvider } from '@/i18n/EnglishProvider';

import '../globals.css';

export const metadata: Metadata = rootMetadata('en');

export const viewport: Viewport = rootViewport;

/** The English pages: `/en/`, `/en/editor`, `/en/yap/<id>`, `/gizlilik/en` (ADR-048). */
export default function EnglishRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <RootBody provider={EnglishProvider}>{children}</RootBody>
    </html>
  );
}
