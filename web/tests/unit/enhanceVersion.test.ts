import { describe, expect, it } from 'vitest';

import { ENHANCE_ENGINE_VERSION } from '@/domain/enhance';
import { ENHANCE_PLAN_VERSION } from '@/domain/enhanceVersion';

describe('enhance version in the render plan', () => {
  it('is the enhancement engine version (enhance.ts repeats it; it has no runtime imports)', () => {
    expect(ENHANCE_PLAN_VERSION).toBe(ENHANCE_ENGINE_VERSION);
  });
});
