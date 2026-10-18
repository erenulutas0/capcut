import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

import { searchTasks } from '@/domain/taskSearch';
import { TASK_EXAMPLES, TASK_EXAMPLES_EN } from '@/domain/tasks';
import { formatSpokenTime } from '@/domain/time';
import { cloudTr } from '@/i18n/cloudMessages';
import { cloudEn } from '@/i18n/cloudMessages.en';
import { tr } from '@/i18n/messages';
import { en } from '@/i18n/messages.en';

/**
 * ADR-048: the whole app in English. Every word the Turkish screen can show has
 * its English twin, with the same blanks to fill; the English never sends a
 * reader to a Turkish button; and each page loads one language's words only.
 */

const SRC = join(process.cwd(), 'src');

/** `{name}` blanks. `{acc}` is the Turkish accusative ending after a number ("Kesit 2'yi"): English has none. */
const blanks = (text: string) => [...new Set(text.match(/\{\w+\}/g) ?? [])].filter((blank) => blank !== '{acc}').sort();

const TABLES = [
  { name: 'messages', tr: tr as Record<string, string>, en: en as Record<string, string> },
  { name: 'cloudMessages', tr: cloudTr as Record<string, string>, en: cloudEn as Record<string, string> },
];

describe('every Turkish message has its English twin', () => {
  for (const table of TABLES) {
    it(`${table.name}: the same keys, none empty`, () => {
      expect(Object.keys(table.en).sort()).toEqual(Object.keys(table.tr).sort());
      expect(Object.entries(table.en).filter(([, text]) => text.trim() === '').map(([key]) => key)).toEqual([]);
    });

    it(`${table.name}: the same blanks to fill, the same bold marks`, () => {
      const offenders = Object.keys(table.tr).filter((key) => {
        const a = table.tr[key] ?? '';
        const b = table.en[key] ?? '';
        return blanks(a).join() !== blanks(b).join() || (a.match(/\*\*/g)?.length ?? 0) !== (b.match(/\*\*/g)?.length ?? 0);
      });
      expect(offenders).toEqual([]);
    });
  }
});

describe('the English reads as English', () => {
  /** The keys that name Turkish itself: the language button and the caption language. */
  const TURKISH_ON_PURPOSE = new Set(['captions.language.tr', 'privacy.stored.language.body']);

  it('no Turkish letter outside the name of the language', () => {
    const offenders = TABLES.flatMap((table) =>
      Object.entries(table.en)
        .filter(([key, text]) => !TURKISH_ON_PURPOSE.has(key) && /[çğıöşüÇĞİÖŞÜ]/.test(text.replace(/Windows-1254/g, '')))
        .map(([key, text]) => `${key}: ${text}`),
    );
    expect(offenders).toEqual([]);
  });

  it('a decimal point, never a decimal comma', () => {
    const offenders = TABLES.flatMap((table) =>
      Object.entries(table.en)
        .filter(([, text]) => /\d,\d/.test(text))
        .map(([key, text]) => `${key}: ${text}`),
    );
    expect(offenders).toEqual([]);
    expect(en['time.decimalMark']).toBe('.');
    expect(en['number.percent']).toBe('{n}%');
    expect(en['time.secondShort']).toBe('s');
    expect(en['time.minuteShort']).toBe('min');
  });

  it('a plural for every count but one', () => {
    expect([en['time.minute'], en['time.minutes'], en['time.second'], en['time.seconds']]).toEqual(['minute', 'minutes', 'second', 'seconds']);
    // Turkish has one form; the plural keys say the same word.
    expect(tr['time.minutes']).toBe(tr['time.minute']);
    expect(tr['time.seconds']).toBe(tr['time.second']);
    const words = (table: typeof tr | typeof en) => ({
      minute: table['time.minute'],
      minutes: table['time.minutes'],
      second: table['time.second'],
      seconds: table['time.seconds'],
      decimalMark: table['time.decimalMark'],
    });
    expect(formatSpokenTime(1_000_000, words(en))).toBe('1 second');
    expect(formatSpokenTime(1_500_000, words(en))).toBe('1.5 seconds');
    expect(formatSpokenTime(60_000_000, words(en))).toBe('1 minute');
    expect(formatSpokenTime(121_000_000, words(en))).toBe('2 minutes 1 second');
    expect(formatSpokenTime(64_033_000, words(tr))).toBe('1 dakika 4,033 saniye');
  });

  /**
   * A button or a screen named in a sentence (“Download the model”) must be one the English
   * app really shows: until 18 Oct 2026 the English privacy page sent its reader to “Yazıya dök”.
   * Quoted words that are not labels — a stored key, a file name, an example — are listed here.
   */
  const NOT_LABELS = new Set([
    'clip.firstRunHint.dismissed',
    'clip:page-recovery',
    'clip-app-',
    'clip-models-',
    'clip-shared',
    'clip-export-',
    'clip-editor',
    'projects',
    'exportLog',
    'clip.transcriptLargeFailed',
    'clip.language',
    'clip.cloudInvite',
    'sw.js',
    'tr',
    'en',
    '?lang=tr',
    '?lang=en',
    'not decided',
    'a file did not arrive',
    'no speech',
    '…',
    '{text}',
    // Microsoft's own name of the store item.
    'HEVC Video Extensions',
  ]);

  // A label, and its name without what follows it: “Download the model” is “Download the model (≈{size}, once)”,
  // “How to cut” is “How to cut: three steps”.
  const labels = new Set(
    TABLES.flatMap((table) => Object.values(table.en)).flatMap((text) => {
      const whole = text.trim().replace(/[.…:]+$/, '');
      return [whole, whole.split(' (')[0] ?? whole, whole.split(': ')[0] ?? whole];
    }),
  );
  /** “More → Delete the saved project”: a path through menus, every step a label. */
  const isLabel = (quoted: string) =>
    /^\{\w+\}$/.test(quoted) || labels.has(quoted) || quoted.split(' → ').every((part) => labels.has(part.trim()) || labels.has(part.trim().replace(/[.…:]+$/, '')));

  it('names only buttons and screens the English app shows', () => {
    const offenders = TABLES.flatMap((table) =>
      Object.entries(table.en).flatMap(([key, text]) =>
        [...text.matchAll(/“([^”]+)”/g)]
          .map((match) => match[1] ?? '')
          .filter((quoted) => !NOT_LABELS.has(quoted) && !isLabel(quoted))
          .map((quoted) => `${key}: “${quoted}”`),
      ),
    );
    expect(offenders).toEqual([]);
  });

  it('the English example chips find the same tasks as the Turkish ones, as the answer', () => {
    const answer = (text: string) => {
      const result = searchTasks(text);
      return result.kind === 'results' ? `${result.confidence}:${result.matches[0]?.task.id}` : result.kind;
    };
    expect(TASK_EXAMPLES_EN.map(answer)).toEqual(TASK_EXAMPLES.map(answer));
    expect(TASK_EXAMPLES_EN.map(answer).every((item) => item.startsWith('sure:'))).toBe(true);
    // The placeholder of the box is the first example, in both languages.
    expect(en['home.search.placeholder']).toBe(`Type: ${TASK_EXAMPLES_EN[0]}`);
    expect(tr['home.search.placeholder']).toBe(`Yaz: ${TASK_EXAMPLES[0]}`);
  });

  it('the cards (ADR-048 term list)', () => {
    expect(
      ['kes', 'bosluk', 'dikey', 'kucult', 'yazi', 'muzik', 'ses', 'sustur', 'cevir', 'iyilestir', 'gif'].map((id) => en[`task.${id}.label` as keyof typeof en]),
    ).toEqual(['Cut', 'Remove silences', 'Make it vertical', 'Shrink', 'Speech to text', 'Add music', 'Get the sound', 'Mute', 'Make it play everywhere', 'Enhance', 'Make a GIF']);
    // One word for "kesit": "clip", never "cut" as a noun of the list.
    expect(en['kesit.title']).toBe('Clips');
    expect(en['home.results.unavailable']).toBe('We can’t do that yet.');
  });
});

// ------------------------------------------------------------------ one language per page

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const files = sourceFiles(SRC).map((path) => ({ name: relative(SRC, path).split(sep).join('/'), code: readFileSync(path, 'utf8') }));

/** An import that brings a module's VALUES (not `import type`, not a type-only list). */
function valueImports(code: string, module: RegExp): string[] {
  return [...code.matchAll(/^import\s+(?!type\s)([^;]*?)\s*from\s*'([^']+)';|^import\s+'([^']+)';/gm)]
    .filter((match) => module.test(match[2] ?? match[3] ?? ''))
    .map((match) => match[0]);
}

describe('each page carries one language’s words', () => {
  const TURKISH = /^(@\/i18n\/messages|\.\/messages|\.\.\/i18n\/messages)$/;
  const TURKISH_CLOUD = /^(@\/i18n\/cloudMessages|\.\/cloudMessages)$/;
  const ENGLISH = /^(@\/i18n\/messages\.en|\.\/messages\.en)$/;
  const ENGLISH_CLOUD = /^(@\/i18n\/cloudMessages\.en|\.\/cloudMessages\.en)$/;

  /**
   * The modules that may load a language's table: the language's own provider and pages, the
   * other table (for its key type: `import type` only), and the server-only parts that draw both
   * languages into plain HTML (the watchdog's notice, the 404 page). The Yazı wizard loads the
   * cloud route's words of the page's language with the route's own chunk.
   */
  const MAY_LOAD_TURKISH = new Set([
    'i18n/TurkishProvider.tsx',
    'app/(tr)/layout.tsx',
    'app/(tr)/page.tsx',
    'app/(tr)/editor/page.tsx',
    'app/(tr)/yap/[id]/page.tsx',
    'app/(tr)/gizlilik/page.tsx',
    'app/global-not-found.tsx',
    'components/PageWatchdog.tsx',
  ]);
  const MAY_LOAD_ENGLISH = new Set([
    'i18n/EnglishProvider.tsx',
    'app/(en)/layout.tsx',
    'app/(en)/en/page.tsx',
    'app/(en)/en/editor/page.tsx',
    'app/(en)/en/yap/[id]/page.tsx',
    'app/(en)/gizlilik/en/page.tsx',
    'app/global-not-found.tsx',
    'components/PageWatchdog.tsx',
  ]);

  it('the Turkish table is loaded only by the Turkish pages (and the plain-HTML parts that show both)', () => {
    const offenders = files
      .filter((file) => !file.name.startsWith('i18n/messages') && !file.name.startsWith('i18n/cloudMessages'))
      .filter((file) => valueImports(file.code, TURKISH).length > 0 && !MAY_LOAD_TURKISH.has(file.name))
      .map((file) => file.name);
    expect(offenders).toEqual([]);
  });

  it('the English table is loaded only by the English pages (and the plain-HTML parts that show both)', () => {
    const offenders = files
      .filter((file) => valueImports(file.code, ENGLISH).length > 0 && !MAY_LOAD_ENGLISH.has(file.name))
      .map((file) => file.name);
    expect(offenders).toEqual([]);
  });

  it('the English pages never load the Turkish table, nor the Turkish pages the English one', () => {
    for (const file of files.filter((item) => item.name.startsWith('app/(en)/'))) {
      expect(valueImports(file.code, TURKISH), file.name).toEqual([]);
      expect(valueImports(file.code, TURKISH_CLOUD), file.name).toEqual([]);
    }
    for (const file of files.filter((item) => item.name.startsWith('app/(tr)/'))) {
      expect(valueImports(file.code, ENGLISH), file.name).toEqual([]);
      expect(valueImports(file.code, ENGLISH_CLOUD), file.name).toEqual([]);
    }
  });

  it('the cloud route’s words come with the route, in the page’s language', () => {
    const offenders = files
      .filter((file) => !file.name.startsWith('i18n/') && !file.name.startsWith('app/'))
      .filter((file) => valueImports(file.code, TURKISH_CLOUD).length + valueImports(file.code, ENGLISH_CLOUD).length > 0)
      .map((file) => file.name);
    expect(offenders).toEqual([]);
    const yazi = files.find((file) => file.name === 'components/wizard/YaziWizard.tsx')?.code ?? '';
    expect(yazi).toContain("document.documentElement.lang === 'en' ? import('@/i18n/cloudMessages.en') : import('@/i18n/cloudMessages')");
  });
});
