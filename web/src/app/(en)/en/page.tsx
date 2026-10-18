import type { Metadata } from 'next';

import { HomePage } from '@/components/home/HomePage';
import { languageAlternates } from '@/i18n/alternates';
import '@/i18n/messages.en';

import '../../home.css';

export const metadata: Metadata = { alternates: languageAlternates('/') };

/** The opening screen in English (ADR-048). */
export default function EnglishHomePage() {
  return <HomePage locale="en" />;
}
