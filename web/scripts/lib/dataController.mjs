/**
 * The data controller's NAME for /gizlilik (doc 30 K02; founder decision 14 Oct 2026: the founder,
 * as a private person, until a company exists): `NEXT_PUBLIC_DATA_CONTROLLER_NAME`, set only by the
 * deploy build (repository variable DATA_CONTROLLER_NAME).
 *
 * Empty (local builds, tests, CI before the variable exists): the page says "belirlenmedi" — it never
 * guesses a name. The contact shown next to the name is NEXT_PUBLIC_SUPPORT_CONTACT, so this setting
 * is a name only: an e-mail address or a link here stops the build instead of being published.
 */

/**
 * @param {string | undefined} raw
 * @returns {string} '' when unset, otherwise the trimmed name
 */
export function normalizeControllerName(raw) {
  const name = (raw ?? '').trim();
  if (/[@<>]|:\/\/|^www\./i.test(name) || name.length > 120) {
    throw new Error(
      'NEXT_PUBLIC_DATA_CONTROLLER_NAME must be a plain name — no e-mail address, no link, at most 120 characters (the contact is NEXT_PUBLIC_SUPPORT_CONTACT)',
    );
  }
  return name;
}

/** The setting as this build's environment has it. */
export function controllerNameFromEnv(env = process.env) {
  return normalizeControllerName(env.NEXT_PUBLIC_DATA_CONTROLLER_NAME);
}
