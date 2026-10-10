/**
 * Turkish endings, as far as "Yaz, bulalım" needs them (10 Oct 2026).
 *
 * The search compares what was typed with a short list of words per task.
 * Turkish puts its grammar at the END of the word — "ses" is also "sesi",
 * "sesini", "sesinden"; "kes" is "kesmek", "kesiyorum", "kesebilir miyim",
 * "kesicem" — so a word list alone either misses those or, if it accepts
 * "anything that starts with the word", takes "kesinlikle" (certainly) for
 * "kes" (cut), "dikkat" (careful) for "dik" (upright) and "netflix" for
 * "net" (sharp).
 *
 * This module answers one question: are these letters, after a known word, a
 * real ending? It is not a morphological analyser. Two templates, on FOLDED
 * text (`foldText`: lower case, ç ğ ı ö ş ü → c g i o s u, so the vowel
 * harmony pairs i/ı and u/ü are one letter each and only a/e stay apart):
 *
 * - a noun: plural, possessive, case, "ki" — "ses-i-ni", "video-lar-ım-dan";
 * - a verb: voice, ability, negation, then a tense with its person, an
 *   order / wish, or a verbal noun — "kes-ebil-ir", "aç-ıl-mı-yor",
 *   "kısalt-ma-m", "at-ıca-m" (as people type it).
 *
 * Word-building endings (-lik, -li, -siz, -ci, -ce) are left out on purpose:
 * "sesli", "sessizce" and "kesinlikle" are other words, not forms of "ses"
 * and "kes"; where one of them is meant, it is in the list itself
 * ("sessizlik").
 */

const PLURAL = 'l[ae]r';
const POSSESSIVE = '[iu]m[iu]z|[iu]n[iu]z|m[iu]z|n[iu]z|l[ae]r[iu]|[iu]m|[iu]n|s[iu]|m|n|[iu]';
const CASE = 'n?[dt][ae]n|n?[dt][ae]|n?[iu]n|y?l[ae]|[yn]?[iu]|[yn]?[ae]';

/** After a noun: "-lar", "-ım", "-ı", "-ından", "-daki". */
const NOUN = new RegExp(`^(?:${PLURAL})?(?:${POSSESSIVE})?(?:${CASE})?(?:ki)?$`);

/** Causative and passive: "kes-tir", "aç-ıl", "sil-in", "kısal-t". */
const VOICE = '(?:[dt][iu]r|[iu]l|[iu]n|t){0,2}';
/** "-ebil" (can); the bare vowel only in front of the negation ("aç-a-mı-yor"). */
const ABILITY = '(?:y?[ae]bil|y?[ae](?=m[aeiu]))?';
const NEGATION = '(?:m[aeiu])?';
const PERSON = '(?:[iu]m|s[iu]n[iu]z|s[iu]n|[iu]z|l[ae]r|y[iu]m|y[iu]z|m|n|k)?';
/** Tenses with a person ending, the forms people type included ("-icem", "-iyom"). */
const FINITE = `(?:(?:[iu]yor|yor|[dt][iu]|m[iu]s|y?[ae]c[ae][kg]|[ae]r|[iu]r|r|z|m[ae]l[iu]|s[ae])${PERSON}(?:d[iu]r)?|y?[iu]c[ae][mnz]|c[ae][mnz]|y?[iu]yo[mn]?)`;
/** Orders and wishes: "kes-sin", "kes-in", "kes-eyim", "kes-elim", "kes-sene". */
const WISH = '(?:s[iu]n(?:l[ae]r)?|y?[iu]n(?:[iu]z)?|y?[ae]y[iu]m|y?[ae]l[iu]m|s[ae]n[ae]|y?[ae]m)';
/** Verbal nouns and linking forms: "kes-mek", "kes-me-m", "kes-ip", "kes-erek", "kes-tiğ-im", "kes-en". */
const NON_FINITE = `(?:m[ae]k|m[ae]d[ae]n|y?[iu]p|y?[ae]r[ae]k|y?[iu]nc[ae]|[dt][iu][kg](?:${POSSESSIVE})?(?:${CASE})?|y?[ae]n(?:${PLURAL})?(?:${CASE})?|m[ae](?:${POSSESSIVE})?(?:${CASE})?)`;

/** After a verb stem. The bare negation is the last alternative: "kes-me" (do not cut). */
const VERB = new RegExp(`^${VOICE}${ABILITY}(?:${NEGATION}(?:${FINITE}|${WISH})|${NON_FINITE}|m[ae])$`);

/**
 * "Cannot" / "does not": the verb with its negation — "aç-a-mı-yorum",
 * "aç-ıl-mı-yor", "gönder-eme-dim", "sığ-ma-z", "oyna-mı-yor".
 */
const NEGATIVE = new RegExp(`^${VOICE}(?:y?[ae])?m[aeiu](?:${FINITE}|${WISH})$`);

/** No ending is longer than this ("-yamayacaklarından" is not a search query). */
const MAX_ENDING = 14;

/** Whether `rest` (what follows a known word, folded) is a real Turkish ending. The empty string is. */
export function isTurkishEnding(rest: string): boolean {
  if (rest === '') return true;
  if (rest.length > MAX_ENDING) return false;
  return NOUN.test(rest) || VERB.test(rest);
}

/** Whether `rest` makes the verb before it negative ("cannot open", "does not fit"). */
export function isNegativeEnding(rest: string): boolean {
  return rest !== '' && rest.length <= MAX_ENDING && NEGATIVE.test(rest);
}

const SOFTENED: Record<string, string> = { k: 'g', p: 'b', t: 'd' };
const VOWEL = /^[aeiou]/;
/** The endings in front of which a verb's last vowel narrows away: "ekle" → "ekl-iyor", "ekl-icem". */
const NARROWING = /^[iu](?:yo|c[ae])/;

/**
 * What follows `word` in `token` when the token is that word with an ending,
 * or null. A final k, p or t may have softened in front of a vowel, as it
 * does in Turkish: "müzik" → "müziği", "kitap" → "kitabı", "renk" → "rengi".
 * A verb that ends in a or e loses that vowel in front of "-iyor" and the
 * typed future "-icem": "ekle" → "ekliyorum", "eklicem"; "oyna" → "oynuyor".
 */
export function endingAfter(token: string, word: string): string | null {
  if (token.length <= word.length) return token === word ? '' : null;
  if (token.startsWith(word)) return token.slice(word.length);
  if (/[ae]$/.test(word) && word.length >= 3 && token.startsWith(word.slice(0, -1))) {
    const rest = token.slice(word.length - 1);
    if (NARROWING.test(rest)) return rest;
  }
  const soft = SOFTENED[word[word.length - 1] ?? ''];
  if (soft && token.startsWith(word.slice(0, -1) + soft)) {
    const rest = token.slice(word.length);
    return VOWEL.test(rest) ? rest : null;
  }
  return null;
}

/** `token` is `word` itself or `word` with a real ending ("sesini" ← "ses", "müziği" ← "müzik"). */
export function isFormOf(token: string, word: string): boolean {
  const rest = endingAfter(token, word);
  return rest !== null && isTurkishEnding(rest);
}

/** `token` is the verb `stem` in a negative form ("açamıyorum", "açılmıyor" ← "aç"). */
export function isNegativeFormOf(token: string, stem: string): boolean {
  const rest = endingAfter(token, stem);
  return rest !== null && isNegativeEnding(rest);
}
