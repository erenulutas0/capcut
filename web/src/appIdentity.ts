/**
 * The product's name and colours: the ONE place the name is written.
 *
 * Everything a person sees derives from `APP_NAME`: the installed app's name
 * and splash screen (`app/manifest.ts`), the browser tab titles
 * (`app/layout.tsx` and the pages), the wordmark (`components/Icon.tsx`), the
 * texts in `i18n/messages.ts`, and the names of the files the app hands over
 * (`APP_SLUG`). Renaming the product is a change to this line
 * (ADR-038); `tests/unit/appIdentity.test.ts` fails when an older name comes
 * back somewhere as a product name.
 *
 * What does NOT follow the name, on purpose (ADR-038): the names of what the
 * app keeps in the browser (IndexedDB `clip-editor`, the `clip-export-`
 * files, the `clip-app-` / `clip-models-` caches, the
 * `clip.firstRunHint.dismissed` key). Renaming those would orphan what
 * people already have stored.
 */
export const APP_NAME = 'LiloCut';

/** The name as it appears in file names the app suggests: lower case, no spaces. */
export const APP_SLUG = APP_NAME.toLowerCase().replace(/[^a-z0-9]+/g, '-');

/** `<title>` of a page: "LiloCut — editör". The bare name when there is no page name. */
export function pageTitle(page?: string): string {
  return page ? `${APP_NAME} — ${page}` : APP_NAME;
}

/** The end of a project backup's file name. Older backups (".clip.json") open the same way: the reader looks at the content. */
export const BACKUP_FILE_SUFFIX = `.${APP_SLUG}.json`;

/** The backup's file name when the project has no name. */
export const BACKUP_DEFAULT_BASENAME = `${APP_SLUG}-projesi`;

/** The dark "Quiet Studio" background (`--bg` in globals.css). */
export const APP_BACKGROUND = '#101315';

/** The browser bar and the installed app's title bar: the same dark. */
export const APP_THEME = '#101315';
