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
 *    ("ses hiç olmasın") — or, where the pair says so, with one word between
 *    ("şarkı arkada çalsın"). Scores like a two-word phrase; phrase and pair
 *    do not add up.
 * 8. Yielding words: "çevir", "dönüştür", "convert" say that something is to
 *    be turned into something else, not into what. Alone they are Her yerde
 *    açılsın; next to another task's own evidence ("mp3e çevir", "gife
 *    çevir", "Türkçeye çevir", "sağa çevir") they step back to a weak word.
 * 9. Rank by score. A tie goes to the more specific task ("cut the pauses"
 *    is Boşlukları at, not the generic Kes), then to registry order. Keep at
 *    most three, and only those within 40 % of the best — a stray weak word
 *    does not add a row.
 * 10. A floor: in a request of four words or more, a best match that rests
 *    on ONE supporting (weak) word and explains nothing else is not an
 *    answer; the user gets "Bunu bulamadım" rather than a card on a guess
 *    ("şu videoyu bilgisayara aktarıp telefona yollamak" is not Dikey yap
 *    because it says "telefon"). One STRONG word still answers, however long
 *    the sentence: measured on the first fresh batch, refusing those lost
 *    three right answers for every wrong card it removed.
 * 11. When the best match is something the app cannot do yet ("gife çevir",
 *    "youtubedan video indir"), the answer is "Bunu henüz yapamıyoruz." and
 *    a task that only shares a word with the request is not offered under
 *    it: rows of tasks that work stay only when they score nearly as much as
 *    the best (80 %), i.e. the words point at them just as much.
 * 12. Sure, or asking (11 Oct 2026). The ranking above always has a first
 *    row; whether that row is THE answer is a separate question, answered
 *    from what stands behind it (`confidenceOf`): how many of the request's
 *    words it accounts for, how many are left over, how close the next task
 *    is. `sure`: the row is highlighted and Enter starts it. `ask`: the rows
 *    are choices ("Bunu mu demek istedin?"), none is highlighted, and tasks
 *    that work are listed down to 25 % of the best score instead of 40 %.
 *    An answer of rule 11 ("Bunu henüz yapamıyoruz.") is never a question.
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
  // Adverbs of degree and manner: they stand between a thing and what is done to it ("sesi komple kıs").
  'komple', 'tamamiyla', 'tumden', 'butun', 'hepsini', 'hepsi', 'iyice', 'direkt', 'tam', 'surekli', 'devamli',
  'kendiliginden', 'otomatik', 'ayri', 'ayrica', 'zahmet', 'bile', 'ise', 'yoksa', 'nedense', 'maalesef',
  // English
  'the', 'an', 'my', 'to', 'it', 'its', 'make', 'of', 'for', 'in', 'on', 'is', 'me', 'we', 'you', 'how', 'do', 'does',
  'can', 'want', 'need', 'please', 'this', 'that', 'from', 'into', 'with', 'and', 'file', 'movie',
  'any', 'some', 'so', 'but', 'because', 'when', 'there', 'here', 'be', 'are', 'am', 'was', 'have', 'has', 'im', 'very',
  'really', 'just', 'would', 'like', 'wanna', 'gonna', 'as', 'or', 'if', 'what', 'which', 'will', 'your', 'our',
  'hello', 'hi', 'hey', 'thanks', 'thank',
  // ADR-048: "vid" is "video"; chat words that say nothing about the job.
  'vid', 'vids', 'pls', 'u', 'ur', 'bc', 'cuz', 'lol', 'omg', 'idk',
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

/** The same letters with two neighbours swapped ("dikye" / "dikey"). */
function isSwap(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const at = [...a].findIndex((letter, index) => letter !== b[index]);
  return at >= 0 && at + 1 < a.length && a[at] === b[at + 1] && a[at + 1] === b[at] && a.slice(at + 2) === b.slice(at + 2);
}

/**
 * One slip of the finger apart: a letter missing, doubled or swapped with its neighbour at any length.
 * One letter REPLACED counts only in a word of six letters or more — in a five-letter word it is as
 * likely another word ("yarın" is not "yayın", "kaldı" is not "kaydı").
 */
function slipApart(typed: string, word: string): boolean {
  if (editDistance(typed, word, 1) > 1) return false;
  return typed.length !== word.length || typed.length > TYPO_MIN_LENGTH || isSwap(typed, word);
}

/**
 * One edit away from the word, with or without a real ending after it. Same first letter.
 * `minLength`: the shortest typed word that may be a typo at all.
 */
function isTypoOf(token: string, word: string, minLength = TYPO_MIN_LENGTH): boolean {
  if (token.length < minLength || word.length < TYPO_MIN_LENGTH || token[0] !== word[0]) return false;
  if (slipApart(token, word)) return true;
  if (token.length <= word.length) return false;
  // "titokta" = "titok" (one letter short of "tiktok") + "ta".
  return [word.length - 1, word.length, word.length + 1].some(
    (length) =>
      length >= TYPO_MIN_LENGTH &&
      length < token.length &&
      slipApart(token.slice(0, length), word) &&
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
/** Rule 10: from this many intent words on, one supporting (weak) word alone is a guess. */
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

/**
 * The token is the list word, the list word with an ending, or — for a word of five letters or more —
 * a slip of the finger away from it ("sesiz video", "müzk ekle": inside a phrase or a pair a typed word
 * of four letters may be one, the neighbour is the proof). Short words ("al") count here for the same reason.
 */
function tokenIs(token: string, word: string): boolean {
  if (token === word) return true;
  if (word.length >= 2 && token.length > word.length && isWordForm(token, word)) return true;
  return isTypoOf(token, word, TYPO_MIN_LENGTH - 1);
}

/**
 * The phrase's words appear in order; a query word may carry an ending ("yerleri" for "yer", "almak"
 * for "al") or, for a word of five letters or more, simply go on ("bulanıklaştır" for "bulanık"):
 * inside a phrase the neighbour is the proof, so the looser reading is safe here and only here. (Not
 * for shorter words: "sesiz kısımları" is not the phrase "sesi kıs".)
 */
function phraseAt(tokens: readonly string[], phrase: string): number[] | null {
  const words = phrase.split(' ');
  for (let start = 0; start + words.length <= tokens.length; start += 1) {
    const hit = words.every((word, index) => {
      const token = tokens[start + index] ?? '';
      return tokenIs(token, word) || (word.length >= 5 && token.startsWith(word));
    });
    if (hit) return words.map((_, index) => start + index);
  }
  return null;
}

/**
 * One of `things` next to one of `verbs`, either order, among the words that carry intent — with at
 * most `gap` other words between them. Answers with the places of the two words.
 */
function pairAt(
  tokens: readonly string[],
  things: readonly string[],
  verbs: readonly string[],
  gap = 0,
): [number, number] | null {
  const isOne = (token: string, words: readonly string[]) => words.some((word) => tokenIs(token, word));
  for (let index = 0; index + 1 < tokens.length; index += 1) {
    const a = tokens[index] ?? '';
    const aIsThing = isOne(a, things);
    const aIsVerb = isOne(a, verbs);
    if (!aIsThing && !aIsVerb) continue;
    for (let other = index + 1; other <= index + 1 + gap && other < tokens.length; other += 1) {
      const b = tokens[other] ?? '';
      if ((aIsThing && isOne(b, verbs)) || (aIsVerb && isOne(b, things))) return [index, other];
    }
  }
  return null;
}

export interface TaskMatch {
  task: TaskDefinition;
  score: number;
}

/**
 * What stands behind the best match — the facts the confidence rule reads
 * (rule 12). Counted over the words that carry intent.
 */
export interface SearchEvidence {
  /** Words of the request that carry intent. */
  words: number;
  /** Of those, the ones the best match accounts for (its words, its phrase, its pair). */
  covered: number;
  /** Not accounted for by the best match, but another task knows them. */
  rival: number;
  /** No task knows them. */
  unknown: number;
  /** Score of the best match and of the next task (0: there is none). */
  best: number;
  second: number;
  /** The best match has evidence of its own: a strong word, a phrase, a pair, a verb that cannot. */
  specific: boolean;
  /** …and more than one word stands behind it together (a phrase or a pair). */
  combined: boolean;
}

/**
 * `sure`: the first row is the answer — it is highlighted and Enter starts it.
 * `ask`: the words do not settle it; the rows are choices ("Bunu mu demek
 * istedin?"), none is highlighted and Enter starts nothing until one is chosen.
 */
export type SearchConfidence = 'sure' | 'ask';

export type TaskSearchResult =
  /** Nothing typed that says what to do (empty, one letter, only "video"): the cards stay. */
  | { kind: 'empty' }
  | { kind: 'results'; matches: TaskMatch[]; confidence: SearchConfidence; evidence: SearchEvidence }
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
  /** A phrase or a pair was found: more than one word of the request stands behind the task. */
  combined: boolean;
  /** How many of the query's intent words the task's single words account for. */
  explained: number;
  /** Which intent words stand behind the task: single words, and the words of its phrase or pair. */
  covered: Set<number>;
}

export function searchTasks(query: string, tasks: readonly TaskDefinition[] = TASKS): TaskSearchResult {
  const raw = rawTokens(query);
  /** Places, in `raw`, of the words that carry intent. */
  const places = raw.flatMap((token, index) => (token.length >= 2 && !isStopWord(token) ? [index] : []));
  const tokens = places.map((index) => raw[index] ?? '');
  // The last word may still be growing — unless the user already typed a space after it.
  const stillTyping = !/\s$/.test(query);
  const tallies = new Map<TaskDefinition, Tally>();
  const tally = (task: TaskDefinition): Tally => {
    let entry = tallies.get(task);
    if (!entry) {
      entry = { own: 0, yieldStrong: 0, yieldWeak: 0, specific: false, combined: false, explained: 0, covered: new Set() };
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
      entry.covered.add(index);
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
    let longest = 0;
    let behind: number[] = [];
    for (const phrase of task.words.phrases) {
      const at = phraseAt(raw, phrase);
      if (at && at.length > longest) {
        longest = at.length;
        // Phrases are read over every word; only the ones that carry intent count as covered.
        behind = at.flatMap((rawIndex) => {
          const index = places.indexOf(rawIndex);
          return index >= 0 ? [index] : [];
        });
      }
    }
    if (longest < 2) {
      for (const [things, verbs, gap] of task.words.pairs ?? []) {
        const at = pairAt(tokens, things, verbs, gap ?? 0);
        if (at) {
          longest = 2;
          behind = at;
          break;
        }
      }
    }
    if (longest >= 2) {
      const entry = tally(task);
      entry.own += PHRASE_SCORE + (longest - 2) * PHRASE_EXTRA_WORD_SCORE;
      entry.specific = true;
      entry.combined = true;
      for (const index of behind) entry.covered.add(index);
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
    !topTally.combined &&
    topTally.yieldStrong === 0 &&
    topTally.explained <= 1 &&
    tokens.length >= FLOOR_MIN_TOKENS
  ) {
    return { kind: 'none' };
  }

  const covered = topTally?.covered ?? new Set<number>();
  let rival = 0;
  let unknown = 0;
  tokens.forEach((_, index) => {
    if (covered.has(index)) return;
    if ([...tallies.values()].some((entry) => entry.covered.has(index))) rival += 1;
    else unknown += 1;
  });
  const evidence: SearchEvidence = {
    words: tokens.length,
    covered: covered.size,
    rival,
    unknown,
    best: top.score,
    second: ranked[1]?.score ?? 0,
    specific: topTally?.specific === true,
    combined: topTally?.combined === true,
  };

  const cannotDoYet = !top.task.available;
  const confidence: SearchConfidence = cannotDoYet ? 'sure' : confidenceOf(evidence);
  // Among choices a weaker task that WORKS is worth a row; a row that only says "not yet" is not.
  const keepRatio = (entry: { task: TaskDefinition }) =>
    confidence === 'ask' && entry.task.available ? ASK_KEEP_RATIO : KEEP_RATIO;
  const matches = ranked
    .filter((entry) => entry.score >= top.score * keepRatio(entry))
    .filter((entry) => !cannotDoYet || !entry.task.available || entry.score >= top.score * KEEP_UNDER_CANNOT_RATIO)
    .slice(0, MAX_RESULTS)
    .map(({ task, score }) => ({ task, score }));
  return { kind: 'results', matches, confidence, evidence };
}

/** In a list of choices a weaker candidate is worth a row: the user picks, nothing is started for them. */
const ASK_KEEP_RATIO = 0.25;

/** Rule 12, one word behind the match: the score it needs when the request is that word alone / has one more word. */
const SURE_ALONE_SCORE = 2;
const SURE_ONE_LEFT_SCORE = 3;
/** Rule 12: the next task must stay under this share of the best score… */
const SURE_RIVAL_RATIO = 0.5;
/** …or under this one, when two words or more stand behind the best match and at most one is left over. */
const SURE_RIVAL_RATIO_COVERED = 0.8;

/**
 * Rule 12 — is the best match THE answer, or one of a few guesses?
 *
 * Measured on the four phrase sets that had already been seen (11 Oct 2026):
 * a best match that accounts for two words or more of the request was the
 * wrong task in about 1 case in 60; one that rests on a single word while
 * other words of the request are left unexplained was wrong in about 1 in 4.
 * So the answer is `sure` only when
 *
 * - two words or more stand behind it, and the next task scores under 80 % of
 *   it — under 50 % when two or more words of the request are left over; or
 * - one word stands behind it and that word is the whole request (a strong
 *   word, or the word still being typed); or
 * - one word stands behind it, exactly one other word is left over, the word
 *   is the task's own name said outright (score 3) and the next task scores
 *   under half of it.
 *
 * Everything else is `ask`. Coverage counts the words that carry intent; a
 * phrase or a pair covers each of its words.
 */
export function confidenceOf(evidence: SearchEvidence): SearchConfidence {
  const left = evidence.rival + evidence.unknown;
  const ratio = evidence.best > 0 ? evidence.second / evidence.best : 1;
  if (evidence.covered >= 2) {
    return ratio < (left <= 1 ? SURE_RIVAL_RATIO_COVERED : SURE_RIVAL_RATIO) ? 'sure' : 'ask';
  }
  if (left === 0) return evidence.best >= SURE_ALONE_SCORE && ratio < SURE_RIVAL_RATIO_COVERED ? 'sure' : 'ask';
  if (left === 1) return evidence.best >= SURE_ONE_LEFT_SCORE && ratio < SURE_RIVAL_RATIO ? 'sure' : 'ask';
  return 'ask';
}
