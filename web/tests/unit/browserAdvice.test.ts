import { describe, expect, it } from 'vitest';

import { BROWSER_SIDE_BLOCKERS, browserAdvice, isBrowserSideRefusal } from '@/domain/browserAdvice';
import { tr, type MessageKey } from '@/i18n/messages';
import { en } from '@/i18n/messages.en';

import { strongJargon } from '../quality/lib/jargon';

/**
 * The way forward when the browser cannot make the file (13 Oct 2026, the
 * Firefox / WebKit walk). Wrong advice is worse than none: nothing inside
 * Chrome / Edge, never "another browser" on an iPhone or iPad, and nothing at
 * all for a refusal that is the video's.
 */
describe('browser advice', () => {
  const firefox = { chromium: false, ios: false };
  const chrome = { chromium: true, ios: false };
  const iphoneSafari = { chromium: false, ios: true };
  /** Chrome on an iPhone calls itself Chrome (CriOS) and runs on the same engine as Safari. */
  const iphoneChrome = { chromium: true, ios: true };

  it('Firefox without an AAC encoder (measured): try Chrome or Edge', () => {
    expect(browserAdvice({ ...firefox, environmentFailed: false, blockers: ['audio_encoder_unsupported'] })).toBe('try_chromium');
  });

  it('a browser without WebCodecs at all (measured: WebKit on Windows): try Chrome or Edge', () => {
    expect(
      browserAdvice({ ...firefox, environmentFailed: true, blockers: ['video_encoder_unsupported', 'audio_encoder_unsupported'] }),
    ).toBe('try_chromium');
    // The environment check failed for a reason that has no code of its own (no OffscreenCanvas).
    expect(browserAdvice({ ...firefox, environmentFailed: true, blockers: ['internal_error'] })).toBe('try_chromium');
  });

  it('iPhone and iPad: another device, never another browser — also inside "Chrome" there', () => {
    for (const where of [iphoneSafari, iphoneChrome]) {
      expect(browserAdvice({ ...where, environmentFailed: true, blockers: ['audio_encoder_unsupported'] })).toBe('other_device');
    }
  });

  it('inside Chrome or Edge: no advice (it would send people in a circle)', () => {
    expect(browserAdvice({ ...chrome, environmentFailed: false, blockers: ['video_encoder_unsupported'] })).toBe('none');
    expect(browserAdvice({ ...chrome, environmentFailed: true, blockers: [] })).toBe('none');
  });

  it('a refusal that is the video’s gets no browser advice anywhere', () => {
    for (const where of [firefox, chrome, iphoneSafari]) {
      for (const code of ['source_undecodable', 'hdr_source_unsupported', 'caption_font_unavailable', 'internal_error'] as const) {
        expect(browserAdvice({ ...where, environmentFailed: false, blockers: [code] })).toBe('none');
      }
      expect(browserAdvice({ ...where, environmentFailed: false, blockers: [] })).toBe('none');
    }
  });

  it('what counts as the browser’s refusal', () => {
    expect([...BROWSER_SIDE_BLOCKERS].sort()).toEqual(['audio_encoder_unsupported', 'video_encoder_unsupported', 'worker_unavailable']);
    expect(isBrowserSideRefusal({ environmentFailed: false, blockers: ['source_undecodable'] })).toBe(false);
    expect(isBrowserSideRefusal({ environmentFailed: false, blockers: ['source_undecodable', 'worker_unavailable'] })).toBe(true);
  });

  it('the sentences exist in both languages, in plain words, and name a way forward', () => {
    const keys = ['browser.cannotExport', 'browser.cannotExportNote', 'browser.advice.try_chromium', 'browser.advice.other_device'] as MessageKey[];
    for (const key of keys) {
      expect(tr[key], key).toBeTruthy();
      expect(en[key], key).toBeTruthy();
      expect(strongJargon(tr[key]), key).toEqual([]);
    }
    expect(tr['browser.advice.try_chromium']).toMatch(/Chrome ya da Edge/);
    // On an iPhone "install Chrome" is not the way forward: a computer or an Android phone is.
    expect(tr['browser.advice.other_device']).toMatch(/bilgisayarda/);
    expect(tr['browser.advice.other_device']).not.toMatch(/Edge/);
  });
});
