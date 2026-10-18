import type { Metadata } from 'next';

import { PrivacyPage } from '@/components/PrivacyPage';
import { languageAlternates } from '@/i18n/alternates';
// On the server too: the page is prerendered in English.
import '@/i18n/cloudMessages.en';
import '@/i18n/messages.en';
import { translator } from '@/i18n/translate';

const t = translator('en');

export const metadata: Metadata = {
  title: t('privacy.metaTitle'),
  description: t('privacy.metaDescription'),
  alternates: languageAlternates('/gizlilik'),
};

/** The English rendering of the same page, from the same message keys (in the English root layout, ADR-048). */
export default function PrivacyPageEn() {
  return <PrivacyPage locale="en" />;
}
