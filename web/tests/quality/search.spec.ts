import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from '@playwright/test';

import { foldText } from '../../src/domain/taskSearch';
import { DEV, HELD_OUT, type EvalPhrase } from './data/search-eval';
import { FRESH_HELD_OUT } from './data/search-eval-fresh';
import { FRESH_HELD_OUT_2 } from './data/search-eval-fresh2';
import { FRESH_HELD_OUT_3 } from './data/search-eval-fresh3';
import { EN_DEV } from './data/search-eval-en-dev';
import { EN_FRESH } from './data/search-eval-en-fresh';
import { en } from '../../src/i18n/messages.en';
import { writeResult } from './lib/record';
import { evaluate, type EvalTexts } from './lib/searchEval';
import { t } from './lib/app';

/**
 * Section 2 — search quality of "Yaz, bulalım", on phrases the word lists
 * were not written against (tests/quality/data/search-eval.ts: read its
 * header before touching anything here).
 *
 * Nothing in the search is changed by this spec and nothing is asserted:
 * the misses are the result.
 *
 * Numbers (lib/searchEval.ts has the arithmetic and the definitions):
 *  - doğrudan doğru (direct): one task is presented as the answer and it is
 *    the one that was meant;
 *  - ilk satır (first row): the first row is that task, as the answer or as
 *    the first of the choices — the "ilk sonuç" of the reports before 11 Oct;
 *  - ilk üç (top 3): it is among the rows shown;
 *  - yanlış ama emin (wrong-confident): ONE task is presented as the answer —
 *    highlighted, started by Enter — and it does something else;
 *  - sordu (asked): "Bunu mu demek istedin?" with choices, nothing started;
 *    how often the task that was meant is among them; and how often a clearly
 *    phrased request was asked about instead of answered;
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

const EN_TEXTS: EvalTexts = {
  label: (id) => en[`task.${id}.label` as keyof typeof en] ?? id,
  unavailable: en['home.results.unavailable'],
  none: en['home.results.none.title'],
  askTitle: en['home.results.title'],
};

const TEXTS: EvalTexts = {
  label: (id) => t(`task.${id}.label` as Parameters<typeof t>[0]),
  unavailable: t('home.results.unavailable'),
  none: t('home.results.none.title'),
  askTitle: t('home.results.title'),
};

/**
 * Five sets since 11 Oct 2026 (the header of data/search-eval.ts has the rule):
 *  - `fresh`: data/search-eval-fresh3.ts, written by a writer who was given only the list of tasks and
 *    their descriptions, and measured ONCE, after the confidence rule was frozen (commit fd6ce81). The
 *    headline, and what the budgets judge.
 *  - `secondFresh`: data/search-eval-fresh2.ts, the headline of 10–11 Oct. Its misses were printed in the
 *    report, and the confidence rule was tuned with it: a TUNING set now.
 *  - `firstFresh`: data/search-eval-fresh.ts, the first such batch; a tuning set since 10 Oct.
 *  - `heldOut`: the original held-out set. CONTAMINATED since 10 Oct.
 *  - `dev`: tuned on. Not a measurement — but it is where "a clearly phrased request must not be asked
 *    about" is watched, next to the fresh set's phrases tagged `kolay`.
 * A phrase that is in a tuned table or in any older set is left out of a newer set's count.
 */
test('search: held-out and dev phrases', async ({}, testInfo) => {
  const seen = seenPhrases();
  const tuned = new Set([...seen, ...folded(DEV)]);
  const beforeSecond = new Set([...tuned, ...folded(HELD_OUT), ...folded(FRESH_HELD_OUT)]);
  // ADR-048: the English sets. Everything above has been seen by the lists; the English DEV set was tuned on.
  const beforeEnglish = new Set([...beforeSecond, ...folded(FRESH_HELD_OUT_2), ...folded(FRESH_HELD_OUT_3)]);
  writeResult('search', testInfo.project.name, {
    enFreshFile: 'search-eval-en-fresh.ts',
    enFresh: evaluate(EN_FRESH, new Set([...beforeEnglish, ...folded(EN_DEV)]), EN_TEXTS),
    enDev: evaluate(EN_DEV, beforeEnglish, EN_TEXTS),
    tunedTablePhrases: seen.size,
    freshFile: 'search-eval-fresh3.ts',
    fresh: evaluate(FRESH_HELD_OUT_3, new Set([...beforeSecond, ...folded(FRESH_HELD_OUT_2)]), TEXTS),
    secondFresh: evaluate(FRESH_HELD_OUT_2, beforeSecond, TEXTS),
    firstFresh: evaluate(FRESH_HELD_OUT, new Set([...tuned, ...folded(HELD_OUT)]), TEXTS),
    heldOut: evaluate(HELD_OUT, tuned, TEXTS),
    dev: evaluate(DEV, seen, TEXTS),
  });
});
