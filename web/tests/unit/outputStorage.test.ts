import { describe, expect, it } from 'vitest';

import {
  ENCODER_OVERSHOOT,
  FIXED_HEADROOM_BYTES,
  estimateOutputBytes,
  formatStorageBytes,
  hasRoomForOutput,
  nominalOutputBytes,
  requiredFreeBytes,
} from '@/domain/outputStorage';
import { WEB_LOCAL_POLICY } from '@/domain/policy';
import { US_PER_SECOND } from '@/domain/time';

const MIB = 1_048_576;
const GIB = 1_073_741_824;

/** 1080p30 as the render plan asks for it (videoBitrateFor): 5.6 Mbit/s + AAC. */
const P1080 = { videoBitrate: 5_598_720, audioBitrate: 128_000 };

describe('output size estimate (ADR-023)', () => {
  it('is the bitrates times the duration, in bytes', () => {
    expect(nominalOutputBytes({ ...P1080, durationUs: 10 * US_PER_SECOND })).toBe(((5_598_720 + 128_000) * 10) / 8);
    expect(nominalOutputBytes({ ...P1080, durationUs: 0 })).toBe(0);
  });

  it('adds the measured overshoot and a fixed headroom', () => {
    const input = { ...P1080, durationUs: 60 * US_PER_SECOND };
    expect(estimateOutputBytes(input)).toBe(
      Math.ceil(nominalOutputBytes(input) * ENCODER_OVERSHOOT + FIXED_HEADROOM_BYTES),
    );
  });

  it('covers every measured file (ADR-023 table)', () => {
    // [measured bytes, video bitrate asked for, output seconds]
    const measured: Array<[number, number, number]> = [
      [639_882_090, 5_598_720, 900], // Chrome, 15 min synthetic dense
      [1_890_859_801, 16_796_160, 900], // Chromium (software encoder), same
      [240_140_990, 5_598_720, 341.195], // Chrome, real iPhone 11 recording
      [717_156_896, 16_796_160, 341.195], // Chromium, same
      [63_458_931, 5_598_720, 88.67], // Chrome, real iPhone 13 Pro 60 fps
      [186_653_629, 16_796_160, 88.67], // Chromium, same
      [2447.1 * MIB, 5_598_720, 3600], // Chromium, 60 min (ADR-020)
      [870_261, 2_488_320, 1.770667], // Chrome, R15 1.8 s clip: 1.5x nominal
      [3_480_952, 2_488_320, 8], // Chrome, R04 8 s clip: 1.33x nominal
    ];
    for (const [bytes, videoBitrate, seconds] of measured) {
      const input = { videoBitrate, audioBitrate: 128_000, durationUs: seconds * US_PER_SECOND };
      expect(estimateOutputBytes(input)).toBeGreaterThan(bytes);
    }
  });

  it('asks for the file once, not twice: 60 minutes of 1080p needs about 2.7 GiB, not 6', () => {
    const hour = { ...P1080, durationUs: WEB_LOCAL_POLICY.maxOutputDurationUs };
    const required = requiredFreeBytes(hour);
    // The measured file was 2447 MiB (ADR-020); the old rule asked ~6.0 GiB.
    expect(required).toBeGreaterThan(2447 * MIB);
    expect(required).toBeLessThan(2.8 * GIB);
    const oldRule = nominalOutputBytes(hour) * 1.25 * 2;
    expect(oldRule / GIB).toBeGreaterThan(5.9);
    expect(required).toBeLessThan(oldRule * 0.47);
  });

  it('a short export needs only its headroom plus a little', () => {
    const required = requiredFreeBytes({ ...P1080, durationUs: 3 * US_PER_SECOND });
    expect(required).toBeGreaterThan(FIXED_HEADROOM_BYTES);
    expect(required).toBeLessThan(FIXED_HEADROOM_BYTES + 4 * MIB);
  });
});

describe('room check', () => {
  it('passes at exactly the requirement and refuses one byte below', () => {
    expect(hasRoomForOutput(1000, 1000)).toBe(true);
    expect(hasRoomForOutput(999, 1000)).toBe(false);
  });

  it('never passes on a broken estimate', () => {
    expect(hasRoomForOutput(Number.NaN, 1)).toBe(false);
    expect(hasRoomForOutput(Number.POSITIVE_INFINITY, 1)).toBe(false);
  });
});

describe('storage numbers in the message', () => {
  it('uses binary units; a need rounds up, the free space rounds down', () => {
    expect(formatStorageBytes(2.5 * GIB, 'up')).toBe('2.50 GiB');
    expect(formatStorageBytes(GIB, 'down')).toBe('1.00 GiB');
    expect(formatStorageBytes(2.501 * GIB, 'up')).toBe('2.51 GiB');
    expect(formatStorageBytes(2.509 * GIB, 'down')).toBe('2.50 GiB');
    expect(formatStorageBytes(40 * MIB, 'up')).toBe('40 MiB');
    expect(formatStorageBytes(40 * MIB + 1, 'up')).toBe('41 MiB');
    expect(formatStorageBytes(40 * MIB + 1, 'down')).toBe('40 MiB');
    expect(formatStorageBytes(0, 'down')).toBe('0 MiB');
    expect(formatStorageBytes(-1, 'up')).toBe('—');
  });
});
