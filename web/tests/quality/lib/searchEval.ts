/**
 * The arithmetic of section 2 (search quality): what the search answered for
 * a phrase, as the screen presents it, and the shares over a set. Pure — no
 * browser, no files — so the same numbers can be produced while tuning (on
 * the sets that may be tuned on) and by the quality run.
 *
 * Since 11 Oct 2026 the search has two ways of showing tasks (ADR-034,
 * "Güncelleme — 11 Ekim 2026"):
 *
 *  - `card`: one task is presented as THE answer — its row is highlighted and
 *    Enter starts it (other rows may follow it);
 *  - `ask`: "Bunu mu demek istedin?" — a short list of choices, none
 *    highlighted, nothing starts until the user picks one.
 *
 * "Yanlış ama emin" (wrong-confident) therefore means: a `card`, and it is not
 * the task that was meant. A wrong task among the choices of an `ask` is not
 * counted there — the user was asked, not sent. That would make "always ask"
 * a cheap win, so three more numbers stand next to it: how often the search
 * asked, how often the task that was meant is among the choices when it asks,
 * and how often a CLEARLY phrased request was asked about instead of answered.
 */

import { searchTasks } from '../../../src/domain/taskSearch';
import { foldText } from '../../../src/domain/taskSearch';

export type Expectation = string | readonly string[];

export interface EvalPhraseLike {
  text: string;
  expect: Expectation;
  tags: string;
}

export type Answer =
  /** One task presented as the answer. `shown`: every row with a "Başla" button, in order. */
  | { kind: 'card'; first: string; shown: string[] }
  /** A list of choices; `shown` as above, `cannotRows`: rows that say "Bunu henüz yapamıyoruz." among them. */
  | { kind: 'ask'; first: string; shown: string[]; cannotRows: number }
  | { kind: 'cannot'; first: string; shown: string[] }
  | { kind: 'none' }
  | { kind: 'empty' };

export function ask(text: string): Answer {
  const result = searchTasks(text);
  if (result.kind !== 'results') return { kind: result.kind };
  const first = result.matches[0];
  if (!first) return { kind: 'none' };
  // What the screen shows as rows a user can start: only tasks that work.
  const shown = result.matches.filter((match) => match.task.available).map((match) => match.task.id);
  if (!first.task.available) return { kind: 'cannot', first: first.task.id, shown };
  if (result.confidence === 'ask') return { kind: 'ask', first: first.task.id, shown, cannotRows: result.matches.length - shown.length };
  return { kind: 'card', first: first.task.id, shown };
}

export interface EvalTexts {
  label: (id: string) => string;
  unavailable: string;
  none: string;
  askTitle: string;
}

function said(answer: Answer, texts: EvalTexts): string {
  const { label } = texts;
  if (answer.kind === 'card') return `${label(answer.first)}${answer.shown.length > 1 ? ` (+ ${answer.shown.slice(1).map(label).join(', ')})` : ''}`;
  if (answer.kind === 'ask') return `${texts.askTitle} ${answer.shown.map(label).join(' / ')}${answer.cannotRows > 0 ? ' (+ yapılamayan satır)' : ''}`;
  if (answer.kind === 'cannot') return `${texts.unavailable} [${label(answer.first)}]${answer.shown.length > 0 ? ` (+ ${answer.shown.map(label).join(', ')})` : ''}`;
  if (answer.kind === 'none') return texts.none;
  return '(kartlar kalır: yazılanda iş söyleyen bir kelime yok)';
}

const share = (part: number, whole: number): number | null => (whole === 0 ? null : Math.round((part / whole) * 1000) / 10);

export function evaluate(phrases: readonly EvalPhraseLike[], seen: Set<string>, texts: EvalTexts) {
  const { label } = texts;
  const rows = phrases.map((phrase) => {
    const answer = ask(phrase.text);
    const wanted = typeof phrase.expect === 'string' ? [phrase.expect] : [...phrase.expect];
    const category = wanted[0] === 'cannot' || wanted[0] === 'outside' || wanted[0] === 'nothing' ? (wanted[0] as 'cannot' | 'outside' | 'nothing') : 'task';
    const isTask = category === 'task';
    /** Answered directly and rightly: the one task presented as the answer is the one that was meant. */
    const firstHit = isTask && answer.kind === 'card' && wanted.includes(answer.first);
    /** The first row is the task that was meant, however it is presented (the number reported before 11 Oct 2026). */
    const firstRow = isTask && (answer.kind === 'card' || answer.kind === 'ask') && wanted.includes(answer.first);
    const top3 = isTask && (answer.kind === 'card' || answer.kind === 'ask' || answer.kind === 'cannot') && answer.shown.some((id) => wanted.includes(id));
    const asked = answer.kind === 'ask';
    const askedWithRight = asked && isTask && answer.shown.some((id) => wanted.includes(id));
    // One card presented as the answer, with a button, and it is not what was meant.
    const wrongConfident = answer.kind === 'card' && !(isTask && wanted.includes(answer.first));
    const correct = isTask
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
      expected: isTask ? wanted.map(label).join(' / ') : category,
      expectedIds: wanted,
      got: said(answer, texts),
      gotKind: answer.kind,
      choices: asked ? answer.shown.length + answer.cannotRows : 0,
      firstHit,
      firstRow,
      top3,
      asked,
      askedWithRight,
      wrongConfident,
      correct,
      seenBefore: seen.has(foldText(phrase.text)),
    };
  });
  const fresh = rows.filter((row) => !row.seenBefore);
  const tasks = fresh.filter((row) => row.category === 'task');
  const cannot = fresh.filter((row) => row.category === 'cannot');
  const outside = fresh.filter((row) => row.category === 'outside');
  const nothing = fresh.filter((row) => row.category === 'nothing');
  const saidCannot = fresh.filter((row) => row.gotKind === 'cannot');
  const askedRows = fresh.filter((row) => row.asked);
  const askedTasks = tasks.filter((row) => row.asked);
  /** Clearly phrased requests: the ones their writer marked "kolay" (short, plain, names the job). */
  const clear = tasks.filter((row) => row.tags.split(' ').includes('kolay'));
  const byTask: Record<string, { n: number; firstHit: number; asked: number; askedWithRight: number; top3: number; wrongConfident: number; none: number }> = {};
  for (const row of tasks) {
    const key = row.expectedIds[0] ?? '?';
    const entry = (byTask[key] ??= { n: 0, firstHit: 0, asked: 0, askedWithRight: 0, top3: 0, wrongConfident: 0, none: 0 });
    entry.n += 1;
    if (row.firstHit) entry.firstHit += 1;
    if (row.asked) entry.asked += 1;
    if (row.askedWithRight) entry.askedWithRight += 1;
    if (row.top3) entry.top3 += 1;
    if (row.wrongConfident) entry.wrongConfident += 1;
    if (row.gotKind === 'none' || row.gotKind === 'empty') entry.none += 1;
  }
  const byTag: Record<string, { n: number; firstHit: number; asked: number; askedWithRight: number; wrongConfident: number }> = {};
  for (const row of tasks) {
    for (const tag of row.tags.split(' ')) {
      const entry = (byTag[tag] ??= { n: 0, firstHit: 0, asked: 0, askedWithRight: 0, wrongConfident: 0 });
      entry.n += 1;
      if (row.firstHit) entry.firstHit += 1;
      if (row.asked) entry.asked += 1;
      if (row.askedWithRight) entry.askedWithRight += 1;
      if (row.wrongConfident) entry.wrongConfident += 1;
    }
  }
  return {
    phrases: rows.length,
    seenBefore: rows.length - fresh.length,
    counted: fresh.length,
    taskPhrases: tasks.length,
    /** Answered directly with the right task. */
    firstHitPercent: share(tasks.filter((row) => row.firstHit).length, tasks.length),
    /** The first row is the right task, as an answer or as the first choice (comparable with the reports before 11 Oct 2026). */
    firstRowPercent: share(tasks.filter((row) => row.firstRow).length, tasks.length),
    /** The user gets to the right task without retyping: answered directly, or it is among the choices offered. */
    reachedPercent: share(tasks.filter((row) => row.firstHit || row.askedWithRight).length, tasks.length),
    top3Percent: share(tasks.filter((row) => row.top3).length, tasks.length),
    /** A doable request answered "Bunu bulamadım" or not at all: a miss, but nobody is sent to the wrong task. */
    taskNotFoundPercent: share(tasks.filter((row) => row.gotKind === 'none' || row.gotKind === 'empty').length, tasks.length),
    /** A doable request answered "Bunu henüz yapamıyoruz.": the app denies something it can do. */
    taskDeniedPercent: share(tasks.filter((row) => row.gotKind === 'cannot').length, tasks.length),
    wrongConfidentPercent: share(fresh.filter((row) => row.wrongConfident).length, fresh.length),
    wrongConfidentOnTasksPercent: share(tasks.filter((row) => row.wrongConfident).length, tasks.length),
    asked: {
      /** Asked instead of guessed, over every phrase and over the doable ones. */
      percent: share(askedRows.length, fresh.length),
      onTasksPercent: share(askedTasks.length, tasks.length),
      count: askedRows.length,
      /** When it asked about a doable request: the task that was meant is among the choices. */
      rightPresentPercent: share(askedTasks.filter((row) => row.askedWithRight).length, askedTasks.length),
      onTasks: askedTasks.length,
      /** …and none of the choices is it: the user has to retype or open the cards. */
      rightAbsent: askedTasks.filter((row) => !row.askedWithRight).length,
      /** A "list" of one: the single candidate shown as a question, not started by Enter. */
      singleChoice: askedRows.filter((row) => row.choices === 1).length,
      /** Asked about something that is not a doable task at all (cannot / outside / nothing). */
      onOthers: askedRows.length - askedTasks.length,
    },
    clear: {
      phrases: clear.length,
      /** A clearly phrased request that got a list of choices instead of its task. */
      askedPercent: share(clear.filter((row) => row.asked).length, clear.length),
      directPercent: share(clear.filter((row) => row.firstHit).length, clear.length),
    },
    cannot: {
      phrases: cannot.length,
      recallPercent: share(cannot.filter((row) => row.gotKind === 'cannot').length, cannot.length),
      precisionPercent: share(saidCannot.filter((row) => row.category === 'cannot' || row.category === 'outside').length, saidCannot.length),
      said: saidCannot.length,
      offeredWrongCard: cannot.filter((row) => row.wrongConfident).length,
      asked: cannot.filter((row) => row.asked).length,
    },
    outside: {
      phrases: outside.length,
      honestPercent: share(outside.filter((row) => row.correct).length, outside.length),
      offeredWrongCard: outside.filter((row) => row.wrongConfident).length,
      asked: outside.filter((row) => row.asked).length,
    },
    nothing: {
      phrases: nothing.length,
      quietPercent: share(nothing.filter((row) => row.correct).length, nothing.length),
      offeredCard: nothing.filter((row) => row.wrongConfident).length,
      asked: nothing.filter((row) => row.asked).length,
    },
    byTask: Object.fromEntries(
      Object.entries(byTask).map(([id, entry]) => [id, { label: label(id), ...entry, firstHitPercent: share(entry.firstHit, entry.n) }]),
    ),
    byTag: Object.fromEntries(Object.entries(byTag).map(([tag, entry]) => [tag, { ...entry, firstHitPercent: share(entry.firstHit, entry.n) }])),
    misses: fresh
      .filter((row) => !row.correct)
      .map(({ text, tags, category, expected, got, wrongConfident, top3, asked, askedWithRight }) => ({ text, tags, category, expected, got, wrongConfident, top3, asked, askedWithRight })),
    skipped: rows.filter((row) => row.seenBefore).map((row) => row.text),
  };
}

export type SetEvaluation = ReturnType<typeof evaluate>;
