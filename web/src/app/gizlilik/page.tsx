import type { Metadata } from 'next';

import { PrivacyPage } from '@/components/PrivacyPage';
import { translator } from '@/i18n/messages';

const t = translator('tr');

export const metadata: Metadata = {
  title: t('privacy.metaTitle'),
  description: t('privacy.metaDescription'),
  alternates: { languages: { en: '/gizlilik/en' } },
};

export default function GizlilikPage() {
  return <PrivacyPage locale="tr" />;
}
