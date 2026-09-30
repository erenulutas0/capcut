import { describe, expect, it } from 'vitest';

import { isIosSafari } from '@/adapters/pwa/installPrompt';
import { formatByteLimit } from '@/domain/policy';
import { CHROMIUM_SHARE_MAX_BYTES, isChromiumUserAgent, shareOutcome, shareVerdict } from '@/domain/share';

const UA = {
  chromeWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36',
  chromeAndroid:
    'Mozilla/5.0 (Linux; Android 16; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36',
  samsungInternet:
    'Mozilla/5.0 (Linux; Android 16; SAMSUNG SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/30.0 Chrome/136.0.0.0 Mobile Safari/537.36',
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/154.0.0.0 Mobile/15E148 Safari/604.1',
  iphoneInstagram:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0',
  ipadDesktopMode:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0',
};

describe('share verdict (ADR-031)', () => {
  it('no button without file sharing', () => {
    expect(shareVerdict({ canShareFile: false, chromium: true, sizeBytes: 1000 })).toBe('unsupported');
    expect(shareVerdict({ canShareFile: false, chromium: false, sizeBytes: 1000 })).toBe('unsupported');
  });

  it('Chromium: up to exactly 50 MiB is shared, one byte more is explained instead', () => {
    expect(CHROMIUM_SHARE_MAX_BYTES).toBe(52_428_800);
    expect(shareVerdict({ canShareFile: true, chromium: true, sizeBytes: CHROMIUM_SHARE_MAX_BYTES })).toBe('share');
    expect(shareVerdict({ canShareFile: true, chromium: true, sizeBytes: CHROMIUM_SHARE_MAX_BYTES + 1 })).toBe('too_large');
    expect(shareVerdict({ canShareFile: true, chromium: true, sizeBytes: 1024 ** 3 })).toBe('too_large');
    // The card says the limit in the units it uses everywhere (ADR-030), rounded down.
    expect(formatByteLimit(CHROMIUM_SHARE_MAX_BYTES, ',')).toBe('52,4 MB');
  });

  it('Safari has no such limit here: its own answer decides', () => {
    expect(shareVerdict({ canShareFile: true, chromium: false, sizeBytes: 1024 ** 3 })).toBe('share');
  });

  it('knows Chromium from the user agent, iOS browsers are WebKit', () => {
    expect(isChromiumUserAgent(UA.chromeWindows)).toBe(true);
    expect(isChromiumUserAgent(UA.chromeAndroid)).toBe(true);
    expect(isChromiumUserAgent(UA.samsungInternet)).toBe(true);
    expect(isChromiumUserAgent(UA.iphoneSafari)).toBe(false);
    expect(isChromiumUserAgent(UA.iphoneChrome)).toBe(false);
    expect(isChromiumUserAgent(UA.firefox)).toBe(false);
  });

  it('closing the sheet is not a failure; any other rejection is', () => {
    expect(shareOutcome(null)).toBe('shared');
    expect(shareOutcome(new DOMException('Share canceled', 'AbortError'))).toBe('closed');
    expect(shareOutcome(new DOMException('Permission denied', 'NotAllowedError'))).toBe('failed');
    expect(shareOutcome(new TypeError('x'))).toBe('failed');
    expect(shareOutcome('odd')).toBe('failed');
  });
});

describe('install hint for iPhone/iPad Safari (ADR-031)', () => {
  it('Safari on iPhone and on iPad in desktop mode', () => {
    expect(isIosSafari(UA.iphoneSafari, 'iPhone', 5)).toBe(true);
    expect(isIosSafari(UA.ipadDesktopMode, 'MacIntel', 5)).toBe(true);
  });

  it('not a Mac, not another iOS browser or an app’s web view, not Android', () => {
    expect(isIosSafari(UA.ipadDesktopMode, 'MacIntel', 0)).toBe(false);
    expect(isIosSafari(UA.iphoneChrome, 'iPhone', 5)).toBe(false);
    expect(isIosSafari(UA.iphoneInstagram, 'iPhone', 5)).toBe(false);
    expect(isIosSafari(UA.chromeAndroid, 'Linux armv8l', 5)).toBe(false);
    expect(isIosSafari(UA.samsungInternet, 'Linux armv8l', 5)).toBe(false);
  });
});
