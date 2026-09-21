import type { Metadata } from 'next';

import { PrivacyPage } from '@/components/PrivacyPage';
import { translator } from '@/i18n/messages';

const t = translator('en');

export const metadata: Metadata = {
  title: t('privacy.metaTitle'),
  description: t('privacy.metaDescription'),
  alternates: { languages: { tr: '/gizlilik' } },
};

/** The English rendering of the same page, from the same message keys. */
export default function PrivacyPageEn() {
  return <PrivacyPage locale="en" />;
}
