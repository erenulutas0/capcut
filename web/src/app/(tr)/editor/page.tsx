import type { Metadata } from 'next';

import { pageTitle } from '@/appIdentity';
import { EditorApp } from '@/components/editor/EditorApp';
import { languageAlternates } from '@/i18n/alternates';
import '@/i18n/messages';
import { translator } from '@/i18n/translate';
import '../../editor.css';

export const metadata: Metadata = {
  title: pageTitle(translator('tr')('meta.editor.title')),
  alternates: languageAlternates('/editor'),
};

/**
 * The editor is a client module (doc 11): `File`, object URLs and media
 * elements are only touched in the browser. This route renders the shell;
 * nothing here reads media during server rendering. `/en/editor` is the same
 * editor in English (ADR-048).
 */
export default function EditorPage() {
  return <EditorApp />;
}
