import { describe, expect, it } from 'vitest';

import {
  MIN_REENCODE_BITRATE,
  ORDINARY_BITRATE_MODE,
  SOFTWARE_ENCODER_BITRATE_FACTOR,
  SOURCE_BITRATE_HEADROOM,
  chooseBitrateMode,
  encoderVideoBitrate,
  sourceBoundedBitrate,
} from '@/domain/encoderBitrate';

describe('a re-encode is held to what the source itself has', () => {
  const plan720 = 2_488_320;
  const plan1080 = 5_598_720;

  it('camera footage (far more bits than the plan) keeps the plan bitrate exactly', () => {
    expect(sourceBoundedBitrate(plan720, 16_000_000)).toBe(plan720);
    expect(sourceBoundedBitrate(plan1080, 28_000_000)).toBe(plan1080);
    // Right at the edge: twice the source is the plan.
    expect(sourceBoundedBitrate(plan720, plan720 / SOURCE_BITRATE_HEADROOM)).toBe(plan720);
  });

  it('a small source is not blown up: at most twice its own bitrate', () => {
    // The finding: a 24 s 720p file of 0.47 MB is 157 kbit/s.
    const tiny = (470_000 * 8) / 24;
    expect(sourceBoundedBitrate(plan1080, tiny)).toBe(MIN_REENCODE_BITRATE);
    expect(sourceBoundedBitrate(plan1080, 1_000_000)).toBe(2_000_000);
    expect(sourceBoundedBitrate(plan720, 800_000)).toBe(1_600_000);
  });

  it('never goes under the floor and never over the plan', () => {
    for (const source of [1, 1000, 100_000, 250_000, 1_000_000, 3_000_000, 50_000_000]) {
      for (const plan of [MIN_REENCODE_BITRATE, plan720, plan1080, 12_000_000]) {
        const bounded = sourceBoundedBitrate(plan, source);
        expect(bounded).toBeLessThanOrEqual(plan);
        expect(bounded).toBeGreaterThanOrEqual(Math.min(plan, MIN_REENCODE_BITRATE));
      }
    }
  });

  it('an unknown source bitrate keeps the plan', () => {
    for (const unknown of [null, undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(sourceBoundedBitrate(plan720, unknown)).toBe(plan720);
    }
  });

  it('ADR-024 still applies on top: the software encoder gets 3× the bounded value', () => {
    expect(encoderVideoBitrate(sourceBoundedBitrate(plan1080, 1_000_000), 'software')).toBe(6_000_000);
    expect(encoderVideoBitrate(sourceBoundedBitrate(plan720, 16_000_000), 'software')).toBe(plan720 * 3);
  });
});

describe('encoder bitrate by encoder kind (ADR-024)', () => {
  it('leaves a hardware encoder exactly at the plan bitrate', () => {
    expect(encoderVideoBitrate(2_488_320, 'hardware')).toBe(2_488_320);
    expect(encoderVideoBitrate(5_598_720, 'hardware')).toBe(5_598_720);
  });

  it('gives the software encoder the measured 3x', () => {
    expect(SOFTWARE_ENCODER_BITRATE_FACTOR).toBe(3);
    expect(encoderVideoBitrate(2_488_320, 'software')).toBe(7_464_960);
    expect(encoderVideoBitrate(5_598_720, 'software')).toBe(16_796_160);
  });
});

describe('the rate control is settled before the encoder exists (ADR-045)', () => {
  it('an ordinary download asks the hardware encoder for constant, the software encoder for variable', () => {
    // docs/quality/2026-10-14-cbr.md: hardware passed the pre-registered rule on 9/9 cases, software did not.
    expect(ORDINARY_BITRATE_MODE).toEqual({ hardware: 'constant', software: 'variable' });
  });

  it('uses constant where the browser can encode that way, asking once for constant only', async () => {
    const asked: string[] = [];
    const choice = await chooseBitrateMode('constant', async (mode) => {
      asked.push(mode);
      return true;
    });
    expect(choice).toEqual({ asked: 'constant', used: 'constant' });
    expect(asked).toEqual(['constant']);
  });

  it('falls back to variable, and says so, where constant is refused', async () => {
    expect(await chooseBitrateMode('constant', async () => false)).toEqual({ asked: 'constant', used: 'variable' });
  });

  it('never ends the download: a question that throws or rejects is a refusal', async () => {
    expect(await chooseBitrateMode('constant', () => Promise.reject(new TypeError('unknown member')))).toEqual({
      asked: 'constant',
      used: 'variable',
    });
    expect(
      await chooseBitrateMode('constant', () => {
        throw new Error('synchronous');
      }),
    ).toEqual({ asked: 'constant', used: 'variable' });
  });

  it('variable is the default every encoder takes: nothing is asked', async () => {
    let calls = 0;
    const choice = await chooseBitrateMode('variable', async () => {
      calls += 1;
      return false;
    });
    expect(choice).toEqual({ asked: 'variable', used: 'variable' });
    expect(calls).toBe(0);
  });
});
