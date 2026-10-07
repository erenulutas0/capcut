import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

import { formatDecimal, formatDurationShort } from '@/domain/time';
import { en, tr } from '@/i18n/messages';

/**
 * ADR-030: Turkish reads numbers with a decimal comma ("0,9 sn"), English
 * with a dot. The silence dialog wrote "0.9 sn" for weeks because a bare
 * `toFixed()` reached the screen; these tests keep that from coming back:
 *
 * 1. the formatters themselves;
 * 2. no source file outside the formatters calls `toFixed` / `toPrecision`
 *    or a locale-less `toLocaleString` — so a new number on the screen has
 *    to go through a formatter that takes the decimal mark;
 * 3. no Turkish message has a dotted decimal written into it.
 *
 * (The e2e side: silence.spec.ts reads the dialog's own text.)
 */

const TR_WORDS = { minute: tr['time.minuteShort'], second: tr['time.secondShort'], decimalMark: tr['time.decimalMark'] };
const EN_WORDS = { minute: en['time.minuteShort'], second: en['time.secondShort'], decimalMark: en['time.decimalMark'] };

describe('formatDecimal', () => {
  it('writes the reader’s decimal mark', () => {
    expect(tr['time.decimalMark']).toBe(',');
    expect(en['time.decimalMark']).toBe('.');
    expect(formatDecimal(0.9, 1, ',')).toBe('0,9');
    expect(formatDecimal(0.9, 1, '.')).toBe('0.9');
    expect(formatDecimal(290, 1, ',')).toBe('290,0');
    expect(formatDecimal(12.345, 2, ',')).toBe('12,35');
    expect(formatDecimal(7, 0, ',')).toBe('7');
  });

  it('trimZeros drops a fraction that says nothing', () => {
    expect(formatDecimal(2, 1, ',', { trimZeros: true })).toBe('2');
    expect(formatDecimal(2.4, 1, ',', { trimZeros: true })).toBe('2,4');
    expect(formatDecimal(10, 0, ',', { trimZeros: true })).toBe('10');
    expect(formatDecimal(1.04, 1, ',', { trimZeros: true })).toBe('1');
  });

  it('never writes "-0" and says "—" for what is not a number', () => {
    expect(formatDecimal(-0.04, 1, ',')).toBe('0,0');
    expect(formatDecimal(-0.4, 1, ',')).toBe('-0,4');
    expect(formatDecimal(Number.NaN, 1, ',')).toBe('—');
    expect(formatDecimal(Number.POSITIVE_INFINITY, 1, ',')).toBe('—');
  });
});

describe('formatDurationShort (silence dialog)', () => {
  it('Turkish: comma, "sn" and "dk"', () => {
    expect(formatDurationShort(900_000, TR_WORDS)).toBe('0,9 sn');
    expect(formatDurationShort(4_000_000, TR_WORDS)).toBe('4,0 sn');
    expect(formatDurationShort(66_000_000, TR_WORDS)).toBe('1:06 dk');
  });

  it('English: dot, "s" and "min"', () => {
    expect(formatDurationShort(900_000, EN_WORDS)).toBe('0.9 s');
    expect(formatDurationShort(66_000_000, EN_WORDS)).toBe('1:06 min');
  });

  it('the minute boundary never reads "60,0 sn" or "0:60"', () => {
    expect(formatDurationShort(59_940_000, TR_WORDS)).toBe('59,9 sn');
    expect(formatDurationShort(59_960_000, TR_WORDS)).toBe('1:00 dk');
    expect(formatDurationShort(119_600_000, TR_WORDS)).toBe('2:00 dk');
    expect(formatDurationShort(-5, TR_WORDS)).toBe('0,0 sn');
  });
});

// ------------------------------------------------------------ source scan

const SRC = join(process.cwd(), 'src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

/** Comments may name the functions; code may not call them. */
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

/**
 * The only places that turn a number into decimal text. Each takes the
 * decimal mark from its caller.
 */
const FORMATTERS = new Set(['domain/time.ts', 'domain/policy.ts']);

describe('no number reaches the screen around the formatters', () => {
  const files = sourceFiles(SRC).map((path) => ({
    name: relative(SRC, path).split(sep).join('/'),
    code: codeOnly(readFileSync(path, 'utf8')),
  }));

  it('the scan sees the source tree', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((file) => file.name === 'components/editor/SilenceDialog.tsx')).toBe(true);
  });

  it('toFixed / toPrecision live only in the formatters (domain/time.ts, domain/policy.ts)', () => {
    const offenders = files
      .filter((file) => !FORMATTERS.has(file.name))
      .filter((file) => /\.to(Fixed|Precision|Exponential)\s*\(/.test(file.code))
      .map((file) => file.name);
    expect(offenders, 'use formatDecimal(value, decimals, t("time.decimalMark")) instead').toEqual([]);
  });

  it('toLocaleString / Intl.NumberFormat are never left to the browser’s own language', () => {
    const offenders = files
      .filter((file) => /\.toLocale(String|DateString|TimeString)\s*\(\s*\)|new Intl\.(NumberFormat|DateTimeFormat)\s*\(\s*\)/.test(file.code))
      .map((file) => file.name);
    expect(offenders).toEqual([]);
  });

  it('the formatters themselves take the mark: no literal comma or dot is glued to a number there', () => {
    for (const name of FORMATTERS) {
      const code = files.find((file) => file.name === name)?.code ?? '';
      // Every toFixed result is passed through a replace('.', decimalMark).
      const calls = code.match(/\.toFixed\s*\(/g)?.length ?? 0;
      expect(calls, name).toBeGreaterThan(0);
      expect(code.match(/replace\('\.', decimalMark\)/g)?.length ?? 0, name).toBeGreaterThanOrEqual(calls);
    }
  });
});

describe('messages', () => {
  /** "00:15.000" is a clock position (fine-tuning keeps milliseconds, ADR-030), not a decimal number. */
  const withoutClocks = (text: string) => text.replace(/\d{1,2}:\d{2}(:\d{2})?\.\d{3}/g, '');

  it('no Turkish message carries a dotted decimal', () => {
    const offenders = Object.entries(tr)
      .filter(([, text]) => /\d\.\d/.test(withoutClocks(text)))
      .map(([key, text]) => `${key}: ${text}`);
    expect(offenders).toEqual([]);
  });

  it('no English message carries a decimal comma', () => {
    const offenders = Object.entries(en)
      // "1,000" style thousands would be a different rule; none exist today either.
      .filter(([, text]) => /\d,\d/.test(text))
      .map(([key, text]) => `${key}: ${text}`);
    expect(offenders).toEqual([]);
  });
});
