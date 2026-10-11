import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from '@playwright/test';

import { foldText, searchTasks } from '../../src/domain/taskSearch';
import { DEV, HELD_OUT, type EvalPhrase } from './data/search-eval';
import { FRESH_HELD_OUT } from './data/search-eval-fresh';
import { FRESH_HELD_OUT_2 } from './data/search-eval-fresh2';
import { round, writeResult } from './lib/record';
import { t } from './lib/app';

/**
 * Section 2 — search quality of "Yaz, bulalım", on phrases the word lists
 * were not written against (tests/quality/data/search-eval.ts: read its
 * header before touching anything here).
 *
 * Nothing in the search is changed by this spec and nothing is asserted:
 * the misses are the result.
 *
 * Numbers:
 *  - ilk sonuç (first hit): the first row is the task that was meant;
 *  - ilk üç (top 3): it is among the rows shown;
 *  - yanlış ama emin (wrong-confident): the first row is a card with a
 *    "Başla" button that does something else — the costly kind of miss;
 *  - "Bunu henüz yapamıyoruz.": how often it is said when it should be
 *    (recall) and how often it is right when it is said (precision).
 */

/** Phrases already in the tables the lists were tuned on: not counted here. */
function seenPhrases(): Set<string> {
  const seen = new Set<string>();
  for (const name of ['taskSearch.test.ts', 'taskSearchHeldOut.test.ts', 'taskSearchHeldOut2.test.ts', 'taskSearchHeldOut3.test.ts', 'taskSearchRules.test.ts']) {
    const source = readFileSync(join(process.cwd(), 'tests', 'unit', name), 'utf8');
    for (const match of source.matchAll(/\[\s*(['"`])((?:\\.|(?!\1).)+)\1\s*,/g)) seen.add(foldText(match[2] ?? ''));
    // The rules table quotes its phrases one per line or as arguments, not as pairs.
    if (name === 'taskSearchRules.test.ts') {
      for (const match of source.matchAll(/(['"`])((?:\\.|(?!\1).)+)\1/g)) seen.add(foldText(match[2] ?? ''));
    }
  }
  return seen;
}

const folded = (phrases: readonly EvalPhrase[]): string[] => phrases.map((phrase) => foldText(phrase.text));

type Answer =
  | { kind: 'card'; first: string; shown: string[] }
  | { kind: 'cannot'; first: string; shown: string[] }
  | { kind: 'none' }
  | { kind: 'empty' };

function ask(text: string): Answer {
  const result = searchTasks(text);
  if (result.kind !== 'results') return { kind: result.kind };
  const first = result.matches[0];
  if (!first) return { kind: 'none' };
  // What the screen shows as rows a user can start: only tasks that work.
  const shown = result.matches.filter((match) => match.task.available).map((match) => match.task.id);
  return { kind: first.task.available ? 'card' : 'cannot', first: first.task.id, shown };
}

const label = (id: string): string => t(`task.${id}.label` as Parameters<typeof t>[0]);

function said(answer: Answer): string {
  if (answer.kind === 'card') return `${label(answer.first)}${answer.shown.length > 1 ? ` (+ ${answer.shown.slice(1).map(label).join(', ')})` : ''}`;
  if (answer.kind === 'cannot') return `${t('home.results.unavailable')} [${label(answer.first)}]${answer.shown.length > 0 ? ` (+ ${answer.shown.map(label).join(', ')})` : ''}`;
  if (answer.kind === 'none') return t('home.results.none.title');
  return '(kartlar kalır: yazılanda iş söyleyen bir kelime yok)';
}

function evaluate(phrases: readonly EvalPhrase[], seen: Set<string>) {
  const rows = phrases.map((phrase) => {
    const answer = ask(phrase.text);
    const wanted = typeof phrase.expect === 'string' ? [phrase.expect] : [...phrase.expect];
    const category = wanted[0] === 'cannot' || wanted[0] === 'outside' || wanted[0] === 'nothing' ? (wanted[0] as 'cannot' | 'outside' | 'nothing') : 'task';
    const firstHit = category === 'task' && answer.kind === 'card' && wanted.includes(answer.first);
    const top3 = category === 'task' && (answer.kind === 'card' || answer.kind === 'cannot') && answer.shown.some((id) => wanted.includes(id));
    // A card with a button that is not what was meant.
    const wrongConfident = answer.kind === 'card' && !(category === 'task' && wanted.includes(answer.first));
    const correct =
      category === 'task'
        ? firstHit
        : category === 'cannot'
          ? answer.kind === 'cannot'
          : category === 'outside'
            ? answer.kind === 'cannot' || answer.kind === 'none'
            : answer.kind === 'none' || answer.kind === 'empty';
    return {
      text: phrase.text,
      tags: phrase.tags,
      category,
      expected: category === 'task' ? wanted.map(label).join(' / ') : category,
      expectedIds: wanted,
      got: said(answer),
      gotKind: answer.kind,
      firstHit,
      top3,
      wrongConfident,
      correct,
      seenBefore: seen.has(foldText(phrase.text)),
    };
  });
  const fresh = rows.filter((row) => !row.seenBefore);
  const share = (part: number, whole: number) => (whole === 0 ? null : round((part / whole) * 100, 1));
  const tasks = fresh.filter((row) => row.category === 'task');
  const cannot = fresh.filter((row) => row.category === 'cannot');
  const outside = fresh.filter((row) => row.category === 'outside');
  const nothing = fresh.filter((row) => row.category === 'nothing');
  const saidCannot = fresh.filter((row) => row.gotKind === 'cannot');
  const byTask: Record<string, { n: number; firstHit: number; top3: number; wrongConfident: number; none: number }> = {};
  for (const row of tasks) {
    const key = row.expectedIds[0] ?? '?';
    const entry = (byTask[key] ??= { n: 0, firstHit: 0, top3: 0, wrongConfident: 0, none: 0 });
    entry.n += 1;
    if (row.firstHit) entry.firstHit += 1;
    if (row.top3) entry.top3 += 1;
    if (row.wrongConfident) entry.wrongConfident += 1;
    if (row.gotKind === 'none' || row.gotKind === 'empty') entry.none += 1;
  }
  const byTag: Record<string, { n: number; firstHit: number }> = {};
  for (const row of tasks) {
    for (const tag of row.tags.split(' ')) {
      const entry = (byTag[tag] ??= { n: 0, firstHit: 0 });
      entry.n += 1;
      if (row.firstHit) entry.firstHit += 1;
    }
  }
  return {
    phrases: rows.length,
    seenBefore: rows.length - fresh.length,
    counted: fresh.length,
    taskPhrases: tasks.length,
    firstHitPercent: share(tasks.filter((row) => row.firstHit).length, tasks.length),
    top3Percent: share(tasks.filter((row) => row.top3).length, tasks.length),
    /** A doable request answered "Bunu bulamadım" or not at all: a miss, but nobody is sent to the wrong task. */
    taskNotFoundPercent: share(tasks.filter((row) => row.gotKind === 'none' || row.gotKind === 'empty').length, tasks.length),
    /** A doable request answered "Bunu henüz yapamıyoruz.": the app denies something it can do. */
    taskDeniedPercent: share(tasks.filter((row) => row.gotKind === 'cannot').length, tasks.length),
    wrongConfidentPercent: share(fresh.filter((row) => row.wrongConfident).length, fresh.length),
    wrongConfidentOnTasksPercent: share(tasks.filter((row) => row.wrongConfident).length, tasks.length),
    cannot: {
      phrases: cannot.length,
      recallPercent: share(cannot.filter((row) => row.gotKind === 'cannot').length, cannot.length),
      precisionPercent: share(saidCannot.filter((row) => row.category === 'cannot' || row.category === 'outside').length, saidCannot.length),
      said: saidCannot.length,
      offeredWrongCard: cannot.filter((row) => row.wrongConfident).length,
    },
    outside: {
      phrases: outside.length,
      honestPercent: share(outside.filter((row) => row.correct).length, outside.length),
      offeredWrongCard: outside.filter((row) => row.wrongConfident).length,
    },
    nothing: {
      phrases: nothing.length,
      quietPercent: share(nothing.filter((row) => row.correct).length, nothing.length),
      offeredCard: nothing.filter((row) => row.wrongConfident).length,
    },
    byTask: Object.fromEntries(
      Object.entries(byTask).map(([id, entry]) => [id, { label: label(id), ...entry, firstHitPercent: share(entry.firstHit, entry.n) }]),
    ),
    byTag: Object.fromEntries(Object.entries(byTag).map(([tag, entry]) => [tag, { ...entry, firstHitPercent: share(entry.firstHit, entry.n) }])),
    misses: fresh
      .filter((row) => !row.correct)
      .map(({ text, tags, category, expected, got, wrongConfident, top3 }) => ({ text, tags, category, expected, got, wrongConfident, top3 })),
    skipped: rows.filter((row) => row.seenBefore).map((row) => row.text),
  };
}

/**
 * Four sets since 10 Oct 2026 (the header of data/search-eval.ts has the rule):
 *  - `fresh`: data/search-eval-fresh2.ts, written by a writer who saw neither the search nor any other
 *    phrase, and measured ONCE, after the search's last change. The headline, and what the budgets judge.
 *  - `firstFresh`: data/search-eval-fresh.ts, the first such batch. It was measured once (commit 9dae184
 *    has those numbers); then its misses were read and the search was changed for them, so it is a
 *    TUNING set now and its numbers here are not an estimate.
 *  - `heldOut`: the original held-out set. CONTAMINATED: its misses were read before the search was
 *    reworked (the rework was asked for because of them).
 *  - `dev`: tuned on. Not a measurement.
 * A phrase that is in a tuned table, in DEV, in the old held-out set or in the first fresh batch is left
 * out of the fresh count.
 */
test('search: held-out and dev phrases', async ({}, testInfo) => {
  const seen = seenPhrases();
  const tuned = new Set([...seen, ...folded(DEV)]);
  writeResult('search', testInfo.project.name, {
    tunedTablePhrases: seen.size,
    fresh: evaluate(FRESH_HELD_OUT_2, new Set([...tuned, ...folded(HELD_OUT), ...folded(FRESH_HELD_OUT)])),
    firstFresh: evaluate(FRESH_HELD_OUT, new Set([...tuned, ...folded(HELD_OUT)])),
    heldOut: evaluate(HELD_OUT, tuned),
    dev: evaluate(DEV, seen),
  });
});
