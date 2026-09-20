import type { Metadata } from 'next';

import { EditorApp } from '@/components/editor/EditorApp';
import '../editor.css';

export const metadata: Metadata = {
  title: 'Clip — editör',
};

/**
 * The editor is a client module (doc 11): `File`, object URLs and media
 * elements are only touched in the browser. This route renders the shell;
 * nothing here reads media during server rendering.
 */
export default function EditorPage() {
  return <EditorApp />;
}
