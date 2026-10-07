/**
 * "Yaz, bulalım" (ADR-034): what the user typed → the tasks they most likely
 * mean. Everything happens here, in the page: a word list per task
 * (`tasks.ts`), no model, no network, nothing stored.
 *
 * The rules, in the order they run:
 *
 * 1. Fold: Turkish lower case, diacritics off (ç ğ ı ö ş ü â î û → plain),
 *    everything that is not a letter or digit becomes a space.
 * 2. Tokens: split on spaces; one-letter tokens and stop words ("ve", "için",
 *    "my", "video…") carry no intent and are dropped.
 * 3. Each token is compared with each task's words, best kind first:
 *    exact ("dikey") › stem — the token starts with the word, a Turkish
 *    suffix follows ("sessizlikleri" ← "sessiz") — or prefix — the word
 *    starts with the token, the user is still typing ("sess") › typo — one
 *    edit away for words of 5+ letters ("sesiz", "whatsap", "dikye").
 *    A token counts only for its surest kind (a typo of a long word beats a
 *    three-letter stem) and, inside it, the longest matched word: "sessiz"
 *    means Boşlukları at, not Sesini al ("ses").
 * 4. Strong words score 3 (exact) or 2 (stem, prefix, typo); weak words
 *    ("ekle", "sil") 1 or 0.75 and never by typo.
 * 5. Phrases ("her yerde", "make it vertical") add 4 when their words appear
 *    in order, stop words included — and 1 more for each word beyond the
 *    second: the longer phrase is the more specific one ("arka plan
 *    değiştir" is about the background; "arka plan" alone is how music is
 *    asked for). Only the longest phrase of a task counts.
 * 6. Rank by score. A tie goes to the more specific task ("cut the pauses"
 *    is Boşlukları at, not the generic Kes), then to registry order. Keep at
 *    most three, and only those within 40 % of the best — a stray weak word
 *    does not add a row.
 * 7. When the best match is something the app cannot do yet ("gife çevir",
 *    "tiktok logosunu kaldır"), the answer is "Bunu henüz yapamıyoruz." and
 *    a task that only shares a word with the request ("çevir", "tiktok") is
 *    not offered under it: rows of tasks that work stay only when they score
 *    nearly as much as the best (80 %), i.e. the words point at them just as
 *    much ("döndür ve kes").
 */

import { TASKS, type TaskDefinition } from './tasks';

const FOLD_MAP: Record<string, string> = {
  ç: 'c',
  ğ: 'g',
  ı: 'i',
  ö: 'o',
  ş: 's',
  ü: 'u',
  â: 'a',
  î: 'i',
  û: 'u',
  é: 'e',
};

/** Lower case (Turkish rules), no diacritics, only a–z, 0–9 and single spaces. */
export function foldText(text: string): string {
  return text
    .toLocaleLowerCase('tr')
    // "i̇": what a dotted capital İ leaves behind in some engines.
    .replace(/̇/g, '')
    .replace(/[çğıöşüâîûé]/g, (letter) => FOLD_MAP[letter] ?? letter)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const STOP_WORDS = new Set([
  // Turkish
  've', 'ile', 'icin', 'bir', 'bu', 'su', 'mi', 'mu', 'da', 'de', 'ben', 'benim', 'bana', 'beni', 'biz', 'sen', 'cok',
  'daha', 'en', 'ne', 'nasil', 'neden', 'lutfen', 'istiyorum', 'isterim', 'lazim', 'gerek', 'olsun', 'olacak', 'yap',
  'yapmak', 'yapar', 'yapabilir', 'miyim', 'misin', 'et', 'etmek', 'sey', 'gibi', 'kadar', 'ama', 'ya', 'hem', 'film',
  'filmi', 'dosya', 'dosyam',
  // English
  'the', 'an', 'my', 'to', 'it', 'its', 'make', 'of', 'for', 'in', 'on', 'is', 'me', 'we', 'you', 'how', 'do', 'does',
  'can', 'want', 'need', 'please', 'this', 'that', 'from', 'into', 'with', 'and', 'file', 'movie',
]);

function isStopWord(token: string): boolean {
  // "videom", "videoyu", "videosu", "videos": the thing every task is about.
  return STOP_WORDS.has(token) || token.startsWith('video');
}

/** Every folded word of the query, stop words included (phrases need them). */
function rawTokens(query: string): string[] {
  const folded = foldText(query);
  return folded === '' ? [] : folded.split(' ');
}

/** The words that carry intent: two letters or more, no stop words. */
export function searchTokens(query: string): string[] {
  return rawTokens(query).filter((token) => token.length >= 2 && !isStopWord(token));
}

/**
 * Edit distance where a swap of two neighbours counts as one edit
 * (optimal string alignment); stops caring above `limit`.
 */
export function editDistance(a: string, b: string, limit = 2): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous2: number[] = [];
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min((previous[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, (previous[j - 1] ?? 0) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, (previous2[j - 2] ?? 0) + 1);
      }
      row.push(value);
    }
    previous2 = previous;
    previous = row;
  }
  return previous[b.length] ?? limit + 1;
}

const TYPO_MIN_LENGTH = 5;

/** One edit away from the word, with or without a suffix after it. Same first letter. */
function isTypoOf(token: string, word: string): boolean {
  if (token.length < TYPO_MIN_LENGTH || word.length < TYPO_MIN_LENGTH || token[0] !== word[0]) return false;
  if (editDistance(token, word, 1) <= 1) return true;
  if (token.length <= word.length) return false;
  // "titokta" = "titok" (one letter short of "tiktok") + "ta".
  return [word.length - 1, word.length, word.length + 1].some(
    (length) => length >= TYPO_MIN_LENGTH && length < token.length && editDistance(token.slice(0, length), word, 1) <= 1,
  );
}

type MatchKind = 'exact' | 'part' | 'typo';

/**
 * How sure a match is, best first: exact (4) › stem or prefix over four
 * letters or more (3) › typo of a long word (2) › stem or prefix over three
 * letters or fewer (1). So "sesiz" is a typo of "sessiz", not "ses" + "iz".
 */
type Tier = 1 | 2 | 3 | 4;

interface WordMatch {
  kind: MatchKind;
  tier: Tier;
  /** Letters of the token the word accounts for. */
  matched: number;
  strong: boolean;
}

const STRONG_SCORE: Record<MatchKind, number> = { exact: 3, part: 2, typo: 2 };
const WEAK_SCORE: Record<MatchKind, number> = { exact: 1, part: 0.75, typo: 0 };
const PHRASE_SCORE = 4;
/** Each word of a phrase beyond the second. */
const PHRASE_EXTRA_WORD_SCORE = 1;

function partMatch(matched: number, strong: boolean): WordMatch {
  return { kind: 'part', tier: matched >= 4 ? 3 : 1, matched, strong };
}

function matchWord(token: string, word: string, strong: boolean, typing: boolean): WordMatch | null {
  if (token === word) return { kind: 'exact', tier: 4, matched: token.length, strong };
  // Stem: the word, then a suffix ("kesmek", "sessizlikleri"). Short weak
  // words would catch too much ("son" in "sonra").
  if (word.length >= (strong ? 3 : 4) && token.startsWith(word)) return partMatch(word.length, strong);
  // Prefix: still typing ("sess"). Two letters only for the word being typed.
  if (word.startsWith(token) && (token.length >= 3 || (typing && strong))) return partMatch(token.length, strong);
  if (strong && isTypoOf(token, word)) {
    return { kind: 'typo', tier: 2, matched: Math.min(token.length, word.length), strong };
  }
  return null;
}

function better(a: WordMatch | null, b: WordMatch): WordMatch {
  if (!a) return b;
  if (b.tier !== a.tier) return b.tier > a.tier ? b : a;
  if (b.matched !== a.matched) return b.matched > a.matched ? b : a;
  return b.strong && !a.strong ? b : a;
}

/** The phrase's words appear in order; a query word may carry a suffix ("yerleri" for "yer"). */
function containsPhrase(tokens: readonly string[], phrase: string): boolean {
  const words = phrase.split(' ');
  for (let start = 0; start + words.length <= tokens.length; start += 1) {
    const hit = words.every((word, index) => {
      const token = tokens[start + index] ?? '';
      return token === word || (word.length >= 3 && token.startsWith(word));
    });
    if (hit) return true;
  }
  return false;
}

export interface TaskMatch {
  task: TaskDefinition;
  score: number;
}

export type TaskSearchResult =
  /** Nothing typed that says what to do (empty, one letter, only "video"): the cards stay. */
  | { kind: 'empty' }
  | { kind: 'results'; matches: TaskMatch[] }
  /** Words were typed and no task knows them: "Bunu bulamadım". */
  | { kind: 'none' };

export const MAX_RESULTS = 3;
const KEEP_RATIO = 0.4;
/** Under a best match that cannot be done yet, a task that works needs this share of its score to be shown. */
const KEEP_UNDER_CANNOT_RATIO = 0.8;

export function searchTasks(query: string, tasks: readonly TaskDefinition[] = TASKS): TaskSearchResult {
  const raw = rawTokens(query);
  const tokens = raw.filter((token) => token.length >= 2 && !isStopWord(token));
  // The last word may still be growing — unless the user already typed a space after it.
  const stillTyping = !/\s$/.test(query);
  const scores = new Map<TaskDefinition, number>();
  const add = (task: TaskDefinition, points: number) => scores.set(task, (scores.get(task) ?? 0) + points);

  tokens.forEach((token, index) => {
    const typing = stillTyping && index === tokens.length - 1 && raw[raw.length - 1] === token;
    const perTask: Array<{ task: TaskDefinition; match: WordMatch }> = [];
    for (const task of tasks) {
      let best: WordMatch | null = null;
      for (const word of task.words.strong) {
        const match = matchWord(token, word, true, typing);
        if (match) best = better(best, match);
      }
      for (const word of task.words.weak) {
        const match = matchWord(token, word, false, typing);
        if (match) best = better(best, match);
      }
      if (best) perTask.push({ task, match: best });
    }
    if (perTask.length === 0) return;
    const tier = Math.max(...perTask.map((entry) => entry.match.tier));
    const inTier = perTask.filter((entry) => entry.match.tier === tier);
    const matched = Math.max(...inTier.map((entry) => entry.match.matched));
    for (const { task, match } of inTier) {
      if (match.matched !== matched) continue;
      add(task, (match.strong ? STRONG_SCORE : WEAK_SCORE)[match.kind]);
    }
  });

  for (const task of tasks) {
    const found = task.words.phrases
      .filter((phrase) => containsPhrase(raw, phrase))
      .map((phrase) => phrase.split(' ').length);
    if (found.length > 0) add(task, PHRASE_SCORE + (Math.max(...found) - 2) * PHRASE_EXTRA_WORD_SCORE);
  }

  const ranked = tasks
    .map((task, order) => ({ task, score: scores.get(task) ?? 0, order }))
    .filter((entry) => entry.score > 0)
    // A tie goes to the more specific task: "kes" / "cut" is what people say
    // about any job ("cut the pauses"), so the generic task steps back.
    .sort(
      (a, b) =>
        b.score - a.score || Number(a.task.generic === true) - Number(b.task.generic === true) || a.order - b.order,
    );

  const top = ranked[0];
  if (!top) return tokens.length === 0 ? { kind: 'empty' } : { kind: 'none' };
  const cannotDoYet = !top.task.available;
  const matches = ranked
    .filter((entry) => entry.score >= top.score * KEEP_RATIO)
    .filter((entry) => !cannotDoYet || !entry.task.available || entry.score >= top.score * KEEP_UNDER_CANNOT_RATIO)
    .slice(0, MAX_RESULTS)
    .map(({ task, score }) => ({ task, score }));
  return { kind: 'results', matches };
}
