import type { Metadata } from 'next';

import { PrivacyPage } from '@/components/PrivacyPage';
import { languageAlternates } from '@/i18n/alternates';
import '@/i18n/cloudMessages';
import '@/i18n/messages';
import { translator } from '@/i18n/translate';

const t = translator('tr');

export const metadata: Metadata = {
  title: t('privacy.metaTitle'),
  description: t('privacy.metaDescription'),
  alternates: languageAlternates('/gizlilik'),
};

export default function GizlilikPage() {
  return <PrivacyPage locale="tr" />;
}
