/**
 * The API key: where it comes from and how it is kept out of every output.
 *
 * - The key is read from `cloud/.env` (line `ASSEMBLYAI_API_KEY=...`) ONLY when
 *   a real run was approved on the command line. A dry run never opens the file.
 * - Nothing prints the key. Every message that could carry it (errors, logs,
 *   the report) goes through `redact()`.
 */
import { existsSync, readFileSync } from 'node:fs';

export const KEY_NAME = 'ASSEMBLYAI_API_KEY';
export const REDACTED = '[REDACTED]';

/** Minimal `.env` reader: KEY=value lines, `#` comments, optional quotes. Returns only the one key asked for. */
export function readKeyFromEnvFile(file, name = KEY_NAME) {
  if (!existsSync(file)) return null;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    if (line.slice(0, eq).trim() !== name) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    return value.length > 0 ? value : null;
  }
  return null;
}

/** Replaces every occurrence of every secret (and anything that looks like an authorization header value) in a text. */
export function redact(text, secrets = []) {
  let out = String(text ?? '');
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length >= 4) out = out.split(secret).join(REDACTED);
  }
  // Belt and braces: a header echoed back by a server or a stack trace.
  out = out.replace(/(authorization["']?\s*[:=]\s*["']?)(?:Bearer\s+)?[^\s"',}]+/gi, `$1${REDACTED}`);
  out = out.replace(new RegExp(`(${KEY_NAME}\\s*=\\s*)\\S+`, 'g'), `$1${REDACTED}`);
  return out;
}

/** An error whose message, stack and cause can be shown: the secrets are already removed. */
export function redactError(error, secrets = []) {
  const message = redact(error?.message ?? String(error), secrets);
  const safe = new Error(message);
  safe.name = error?.name ?? 'Error';
  if (error?.status !== undefined) safe.status = error.status;
  if (error?.code !== undefined) safe.code = error.code;
  safe.stack = redact(error?.stack ?? message, secrets);
  return safe;
}
