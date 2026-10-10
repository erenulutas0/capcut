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
 *    "çünkü", "my", "video…") carry no intent and are dropped.
 * 3. Each token is compared with each task's words, best kind first:
 *    exact ("dikey") › a form — the word with a real Turkish ending
 *    ("sesini" ← "ses", "kesebilir" ← "kes", "müziği" ← "müzik";
 *    `turkishSuffix.ts`) — or, for the word still being typed, a prefix
 *    ("sess") › typo — one edit away for words of 5+ letters ("sesiz",
 *    "whatsap", "dikye").
 *    A token counts only for its surest kind (a typo of a long word beats a
 *    three-letter stem) and, inside it, the longest matched word: "sessiz"
 *    means Boşlukları at, not Sesini al ("ses").
 *    "Starts with the word" is NOT enough (10 Oct 2026): "kesinlikle" is not
 *    "kes", "dikkat" is not "dik", "netflix" is not "net". And only the last
 *    word can be half typed: in the middle of a sentence a word is whole.
 * 4. Strong words score 3 (exact) or 2 (form, prefix, typo); weak words
 *    ("ekle", "sil") 1 or 0.75 and never by typo.
 * 5. Verbs that cannot: a task may list verbs whose NEGATIVE form means it —
 *    "açamıyorum", "açılmıyor" (cannot open → Her yerde açılsın),
 *    "gönderemiyorum", "atamadım" (cannot send → Küçült). Scores like an
 *    exact strong word. The ending decides, so every person and tense is
 *    covered without listing them.
 * 6. Phrases ("her yerde", "make it vertical") add 4 when their words appear
 *    in order, stop words included — and 1 more for each word beyond the
 *    second: the longer phrase is the more specific one. Only the longest
 *    phrase of a task counts.
 * 7. Pairs — what is done TO what: a task may say "one of these things next
 *    to one of these verbs" ("ses" + "olmasın / kapa / istemiyorum" is Sesi
 *    kapat; "ses / müzik" + "al / kaydet / indir" is Sesini al; "müzik" +
 *    "ekle / koy / çalsın" is Müzik ekle). Either order, with their endings,
 *    next to each other once the words that carry no intent are set aside
 *    ("ses hiç olmasın"). Scores like a two-word phrase; phrase and pair do
 *    not add up.
 * 8. Yielding words: "çevir", "dönüştür", "convert" say that something is to
 *    be turned into something else, not into what. Alone they are Her yerde
 *    açılsın; next to another task's own evidence ("mp3e çevir", "gife
 *    çevir", "Türkçeye çevir", "sağa çevir") they step back to a weak word.
 * 9. Rank by score. A tie goes to the more specific task ("cut the pauses"
 *    is Boşlukları at, not the generic Kes), then to registry order. Keep at
 *    most three, and only those within 40 % of the best — a stray weak word
 *    does not add a row.
 * 10. A floor: in a request of three words or more, a best match that rests
 *    on ONE supporting (weak) word and explains nothing else is not an
 *    answer; the user gets "Bunu bulamadım" rather than a card on a guess
 *    ("şu videoyu bilgisayara aktarıp telefona yollamak" is not Dikey yap
 *    because it says "telefon").
 * 11. When the best match is something the app cannot do yet ("gife çevir",
 *    "youtubedan video indir"), the answer is "Bunu henüz yapamıyoruz." and
 *    a task that only shares a word with the request is not offered under
 *    it: rows of tasks that work stay only when they score nearly as much as
 *    the best (80 %), i.e. the words point at them just as much.
 */

import { TASKS, type TaskDefinition } from './tasks';
import { isFormOf, isNegativeFormOf, isTurkishEnding } from './turkishSuffix';

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

/**
 * Words that say nothing about WHAT is wanted: pronouns, conjunctions,
 * politeness, "I want", adverbs of degree and time, the thing every task is
 * about. Closed classes — not a list of things people ask for.
 */
const STOP_WORDS = new Set([
  // Turkish
  've', 'ile', 'icin', 'bir', 'bu', 'su', 'mi', 'mu', 'da', 'de', 'ben', 'benim', 'bana', 'beni', 'biz', 'sen', 'cok',
  'daha', 'en', 'ne', 'nasil', 'neden', 'lutfen', 'istiyorum', 'isterim', 'lazim', 'gerek', 'olsun', 'olacak', 'yap',
  'yapmak', 'yapar', 'yapabilir', 'miyim', 'misin', 'et', 'etmek', 'sey', 'gibi', 'kadar', 'ama', 'ya', 'hem', 'film',
  'filmi', 'dosya', 'dosyam',
  // 10 Oct 2026: what long sentences and chat style are made of.
  'cunku', 'diye', 'sonra', 'once', 'simdi', 'artik', 'hic', 'hicbir', 'tamamen', 'bile', 'biraz', 'birazcik', 'onu',
  'onlari', 'bunu', 'bunlari', 'sunu', 'ona', 'buna', 'burada', 'orada', 'var', 'degil', 'olarak', 'olan', 'oldu', 'gore',
  'olmus', 'olur', 'oluyor', 'diyor', 'dedi', 'zaman', 'hep', 'yine', 'tekrar', 'acaba', 'galiba', 'yani', 'iste',
  'hani', 'yha', 'ya', 'abi', 'kanka', 'bi', 'nasi', 'nasil', 'niye', 'mi', 'mu', 'musun', 'muyum', 'misiniz', 'yapsam',
  'yapayim', 'yapabilirim', 'yapicam', 'yapacagim', 'yapmam', 'yapilir', 'ederim', 'edebilir', 'istiyom', 'isticem',
  'istiyoruz', 'lazimdi', 'gerekiyor', 'gerekli', 'sadece', 'yalnizca', 'baya', 'bayagi', 'gayet', 'falan', 'filan',
  'tane', 'kendi', 'kendim', 'bence', 'aslinda', 'mesela', 'merhaba', 'selam', 'tesekkurler', 'tesekkur', 'sagol',
  'yaparim', 'yapilir', 'yapiyorum', 'yapcam', 'napcam', 'napicam', 'nolur', 'lzm', 'pls', 'plz', 'acil', 'hemen',
  'bisey', 'birsey', 'seyi', 'olmuyor', 'olmadi', 'yardim', 'yardimci',
  // English
  'the', 'an', 'my', 'to', 'it', 'its', 'make', 'of', 'for', 'in', 'on', 'is', 'me', 'we', 'you', 'how', 'do', 'does',
  'can', 'want', 'need', 'please', 'this', 'that', 'from', 'into', 'with', 'and', 'file', 'movie',
  'any', 'some', 'so', 'but', 'because', 'when', 'there', 'here', 'be', 'are', 'am', 'was', 'have', 'has', 'im', 'very',
  'really', 'just', 'would', 'like', 'wanna', 'gonna', 'as', 'or', 'if', 'what', 'which', 'will', 'your', 'our',
  'hello', 'hi', 'hey', 'thanks', 'thank',
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

/** One edit away from the word, with or without a real ending after it. Same first letter. */
function isTypoOf(token: string, word: string): boolean {
  if (token.length < TYPO_MIN_LENGTH || word.length < TYPO_MIN_LENGTH || token[0] !== word[0]) return false;
  if (editDistance(token, word, 1) <= 1) return true;
  if (token.length <= word.length) return false;
  // "titokta" = "titok" (one letter short of "tiktok") + "ta".
  return [word.length - 1, word.length, word.length + 1].some(
    (length) =>
      length >= TYPO_MIN_LENGTH &&
      length < token.length &&
      editDistance(token.slice(0, length), word, 1) <= 1 &&
      isTurkishEnding(token.slice(length)),
  );
}

/** English endings a list word may carry: "pauses", "muted", "cropping". */
const ENGLISH_ENDING = /^(?:s|es|ed|d|ing|er)$/;

/** The word itself with an ending after it: a Turkish one, or a plain English one. */
function isWordForm(token: string, word: string): boolean {
  if (isFormOf(token, word)) return true;
  return token.startsWith(word) && ENGLISH_ENDING.test(token.slice(word.length));
}

type MatchKind = 'exact' | 'part' | 'typo';

/**
 * How sure a match is, best first: exact (4) › form or prefix over four
 * letters or more (3) › typo of a long word (2) › form or prefix over three
 * letters or fewer (1). So "sesiz" is a typo of "sessiz", not "ses" + "iz".
 */
type Tier = 1 | 2 | 3 | 4;

interface WordMatch {
  kind: MatchKind;
  tier: Tier;
  /** Letters of the token the word accounts for. */
  matched: number;
  strong: boolean;
  /** A word that steps back when another task has evidence of its own (rule 8). */
  yielding: boolean;
}

const STRONG_SCORE: Record<MatchKind, number> = { exact: 3, part: 2, typo: 2 };
const WEAK_SCORE: Record<MatchKind, number> = { exact: 1, part: 0.75, typo: 0 };
const PHRASE_SCORE = 4;
/** Each word of a phrase beyond the second. */
const PHRASE_EXTRA_WORD_SCORE = 1;
/** The shortest list word that may carry an ending by itself ("ses" → "sesini"); shorter ones need a phrase or a pair. */
const FORM_MIN_LENGTH = 3;
/** Rule 10: from this many intent words on, one supporting word alone is a guess. */
const FLOOR_MIN_TOKENS = 4;

function partMatch(matched: number, strong: boolean, yielding: boolean): WordMatch {
  return { kind: 'part', tier: matched >= 4 ? 3 : 1, matched, strong, yielding };
}

/** `typing`: this is the word still being typed; `alone`: it is also the only word of the query. */
function matchWord(
  token: string,
  word: string,
  strong: boolean,
  typing: boolean,
  yielding = false,
  alone = false,
): WordMatch | null {
  if (token === word) return { kind: 'exact', tier: 4, matched: token.length, strong, yielding };
  // A form: the word, then a real ending ("kesmek", "sessizlikleri", "müziğini").
  if (word.length >= FORM_MIN_LENGTH && token.length > word.length && isWordForm(token, word)) {
    return partMatch(word.length, strong, yielding);
  }
  // Prefix: only the word still being typed ("sess"). Two letters ("di") only for a strong word and
  // only while nothing else has been typed: at the end of a sentence "al" is a word, not a beginning.
  if (typing && word.startsWith(token) && (token.length >= 3 || (strong && alone))) {
    return partMatch(token.length, strong, yielding);
  }
  if (strong && isTypoOf(token, word)) {
    return { kind: 'typo', tier: 2, matched: Math.min(token.length, word.length), strong, yielding };
  }
  return null;
}

function better(a: WordMatch | null, b: WordMatch): WordMatch {
  if (!a) return b;
  if (b.tier !== a.tier) return b.tier > a.tier ? b : a;
  if (b.matched !== a.matched) return b.matched > a.matched ? b : a;
  if (b.strong !== a.strong) return b.strong ? b : a;
  // The same word listed both ways cannot happen; a word that does not yield is the surer reading.
  return a.yielding && !b.yielding ? b : a;
}

/** The token is the list word, or the list word with an ending. Short words ("al") count here: the context is the proof. */
function tokenIs(token: string, word: string): boolean {
  return token === word || (word.length >= 2 && token.length > word.length && isWordForm(token, word));
}

/**
 * The phrase's words appear in order; a query word may carry an ending ("yerleri" for "yer", "almak"
 * for "al") or, for a word of three letters or more, simply go on ("bulanıklaştır" for "bulanık"):
 * inside a phrase the neighbour is the proof, so the looser reading is safe here and only here.
 */
function containsPhrase(tokens: readonly string[], phrase: string): boolean {
  const words = phrase.split(' ');
  for (let start = 0; start + words.length <= tokens.length; start += 1) {
    const hit = words.every((word, index) => {
      const token = tokens[start + index] ?? '';
      return tokenIs(token, word) || (word.length >= 3 && token.startsWith(word));
    });
    if (hit) return true;
  }
  return false;
}

/** One of `things` next to one of `verbs`, either order, among the words that carry intent. */
function containsPair(tokens: readonly string[], things: readonly string[], verbs: readonly string[]): boolean {
  const isOne = (token: string, words: readonly string[]) => words.some((word) => tokenIs(token, word));
  for (let index = 0; index + 1 < tokens.length; index += 1) {
    const a = tokens[index] ?? '';
    const b = tokens[index + 1] ?? '';
    if ((isOne(a, things) && isOne(b, verbs)) || (isOne(a, verbs) && isOne(b, things))) return true;
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

interface Tally {
  /** Points from words that are the task's own. */
  own: number;
  /** Yielding words, at their strong and at their weak value (rule 8). */
  yieldStrong: number;
  yieldWeak: number;
  /** The task has evidence no other task shares: a strong word of its own, a phrase, a pair, a verb that cannot. */
  specific: boolean;
  /** How many of the query's intent words the task's single words account for. */
  explained: number;
}

export function searchTasks(query: string, tasks: readonly TaskDefinition[] = TASKS): TaskSearchResult {
  const raw = rawTokens(query);
  const tokens = raw.filter((token) => token.length >= 2 && !isStopWord(token));
  // The last word may still be growing — unless the user already typed a space after it.
  const stillTyping = !/\s$/.test(query);
  const tallies = new Map<TaskDefinition, Tally>();
  const tally = (task: TaskDefinition): Tally => {
    let entry = tallies.get(task);
    if (!entry) {
      entry = { own: 0, yieldStrong: 0, yieldWeak: 0, specific: false, explained: 0 };
      tallies.set(task, entry);
    }
    return entry;
  };

  tokens.forEach((token, index) => {
    const typing = stillTyping && index === tokens.length - 1 && raw[raw.length - 1] === token;
    const alone = raw.length === 1;
    const perTask: Array<{ task: TaskDefinition; match: WordMatch }> = [];
    for (const task of tasks) {
      let best: WordMatch | null = null;
      for (const word of task.words.strong) {
        const match = matchWord(token, word, true, typing, false, alone);
        if (match) best = better(best, match);
      }
      for (const word of task.words.yielding ?? []) {
        const match = matchWord(token, word, true, typing, true, alone);
        if (match) best = better(best, match);
      }
      for (const word of task.words.weak) {
        const match = matchWord(token, word, false, typing);
        if (match) best = better(best, match);
      }
      // Rule 5: "açamıyorum" — the verb in a negative form is as sure as the task's own name.
      if ((task.words.unable ?? []).some((stem) => isNegativeFormOf(token, stem))) {
        best = better(best, { kind: 'exact', tier: 4, matched: token.length, strong: true, yielding: false });
      }
      if (best) perTask.push({ task, match: best });
    }
    if (perTask.length === 0) return;
    const tier = Math.max(...perTask.map((entry) => entry.match.tier));
    const inTier = perTask.filter((entry) => entry.match.tier === tier);
    const matched = Math.max(...inTier.map((entry) => entry.match.matched));
    for (const { task, match } of inTier) {
      if (match.matched !== matched) continue;
      const entry = tally(task);
      entry.explained += 1;
      if (match.yielding) {
        entry.yieldStrong += STRONG_SCORE[match.kind];
        entry.yieldWeak += WEAK_SCORE[match.kind];
      } else {
        entry.own += (match.strong ? STRONG_SCORE : WEAK_SCORE)[match.kind];
        if (match.strong) entry.specific = true;
      }
    }
  });

  for (const task of tasks) {
    const found = task.words.phrases
      .filter((phrase) => containsPhrase(raw, phrase))
      .map((phrase) => phrase.split(' ').length);
    const paired = (task.words.pairs ?? []).some(([things, verbs]) => containsPair(tokens, things, verbs));
    const longest = Math.max(paired ? 2 : 0, ...found);
    if (longest >= 2) {
      const entry = tally(task);
      entry.own += PHRASE_SCORE + (longest - 2) * PHRASE_EXTRA_WORD_SCORE;
      entry.specific = true;
    }
  }

  // Rule 8: a yielding word counts in full only when no OTHER task has evidence of its own.
  const scoreOf = (task: TaskDefinition): number => {
    const entry = tallies.get(task);
    if (!entry) return 0;
    if (entry.yieldStrong === 0) return entry.own;
    const othersHaveTheirOwn = [...tallies.entries()].some(([other, tallyOf]) => other !== task && tallyOf.specific);
    return entry.own + (othersHaveTheirOwn ? entry.yieldWeak : entry.yieldStrong);
  };

  const ranked = tasks
    .map((task, order) => ({ task, score: scoreOf(task), order }))
    .filter((entry) => entry.score > 0)
    // A tie goes to the more specific task: "kes" / "cut" is what people say
    // about any job ("cut the pauses"), so the generic task steps back.
    .sort(
      (a, b) =>
        b.score - a.score || Number(a.task.generic === true) - Number(b.task.generic === true) || a.order - b.order,
    );

  const top = ranked[0];
  if (!top) return tokens.length === 0 ? { kind: 'empty' } : { kind: 'none' };
  // Rule 10: one supporting word in a longer request is a guess, not an answer.
  const topTally = tallies.get(top.task);
  if (
    topTally &&
    !topTally.specific &&
    topTally.yieldStrong === 0 &&
    topTally.explained <= 1 &&
    tokens.length >= FLOOR_MIN_TOKENS
  ) {
    return { kind: 'none' };
  }
  const cannotDoYet = !top.task.available;
  const matches = ranked
    .filter((entry) => entry.score >= top.score * KEEP_RATIO)
    .filter((entry) => !cannotDoYet || !entry.task.available || entry.score >= top.score * KEEP_UNDER_CANNOT_RATIO)
    .slice(0, MAX_RESULTS)
    .map(({ task, score }) => ({ task, score }));
  return { kind: 'results', matches };
}
