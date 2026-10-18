import type { Metadata } from 'next';

import { HomePage } from '@/components/home/HomePage';
import { languageAlternates } from '@/i18n/alternates';
import '@/i18n/messages';

import '../home.css';

export const metadata: Metadata = { alternates: languageAlternates('/') };

/** The opening screen in Turkish (components/home/HomePage.tsx; `/en/` is the English one). */
export default function TurkishHomePage() {
  return <HomePage locale="tr" />;
}
