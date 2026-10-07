import { describe, expect, it } from 'vitest';

import { SlidingAudio } from '@/adapters/transcript/slidingAudio';

/** A stream whose sample `n` has the value `n`: any slice shows where it came from. */
function chunk(first: number, length: number): Float32Array {
  return Float32Array.from({ length }, (_, i) => first + i);
}

describe('the stretch of the sound stream that is still needed', () => {
  it('gives back any stretch it holds, by stream position', () => {
    const sound = new SlidingAudio();
    sound.append(chunk(0, 1000), 0);
    sound.append(chunk(1000, 500), 1000);
    expect(sound.start).toBe(0);
    expect(sound.end).toBe(1500);
    expect(Array.from(sound.slice(990, 1010))).toEqual(Array.from(chunk(990, 20)));
    // Asking past either end gives what there is.
    expect(sound.slice(1400, 9999).length).toBe(100);
    expect(sound.slice(2000, 3000).length).toBe(0);
  });

  it('forgets what is behind, also when it is told before the samples arrive', () => {
    const sound = new SlidingAudio();
    sound.dropBefore(2500);
    sound.append(chunk(0, 1000), 0); // wholly before: not kept
    expect(sound.slice(0, 1000).length).toBe(0);
    sound.append(chunk(1000, 1000), 1000);
    sound.append(chunk(2000, 1000), 2000); // straddles: only the part from 2500 is kept
    expect(sound.start).toBe(2500);
    expect(sound.end).toBe(3000);
    expect(Array.from(sound.slice(2400, 2510))).toEqual(Array.from(chunk(2500, 10)));
    sound.append(chunk(3000, 2000), 3000);
    sound.dropBefore(4000);
    expect(sound.start).toBe(4000);
    expect(Array.from(sound.slice(3990, 4003))).toEqual([4000, 4001, 4002]);
    // Dropping backwards does nothing.
    sound.dropBefore(100);
    expect(sound.start).toBe(4000);
  });

  it('holds only what is needed over a long stream (memory stays bounded) and a slice is a copy', () => {
    const sound = new SlidingAudio();
    let position = 0;
    for (let k = 0; k < 2000; k += 1) {
      sound.append(chunk(position, 4096), position);
      position += 4096;
      sound.dropBefore(position - 30_000);
      expect(sound.end - sound.start).toBeLessThanOrEqual(30_000 + 4096);
    }
    const copy = sound.slice(position - 10, position);
    expect(Array.from(copy)).toEqual(Array.from(chunk(position - 10, 10)));
    copy[0] = -1;
    expect(sound.slice(position - 10, position)[0]).toBe(position - 10);
  });

  it('survives everything being dropped and the stream going on', () => {
    const sound = new SlidingAudio();
    sound.append(chunk(0, 100), 0);
    sound.dropBefore(100);
    expect(sound.end - sound.start).toBe(0);
    sound.append(chunk(100, 50), 100);
    expect(sound.start).toBe(100);
    expect(Array.from(sound.slice(100, 103))).toEqual([100, 101, 102]);
  });
});
