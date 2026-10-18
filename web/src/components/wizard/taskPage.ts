import type { Metadata } from 'next';

import { pageTitle } from '@/appIdentity';
import { availableTasks, taskById } from '@/domain/tasks';
import { languageAlternates } from '@/i18n/alternates';
import { translator, type Locale } from '@/i18n/translate';

/**
 * What the two `/yap/<id>/` routes share (Turkish `app/(tr)/yap/[id]`, English
 * `app/(en)/en/yap/[id]`; ADR-034, ADR-048). Built ahead of time for exactly the
 * tasks that work today — the static export has no server to ask.
 */
export function taskStaticParams(): Array<{ id: string }> {
  return availableTasks().map((task) => ({ id: task.id }));
}

export async function taskMetadata(params: Promise<{ id: string }>, locale: Locale): Promise<Metadata> {
  const task = taskById((await params).id);
  // A task without a page gets the plain name, not its label: the 404 page is not that task.
  if (!task?.available) return { title: pageTitle() };
  return { title: pageTitle(translator(locale)(task.labelKey)), alternates: languageAlternates(`/yap/${task.id}`) };
}
