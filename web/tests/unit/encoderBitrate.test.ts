import { describe, expect, it } from 'vitest';

import { SOFTWARE_ENCODER_BITRATE_FACTOR, encoderVideoBitrate } from '@/domain/encoderBitrate';

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
