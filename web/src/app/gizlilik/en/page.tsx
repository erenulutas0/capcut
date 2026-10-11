import type { Metadata } from 'next';

import { PrivacyPage } from '@/components/PrivacyPage';
import { EnglishMessages } from '@/i18n/EnglishMessages';
import { translator } from '@/i18n/messages';
// On the server too: the page is prerendered in English.
import '@/i18n/messages.en';
import '@/i18n/cloudMessages.en';

const t = translator('en');

export const metadata: Metadata = {
  title: t('privacy.metaTitle'),
  description: t('privacy.metaDescription'),
  alternates: { languages: { tr: '/gizlilik' } },
};

/** The English rendering of the same page, from the same message keys. */
export default function PrivacyPageEn() {
  return (
    <>
      <EnglishMessages />
      <PrivacyPage locale="en" />
    </>
  );
}
