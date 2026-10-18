import type { Metadata } from 'next';

import { pageTitle } from '@/appIdentity';
import { EditorApp } from '@/components/editor/EditorApp';
import { languageAlternates } from '@/i18n/alternates';
import '@/i18n/messages.en';
import { translator } from '@/i18n/translate';
import '../../../editor.css';

export const metadata: Metadata = {
  title: pageTitle(translator('en')('meta.editor.title')),
  alternates: languageAlternates('/editor'),
};

/** The editor in English (ADR-048): the same client module as `/editor`. */
export default function EnglishEditorPage() {
  return <EditorApp />;
}
