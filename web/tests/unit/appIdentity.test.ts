import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import manifest from '@/app/manifest';
import { APP_NAME, APP_SLUG, BACKUP_DEFAULT_BASENAME, BACKUP_FILE_SUFFIX, pageTitle } from '@/appIdentity';
import { diagnosticsFileName } from '@/domain/diagnostics';
import { tr, type MessageKey } from '@/i18n/messages';
import { en } from '@/i18n/messages.en';

/**
 * The product's name is written once, in `src/appIdentity.ts` (ADR-038).
 * These checks fail when a former name comes back as a PRODUCT name. They do
 * not look at the word "clip" as the thing the editor cuts (EN "Clip {n}",
 * "Clips"), at code identifiers, or at the names of what the browser stores
 * (`clip-editor`, `clip-export-`, `clip-app-`, `clip-models-`,
 * `clip.firstRunHint.dismissed`): those stay on purpose.
 */

/** The working name until 10 Oct 2026, as a word of its own with a capital. */
const OLD_NAME = /\bClip\b/;
/** In English the same word also starts sentences about a kesit: "Clip {n} added". */
const OLD_NAME_EN = /\bClip\b(?! \{)/;
/** File names the old name was part of. */
const OLD_FILE_NAMES = /clip-tani|clip-projesi|\.clip\.json/;
/** A name that was proposed and withdrawn the same day; written in two halves so this file does not contain it. */
const WITHDRAWN_NAME = new RegExp(['loli', 'cut'].join('[ _-]?'), 'i');

const webDir = process.cwd();
const repoDir = join(webDir, '..');
const read = (...parts: string[]) => readFileSync(join(webDir, ...parts), 'utf8');

/** Source without comments: a comment may tell the history, a string may not. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const SKIP_DIRS = new Set(['node_modules', '.next', 'out', '.git', 'media', 'test-results', 'playwright-report', 'matrix-results', 'models', '.models-cache', 'spike-results', 'transcript-results', 'worktrees']);
const TEXT_FILE = /\.(ts|tsx|mts|mjs|js|json|md|css|html|svg|yml|yaml|txt|webmanifest|ps1)$/;

function textFiles(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    if (SKIP_DIRS.has(name)) return [];
    const path = join(folder, name);
    if (statSync(path).isDirectory()) return textFiles(path);
    return TEXT_FILE.test(name) && name !== 'package-lock.json' ? [path] : [];
  });
}

describe('the product name has one source', () => {
  it('derives the file names from the name', () => {
    expect(APP_SLUG).toBe(APP_NAME.toLowerCase());
    expect(APP_SLUG).toMatch(/^[a-z0-9-]+$/);
    expect(BACKUP_FILE_SUFFIX).toBe(`.${APP_SLUG}.json`);
    expect(BACKUP_DEFAULT_BASENAME.startsWith(`${APP_SLUG}-`)).toBe(true);
    expect(diagnosticsFileName(new Date(2026, 9, 10, 8, 0))).toBe(`${APP_SLUG}-tani-20261010-0800.json`);
    expect(pageTitle()).toBe(APP_NAME);
    expect(pageTitle('editör')).toBe(`${APP_NAME} — editör`);
  });

  it('names the installed app', () => {
    const data = manifest();
    expect(data.name).toBe(APP_NAME);
    expect(data.short_name).toBe(APP_NAME);
    const text = JSON.stringify(data);
    expect(text).not.toMatch(OLD_NAME);
    expect(text).not.toMatch(WITHDRAWN_NAME);
  });

  it('shows the name in the messages, in both languages', () => {
    for (const dictionary of [tr, en]) {
      expect(dictionary['app.name']).toBe(APP_NAME);
      expect(dictionary['a11y.editorHeading']).toContain(APP_NAME);
      expect(dictionary['privacy.metaTitle'].startsWith(`${APP_NAME} — `)).toBe(true);
      expect(dictionary['transcript.file.header']).toContain(APP_NAME);
      expect(dictionary['privacy.downloads.backup']).toContain(BACKUP_FILE_SUFFIX);
    }
  });

  it('has no former name left in a message', () => {
    const offenders: string[] = [];
    for (const key of Object.keys(tr) as MessageKey[]) {
      // Turkish calls the cut part "kesit": the word never appears there.
      if (OLD_NAME.test(tr[key]) || OLD_FILE_NAMES.test(tr[key]) || WITHDRAWN_NAME.test(tr[key])) offenders.push(`tr ${key}`);
      if (OLD_NAME_EN.test(en[key]) || OLD_FILE_NAMES.test(en[key]) || WITHDRAWN_NAME.test(en[key])) offenders.push(`en ${key}`);
    }
    expect(offenders).toEqual([]);
  });

  it('the guard really tells the product name from the word', () => {
    expect(OLD_NAME_EN.test('Clip {n} added: {range}')).toBe(false);
    expect(OLD_NAME_EN.test('Clips')).toBe(false);
    expect(OLD_NAME_EN.test('IndexedDB “clip-editor”, store “projects”')).toBe(false);
    expect(OLD_NAME_EN.test('Written automatically on this device with Clip — it may be wrong.')).toBe(true);
    expect(OLD_NAME_EN.test('Clip editor')).toBe(true);
    expect(OLD_NAME.test('Clip geçici çalışma adıdır.')).toBe(true);
    expect(OLD_FILE_NAMES.test('Proje yedeği (.clip.json)')).toBe(true);
    expect(WITHDRAWN_NAME.test(['Loli', 'Cut'].join(''))).toBe(true);
    expect(WITHDRAWN_NAME.test(APP_NAME)).toBe(false);
  });

  it('writes the name as a literal nowhere but appIdentity.ts', () => {
    const offenders: string[] = [];
    for (const file of textFiles(join(webDir, 'src'))) {
      if (file.endsWith('appIdentity.ts')) continue;
      const source = code(readFileSync(file, 'utf8'));
      if (source.includes(APP_NAME)) offenders.push(`${file}: the name is repeated`);
      // `'Clip Caption'` is the burned-in typeface's CSS family name, not the product.
      if (/\.tsx?$/.test(file) && OLD_NAME.test(source.replace(/'Clip Caption'/g, '').replace(/'[^'\n]*Clip \{[^'\n]*'/g, ''))) {
        offenders.push(`${file}: the former name`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the page titles, the wordmark and the placeholder worker come from the name', () => {
    expect(code(read('src', 'app', 'layout.tsx'))).toContain('title: pageTitle(');
    expect(code(read('src', 'app', 'editor', 'page.tsx'))).toContain('title: pageTitle(');
    expect(code(read('src', 'app', 'yap', '[id]', 'page.tsx'))).toContain('title: pageTitle(');
    expect(code(read('src', 'components', 'Icon.tsx'))).toMatch(/<\/span>\s*\{APP_NAME\}\s*<\/span>/);
    expect(code(read('src', 'components', 'editor', 'useProjectPersistence.ts'))).toContain('${BACKUP_FILE_SUFFIX}');
  });

  it('the withdrawn name is nowhere in the repository', () => {
    // What git tracks or would add (not ignored): a walk of the whole folder also read local raw
    // results and agent worktrees, and timed out under a busy full run.
    const listed = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: repoDir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      .split(String.fromCharCode(0))
      .filter((name) => name !== '' && TEXT_FILE.test(name) && !name.endsWith('package-lock.json') && !name.startsWith('.claude/'))
      .map((name) => join(repoDir, name))
      .filter((path) => existsSync(path));
    expect(listed.length).toBeGreaterThan(100);
    const offenders = listed.filter((file) => WITHDRAWN_NAME.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  }, 30_000);
});
