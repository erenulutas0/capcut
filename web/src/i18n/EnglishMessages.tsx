'use client';

// Loading this module is the point: it registers English with `translator('en')` in the browser.
import './messages.en';

/**
 * Put first on a page that is shown in English (the English privacy page).
 * It draws nothing; it makes the browser load the English words with that
 * page — and only with that page — before the parts below it that speak
 * English are drawn. Every other page carries Turkish alone.
 */
export function EnglishMessages() {
  return null;
}
