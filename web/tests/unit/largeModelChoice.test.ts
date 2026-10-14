import { describe, expect, it } from 'vitest';

import { classifyDevice } from '@/domain/deviceClass';
import { caughtFailureDetail, failureHint, pageSideFailureDetail } from '@/domain/exportFailureDetail';
import {
  LARGE_MODEL,
  RECOMMENDED_MODEL,
  classifyLargeModelFailure,
  largeModelStanding,
  preselectedModel,
  recommendedModel,
} from '@/domain/transcriptModels';
import { tr, type MessageKey } from '@/i18n/messages';
import { en } from '@/i18n/messages.en';

import { strongJargon } from '../quality/lib/jargon';

/**
 * "Yazıya dök" on a phone (ADR-036, addendum of 14 Oct 2026). On a Galaxy S23
 * (Android 16, Chrome 155, WebGPU with shader-f16) the large model was
 * pre-selected and "Önerilen"; its 605 MB download worked and writing failed
 * 3 times of 3 with a WebGPU buffer read error, while the small model wrote
 * the same clip in 10.5 s. The large model is now recommended only where it
 * was measured to work, and its failure offers the small model.
 */

/** User-Agent strings as the browsers send them (versions as of Oct 2026). */
const UA = {
  s23Chrome: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36',
  androidTablet: 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36',
  samsungInternet: 'Mozilla/5.0 (Linux; Android 16; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/30.0 Chrome/138.0.0.0 Mobile Safari/537.36',
  firefoxAndroid: 'Mozilla/5.0 (Android 16; Mobile; rv:144.0) Gecko/144.0 Firefox/144.0',
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/155.0.0.0 Mobile/15E148 Safari/604.1',
  ipadSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
  windowsChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36',
  windowsEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36 Edg/155.0.0.0',
  headless: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/153.0.8010.12 Safari/537.36',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36',
  windowsFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
};

const brands = (...names: string[]) => names.map((brand) => ({ brand, version: '155' }));
const CHROME_BRANDS = brands('Not)A;Brand', 'Chromium', 'Google Chrome');

describe('phone or computer, Chromium or not', () => {
  it('the S23 as Chrome reports it (client hints): a phone', () => {
    expect(classifyDevice({ userAgent: UA.s23Chrome, data: { mobile: true, platform: 'Android', brands: CHROME_BRANDS } })).toEqual({
      handheld: true,
      chromium: true,
      source: 'client-hints',
    });
  });

  it('desktop Chrome and Edge, by client hints: not handheld, Chromium', () => {
    expect(classifyDevice({ userAgent: UA.windowsChrome, data: { mobile: false, platform: 'Windows', brands: CHROME_BRANDS } })).toEqual({
      handheld: false,
      chromium: true,
      source: 'client-hints',
    });
    expect(
      classifyDevice({ userAgent: UA.windowsEdge, data: { mobile: false, platform: 'Windows', brands: brands('Microsoft Edge', 'Not)A;Brand', 'Chromium') } }),
    ).toMatchObject({ handheld: false, chromium: true });
    expect(
      classifyDevice({ userAgent: UA.headless, data: { mobile: false, platform: 'Windows', brands: brands('HeadlessChrome', 'Not_A Brand', 'Chromium') } }),
    ).toMatchObject({ handheld: false, chromium: true });
  });

  it('any handheld sign counts: an Android platform or user agent with mobile=false (a tablet, an overridden user agent)', () => {
    expect(classifyDevice({ userAgent: UA.androidTablet, data: { mobile: false, platform: 'Android', brands: CHROME_BRANDS } }).handheld).toBe(true);
    // Platform says nothing, the string says Android.
    expect(classifyDevice({ userAgent: UA.s23Chrome, data: { mobile: false, platform: '', brands: CHROME_BRANDS } }).handheld).toBe(true);
    expect(classifyDevice({ userAgent: UA.macChrome, data: { mobile: false, platform: 'iOS', brands: CHROME_BRANDS } }).handheld).toBe(true);
  });

  it('client hints without brands are not trusted: the user agent string decides', () => {
    expect(classifyDevice({ userAgent: UA.s23Chrome, data: { mobile: false, platform: '', brands: [] } })).toEqual({
      handheld: true,
      chromium: true,
      source: 'user-agent',
    });
    expect(classifyDevice({ userAgent: UA.windowsChrome, data: { mobile: 'no', brands: CHROME_BRANDS } }).source).toBe('user-agent');
  });

  it('without client hints (Firefox, Safari): the user agent string', () => {
    expect(classifyDevice({ userAgent: UA.firefoxAndroid })).toEqual({ handheld: true, chromium: false, source: 'user-agent' });
    expect(classifyDevice({ userAgent: UA.iphoneSafari })).toEqual({ handheld: true, chromium: false, source: 'user-agent' });
    // Chrome on iOS is WebKit underneath and does not say "Chrome/".
    expect(classifyDevice({ userAgent: UA.iphoneChrome })).toEqual({ handheld: true, chromium: false, source: 'user-agent' });
    expect(classifyDevice({ userAgent: UA.samsungInternet })).toMatchObject({ handheld: true, chromium: true });
    expect(classifyDevice({ userAgent: UA.windowsFirefox })).toEqual({ handheld: false, chromium: false, source: 'user-agent' });
    expect(classifyDevice({ userAgent: UA.macSafari })).toEqual({ handheld: false, chromium: false, source: 'user-agent' });
    expect(classifyDevice({ userAgent: UA.windowsChrome, data: null })).toEqual({ handheld: false, chromium: true, source: 'user-agent' });
    expect(classifyDevice({ userAgent: UA.headless })).toMatchObject({ handheld: false, chromium: true });
  });

  it('known limit, said in the ADR: an iPad’s Safari says "Macintosh" — seen as a computer, but not Chromium, so never "proven"', () => {
    const ipad = classifyDevice({ userAgent: UA.ipadSafari });
    expect(ipad).toEqual({ handheld: false, chromium: false, source: 'user-agent' });
    expect(largeModelStanding({ device: ipad, largeFailedHere: false })).toBe('untested');
  });

  it('survives nothing at all', () => {
    expect(classifyDevice({ userAgent: '' })).toEqual({ handheld: false, chromium: false, source: 'user-agent' });
    expect(classifyDevice({ userAgent: undefined as unknown as string, data: { brands: 'x' } })).toEqual({ handheld: false, chromium: false, source: 'user-agent' });
  });
});

const DESKTOP_CHROMIUM = { handheld: false, chromium: true } as const;
const PHONE = { handheld: true, chromium: true } as const;
const DESKTOP_OTHER = { handheld: false, chromium: false } as const;

describe('which model is "Önerilen" and selected first', () => {
  it('desktop Chromium with WebGPU: the large model, as before (the 7 Oct measurement)', () => {
    const input = { largeSupported: true, device: DESKTOP_CHROMIUM, largeFailedHere: false };
    expect(largeModelStanding(input)).toBe('proven');
    expect(recommendedModel(input)).toBe('turbo');
    expect(preselectedModel({ ...input, baseReady: false, turboReady: false })).toBe('turbo');
    expect(preselectedModel({ ...input, baseReady: true, turboReady: false })).toBe('base');
    expect(preselectedModel({ ...input, baseReady: true, turboReady: true })).toBe('turbo');
    expect(RECOMMENDED_MODEL).toBe(LARGE_MODEL);
  });

  it('a phone with WebGPU (the S23): the small model, whatever is stored — the large one stays a choice', () => {
    const input = { largeSupported: true, device: PHONE, largeFailedHere: false };
    expect(largeModelStanding(input)).toBe('phone');
    expect(recommendedModel(input)).toBe('base');
    for (const baseReady of [false, true]) {
      for (const turboReady of [false, true]) {
        expect(preselectedModel({ ...input, baseReady, turboReady })).toBe('base');
      }
    }
  });

  it('a browser that is not Chromium (Safari, Firefox with WebGPU): never measured, so the small model', () => {
    const input = { largeSupported: true, device: DESKTOP_OTHER, largeFailedHere: false };
    expect(largeModelStanding(input)).toBe('untested');
    expect(recommendedModel(input)).toBe('base');
    expect(preselectedModel({ ...input, baseReady: false, turboReady: true })).toBe('base');
  });

  it('where it failed before: the small model, even on desktop Chromium and with the large one stored', () => {
    const input = { largeSupported: true, device: DESKTOP_CHROMIUM, largeFailedHere: true };
    expect(largeModelStanding(input)).toBe('failed_here');
    expect(recommendedModel(input)).toBe('base');
    expect(preselectedModel({ ...input, baseReady: false, turboReady: true })).toBe('base');
    // The note outranks the device: a phone where it failed says "failed here".
    expect(largeModelStanding({ device: PHONE, largeFailedHere: true })).toBe('failed_here');
  });

  it('no WebGPU: the small model on every device (unchanged)', () => {
    for (const device of [DESKTOP_CHROMIUM, PHONE, DESKTOP_OTHER]) {
      const input = { largeSupported: false, device, largeFailedHere: false };
      expect(recommendedModel(input)).toBe('base');
      expect(preselectedModel({ ...input, baseReady: false, turboReady: true })).toBe('base');
    }
  });
});

describe('a failure of the large model that the small one may get past', () => {
  /** The phone's error as the engine raised it (14 Oct): an `Error`, stage `recognise`, the onnxruntime sentence. */
  const PHONE_ERROR = Object.assign(
    new Error(
      'failed to call OrtRun(). ERROR_CODE: 1, ERROR_MESSAGE: /onnxruntime/onnxruntime/core/providers/webgpu/buffer_manager.cc:418 void onnxruntime::webgpu::BufferManager::Download(WGPUBuffer, void *, size_t) const map_async_result.status == wgpu::MapAsyncStatus::Success was false.',
    ),
  );

  it('the phone’s error is recognised by its known sentence; the sentence itself is not kept', () => {
    expect(failureHint(PHONE_ERROR)).toBe('gpu_buffer_read');
    const detail = caughtFailureDetail(PHONE_ERROR, 'recognise');
    expect(detail).toMatchObject({ errorName: 'Error', stage: 'recognise', via: 'exception', hint: 'gpu_buffer_read' });
    expect(JSON.stringify(detail)).not.toMatch(/BufferManager|onnxruntime|map_async/);
    // onnxruntime's wrapper alone (its cause beyond the scanned part) is still named.
    expect(failureHint(new Error(`failed to call OrtRun(). ERROR_CODE: 1, ERROR_MESSAGE: ${'x'.repeat(600)}`))).toBe('ort_run_failed');
  });

  it('classifies what the detail says, and offers the small model for every unplanned failure of the large one', () => {
    const phone = caughtFailureDetail(PHONE_ERROR, 'recognise');
    expect(classifyLargeModelFailure('turbo', 'internal_error', phone)).toBe('gpu');
    expect(classifyLargeModelFailure('turbo', 'internal_error', { hint: 'gpu_or_context_lost', via: 'exception' })).toBe('gpu');
    expect(classifyLargeModelFailure('turbo', 'out_of_memory', null)).toBe('memory');
    expect(classifyLargeModelFailure('turbo', 'internal_error', { hint: 'out_of_memory' })).toBe('memory');
    expect(classifyLargeModelFailure('turbo', 'engine_unavailable')).toBe('engine');
    expect(classifyLargeModelFailure('turbo', 'internal_error', pageSideFailureDetail('stalled'))).toBe('stalled');
    expect(classifyLargeModelFailure('turbo', 'internal_error', pageSideFailureDetail('worker_error_event'))).toBe('crashed');
    expect(classifyLargeModelFailure('turbo', 'internal_error', pageSideFailureDetail('worker_message_error'))).toBe('crashed');
    // The test double's own error class, no hint: still the large model failing.
    expect(classifyLargeModelFailure('turbo', 'internal_error', caughtFailureDetail(new Error('x'), 'recognise'))).toBe('other');
    expect(classifyLargeModelFailure('turbo', 'internal_error')).toBe('other');
  });

  it('is not the large model’s fault: the small model, the video, missing files, a stop, a worker that never started', () => {
    expect(classifyLargeModelFailure('base', 'internal_error', caughtFailureDetail(PHONE_ERROR, 'recognise'))).toBeNull();
    for (const reason of ['no_audio', 'undecodable', 'unreadable', 'model_missing', 'canceled', 'worker_unavailable', 'nothing_heard']) {
      expect(classifyLargeModelFailure('turbo', reason), reason).toBeNull();
    }
  });
});

describe('what the screen says (plain words, both languages)', () => {
  const DEFAULT_PATH: MessageKey[] = [
    'transcript.model.baseRecommended',
    'transcript.model.turboPlain',
    'transcript.model.turboHint.phone',
    'transcript.model.turboHint.untested',
    'transcript.model.turboHint.failed_here',
    'transcript.model.largeSpace',
    'transcript.model.deleteLarge',
    'transcript.model.largeDeleted',
    'transcript.failed.large',
    'transcript.fallback.small',
    'transcript.fallback.smallDownload',
    'transcript.fallback.smallReady',
  ];

  it('no engineering word on the default path (the quality layer’s list)', () => {
    const found = DEFAULT_PATH.flatMap((key) => strongJargon(tr[key]).map((hit) => `${key}: ${hit.term} — “${hit.context}”`));
    expect(found).toEqual([]);
  });

  it('every sentence exists in English too, with the same placeholders', () => {
    for (const key of DEFAULT_PATH) {
      expect(en[key], key).toBeTruthy();
      expect(en[key].match(/\{\w+\}/g) ?? [], key).toEqual(tr[key].match(/\{\w+\}/g) ?? []);
    }
  });

  it('says plainly that the large model may not work on a phone and is large; the failure screen names the way forward', () => {
    expect(tr['transcript.model.turboHint.phone']).toMatch(/telefonda çalışmayabilir/);
    expect(tr['transcript.model.turboHint.phone']).toMatch(/büyük/);
    expect(tr['transcript.model.baseRecommended']).toMatch(/^Önerilen: küçük model/);
    expect(tr['transcript.model.turboPlain']).not.toMatch(/Önerilen/);
    expect(tr['transcript.fallback.small']).toBe('Küçük modelle dene');
    expect(tr['transcript.fallback.smallDownload']).toContain('{size}');
  });
});
