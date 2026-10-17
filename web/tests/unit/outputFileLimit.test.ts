import { describe, expect, it } from 'vitest';

import { encoderVideoBitrate, sourceBoundedBitrate } from '@/domain/encoderBitrate';
import {
  ENCODER_OVERSHOOT,
  FAT32_MAX_FILE_BYTES,
  FIXED_HEADROOM_BYTES,
  OUTPUT_FILE_LIMIT_BYTES,
  estimateOutputBytes,
  fileLimitedVideoBitrate,
  longestOutputThatFits,
  maxVideoBitrateForFileLimit,
  requiredFreeBytes,
  storageFitSuggestion,
  withinFileLimit,
} from '@/domain/outputStorage';
import { WEB_LOCAL_POLICY } from '@/domain/policy';
import { videoBitrateFor } from '@/domain/renderPlan';
import { US_PER_SECOND } from '@/domain/time';
import { storageRefusalText } from '@/components/editor/outputLimitText';
import { tr, type MessageKey } from '@/i18n/messages';
import { en } from '@/i18n/messages.en';

const MIB = 1_048_576;
const GIB = 1_073_741_824;
const MINUTE = 60 * US_PER_SECOND;
const HOUR = WEB_LOCAL_POLICY.maxOutputDurationUs;
const AUDIO = 128_000;

const plan1080 = videoBitrateFor(1920, 1080, 30);
const plan720 = videoBitrateFor(1280, 720, 30);
const software1080 = encoderVideoBitrate(plan1080, 'software');

describe('the largest download (17 Oct 2026)', () => {
  it('is one byte under 4 GiB: it opens again in LiloCut and fits on FAT32', () => {
    expect(OUTPUT_FILE_LIMIT_BYTES).toBe(4 * GIB - 1);
    expect(FAT32_MAX_FILE_BYTES).toBe(4 * GIB - 1);
    expect(OUTPUT_FILE_LIMIT_BYTES).toBeLessThanOrEqual(WEB_LOCAL_POLICY.maxTotalSourceBytes);
    expect(withinFileLimit(4 * GIB - 1)).toBe(true);
    expect(withinFileLimit(4 * GIB)).toBe(false);
    expect(withinFileLimit(Number.NaN)).toBe(false);
  });

  it('60 minutes of 1080p on the software encoder is held to ~8.48 Mbit/s; the estimate then stays under the limit', () => {
    expect(software1080).toBe(16_796_160);
    const input = { audioBitrate: AUDIO, durationUs: HOUR };
    const held = fileLimitedVideoBitrate(software1080, input);
    expect(held).toBeGreaterThan(8_480_000);
    expect(held).toBeLessThan(8_481_000);
    // Before: the estimate (and the file, 7.1 GiB at 16.8 Mbit/s) were far over 4 GiB.
    expect(estimateOutputBytes({ videoBitrate: software1080, ...input })).toBeGreaterThan(7 * GIB);
    expect(estimateOutputBytes({ videoBitrate: held, ...input })).toBeLessThanOrEqual(OUTPUT_FILE_LIMIT_BYTES);
    // One bit/s more would not be (the hold is the largest that fits, to within its 1 bit/s margin).
    expect(estimateOutputBytes({ videoBitrate: held + 3, ...input })).toBeGreaterThan(OUTPUT_FILE_LIMIT_BYTES);
    // The planned (nominal) file: (4 GiB − 1 − 32 MiB) / 1.1, about 3.61 GiB.
    const nominal = ((held + AUDIO) * 3600) / 8;
    expect(nominal / GIB).toBeGreaterThan(3.6);
    expect(nominal / GIB).toBeLessThan(3.61);
    expect(nominal).toBeLessThanOrEqual((OUTPUT_FILE_LIMIT_BYTES - FIXED_HEADROOM_BYTES) / ENCODER_OVERSHOOT);
  });

  it('the soak case: the 4958 MiB file (source-bounded 3×, 11.4 Mbit/s) comes back under 4 GiB', () => {
    // long-120min-1080p-3600s.mp4: 817.6 MiB over 3600 s.
    const sourceBitrate = (817.6 * MIB * 8) / 3600;
    const asked = encoderVideoBitrate(sourceBoundedBitrate(plan1080, sourceBitrate), 'software');
    expect(asked / 1e6).toBeCloseTo(11.43, 1);
    // Written ÷ asked in that run: 4958 MiB of file for 11.43 + 0.128 Mbit/s asked.
    const writtenOverAsked = (4958 * MIB) / (((asked + AUDIO) * 3600) / 8);
    expect(writtenOverAsked).toBeGreaterThan(0.99);
    expect(writtenOverAsked).toBeLessThan(1.01);
    const held = fileLimitedVideoBitrate(asked, { audioBitrate: AUDIO, durationUs: HOUR });
    expect(held).toBeLessThan(asked);
    // With the same written ÷ asked the file lands at ~3.61 GiB, ~400 MiB under the limit;
    // the ADR-023 allowance (1.1) is what an encoder may overshoot by before it reaches it.
    const expectedFile = (((held + AUDIO) * 3600) / 8) * writtenOverAsked;
    expect(expectedFile / GIB).toBeLessThan(3.65);
    expect(expectedFile).toBeLessThan(OUTPUT_FILE_LIMIT_BYTES);
  });

  it('short and ordinary outputs are untouched: wherever the estimate already fits, the bitrate is the same', () => {
    const rates = [500_000, plan720, plan1080, 12_000_000, encoderVideoBitrate(plan720, 'software'), software1080, 36_000_000];
    for (const rate of rates) {
      for (let minutes = 0.05; minutes <= 60; minutes += 0.25) {
        const input = { audioBitrate: AUDIO, durationUs: Math.round(minutes * MINUTE) };
        const fits = estimateOutputBytes({ videoBitrate: rate, ...input }) <= OUTPUT_FILE_LIMIT_BYTES;
        const held = fileLimitedVideoBitrate(rate, input);
        if (fits) expect(held).toBe(rate);
        else expect(held).toBeLessThan(rate);
        // Never over, never above what was asked.
        expect(held).toBeLessThanOrEqual(rate);
        expect(estimateOutputBytes({ videoBitrate: held, ...input })).toBeLessThanOrEqual(OUTPUT_FILE_LIMIT_BYTES);
      }
    }
  });

  it('a hardware encoder at 1080p30 is never held inside the 60-minute output limit; the software one past ~30 minutes', () => {
    const input = (durationUs: number) => ({ audioBitrate: AUDIO, durationUs });
    expect(fileLimitedVideoBitrate(plan1080, input(HOUR))).toBe(plan1080);
    expect(fileLimitedVideoBitrate(software1080, input(30 * MINUTE))).toBe(software1080);
    expect(fileLimitedVideoBitrate(software1080, input(31 * MINUTE))).toBeLessThan(software1080);
    // 720p on the software encoder (7.46 Mbit/s) fits a whole hour.
    const software720 = encoderVideoBitrate(plan720, 'software');
    expect(fileLimitedVideoBitrate(software720, input(HOUR))).toBe(software720);
  });

  it('an empty output is not held; a smaller limit (the measurement hook) holds more', () => {
    expect(maxVideoBitrateForFileLimit({ audioBitrate: AUDIO, durationUs: 0 })).toBe(Number.POSITIVE_INFINITY);
    const input = { audioBitrate: AUDIO, durationUs: 5 * MINUTE };
    expect(fileLimitedVideoBitrate(software1080, input)).toBe(software1080);
    // The limit that holds 5 minutes to exactly what 60 minutes get with the real one.
    const hourHeld = fileLimitedVideoBitrate(software1080, { audioBitrate: AUDIO, durationUs: HOUR });
    const scaled = Math.ceil((((hourHeld + 2 + AUDIO) * 300) / 8) * ENCODER_OVERSHOOT + FIXED_HEADROOM_BYTES);
    const held5 = fileLimitedVideoBitrate(software1080, input, scaled);
    expect(Math.abs(held5 - hourHeld)).toBeLessThanOrEqual(4);
    expect(maxVideoBitrateForFileLimit(input, MIB)).toBe(0);
  });
});

describe('what fits on a disk without room for the whole download', () => {
  const hardware1080 = { videoBitrate: plan1080, audioBitrate: AUDIO };

  it('is the longest whole-second output whose requirement fits, by the reservation rule itself', () => {
    for (const room of [40 * MIB, 300 * MIB, 1500 * MIB, 2 * GIB]) {
      const fit = longestOutputThatFits(room, hardware1080, HOUR);
      expect(fit % US_PER_SECOND).toBe(0);
      expect(requiredFreeBytes({ ...hardware1080, durationUs: fit })).toBeLessThanOrEqual(room);
      expect(requiredFreeBytes({ ...hardware1080, durationUs: fit + US_PER_SECOND })).toBeGreaterThan(room);
    }
  });

  it('the long-export report case: 1500 MiB of room holds ~32 minutes of 1080p, not "5 minutes"', () => {
    const fit = longestOutputThatFits(1500 * MIB, hardware1080, HOUR);
    expect(fit / MINUTE).toBeGreaterThan(31);
    expect(fit / MINUTE).toBeLessThan(33);
  });

  it('a shorter output keeps its unheld bitrate; a disk with room for the held hour gets the whole hour', () => {
    const software = { videoBitrate: software1080, audioBitrate: AUDIO };
    // 3 GiB of room: the unheld 16.8 Mbit/s fits ~22.8 minutes; the held hour needs ~4 GiB.
    const fit = longestOutputThatFits(3 * GIB, software, HOUR);
    expect(fit / MINUTE).toBeGreaterThan(22);
    expect(fit / MINUTE).toBeLessThan(24);
    expect(longestOutputThatFits(4.2 * GIB, software, HOUR)).toBe(HOUR);
  });

  it('nothing, or nothing known, fits nothing', () => {
    expect(longestOutputThatFits(0, hardware1080, HOUR)).toBe(0);
    expect(longestOutputThatFits(Number.NaN, hardware1080, HOUR)).toBe(0);
    expect(longestOutputThatFits(Number.POSITIVE_INFINITY, hardware1080, HOUR)).toBe(0);
    // Under the fixed 32 MiB headroom not even a second fits.
    expect(longestOutputThatFits(30 * MIB, hardware1080, HOUR)).toBe(0);
  });

  it('the suggestion: the disk fit, or the memory route where it is open; whole minutes, or seconds under one', () => {
    const output = 60 * MINUTE;
    const memory = WEB_LOCAL_POLICY.maxMemoryRouteOutputDurationUs;
    // Save-dialog route: only the disk counts.
    expect(storageFitSuggestion({ fitUs: 32 * MINUTE + 40 * US_PER_SECOND, memoryRouteUs: null, outputUs: output })).toBe(32 * MINUTE);
    expect(storageFitSuggestion({ fitUs: 45 * US_PER_SECOND, memoryRouteUs: null, outputUs: output })).toBe(45 * US_PER_SECOND);
    expect(storageFitSuggestion({ fitUs: 0, memoryRouteUs: null, outputUs: output })).toBeNull();
    expect(storageFitSuggestion({ fitUs: null, memoryRouteUs: null, outputUs: output })).toBeNull();
    // Browser's own disk: a short output still goes to memory.
    expect(storageFitSuggestion({ fitUs: 30 * US_PER_SECOND, memoryRouteUs: memory, outputUs: output })).toBe(memory);
    expect(storageFitSuggestion({ fitUs: 20 * MINUTE, memoryRouteUs: memory, outputUs: output })).toBe(20 * MINUTE);
    expect(storageFitSuggestion({ fitUs: null, memoryRouteUs: memory, outputUs: output })).toBe(memory);
    // Always shorter than what was refused.
    expect(storageFitSuggestion({ fitUs: null, memoryRouteUs: memory, outputUs: 5 * MINUTE + 10 * US_PER_SECOND })).toBe(memory);
    expect(storageFitSuggestion({ fitUs: 10 * MINUTE, memoryRouteUs: null, outputUs: 10 * MINUTE })).toBe(9 * MINUTE);
  });
});

describe('the sentence', () => {
  const t = (key: MessageKey) => tr[key];
  const e = (key: MessageKey) => en[key];

  it('says the length that fits, in whole minutes or seconds (TR + EN)', () => {
    expect(storageRefusalText(t, 20 * MINUTE)).toBe(
      'Bu uzunlukta bir video için boş disk alanı yetmiyor. Diskte yer aç ya da en fazla 20 dakikalık bir kesit indir; hiçbir kare kodlanmadı.',
    );
    expect(storageRefusalText(t, MINUTE)).toContain('en fazla 1 dakikalık bir kesit');
    expect(storageRefusalText(t, 45 * US_PER_SECOND)).toContain('en fazla 45 saniyelik bir kesit');
    expect(storageRefusalText(e, 20 * MINUTE)).toBe(
      'There is not enough free disk space for a video this long. Free some disk space or download a clip of at most 20 minutes; no frame was encoded.',
    );
    expect(storageRefusalText(e, MINUTE)).toContain('at most 1 minute;');
    expect(storageRefusalText(e, US_PER_SECOND)).toContain('at most 1 second;');
    expect(storageRefusalText(e, 45 * US_PER_SECOND)).toContain('at most 45 seconds;');
  });

  it('without an honest number it gives none', () => {
    for (const none of [null, undefined, 0, Number.NaN]) {
      expect(storageRefusalText(t, none)).toBe(
        'Bu uzunlukta bir video için boş disk alanı yetmiyor. Diskte yer açıp yeniden dene; hiçbir kare kodlanmadı.',
      );
      expect(storageRefusalText(e, none)).not.toMatch(/\d/);
      expect(storageRefusalText(t, none)).not.toMatch(/\d/);
    }
  });

  it('the size refusals name the limit the app itself opens (4 GiB, said as 4,29 GB)', () => {
    expect(tr['export.fail.output_too_large']).toContain('4,29 GB');
    expect(en['export.fail.output_too_large']).toContain('4.29 GB');
    expect(tr['export.why.output_size']).toContain('4,29 GB');
    expect(en['export.why.output_size']).toContain('4.29 GB');
  });
});
