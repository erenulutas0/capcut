import { describe, expect, it } from 'vitest';

import { createStageClock } from '@/adapters/export/exportProfile';

function fakeTime() {
  let t = 0;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe('createStageClock', () => {
  it('does nothing and reports nothing when disabled', () => {
    const clock = createStageClock(false);
    clock.mark();
    clock.lap('draw');
    clock.add('encode', 5);
    expect(clock.enabled).toBe(false);
    expect(clock.summary(10)).toBeNull();
  });

  it('attributes the time between marks to the named stage', () => {
    const time = fakeTime();
    const clock = createStageClock(true, time.now);
    time.advance(2);
    clock.lap('setup');
    for (let frame = 0; frame < 3; frame += 1) {
      time.advance(4);
      clock.lap('decodeWait');
      time.advance(1);
      clock.lap('draw');
      time.advance(frame === 1 ? 10 : 3);
      clock.lap('encode');
    }
    const summary = clock.summary(3);
    expect(summary).not.toBeNull();
    expect(summary!.wallMs).toBe(2 + 3 * 5 + 3 + 10 + 3);
    expect(summary!.stages.setup).toMatchObject({ totalMs: 2, count: 1, maxMs: 2 });
    expect(summary!.stages.decodeWait).toMatchObject({ totalMs: 12, count: 3, meanMs: 4 });
    expect(summary!.stages.draw).toMatchObject({ totalMs: 3, count: 3 });
    expect(summary!.stages.encode).toMatchObject({ totalMs: 16, count: 3, maxMs: 10 });
    expect(summary!.unattributedMs).toBe(0);
    expect(summary!.framesPerSecond).toBeCloseTo((3 * 1000) / 33, 1);
  });

  it('leaves time outside marks unattributed, and a mark restarts the interval', () => {
    const time = fakeTime();
    const clock = createStageClock(true, time.now);
    time.advance(7);
    clock.mark();
    time.advance(3);
    clock.lap('progress');
    clock.add('audioEncode', 5);
    const summary = clock.summary(0)!;
    expect(summary.stages.progress?.totalMs).toBe(3);
    expect(summary.stages.audioEncode?.totalMs).toBe(5);
    // 10 ms of wall time, 8 attributed (the added 5 ms ran "elsewhere").
    expect(summary.unattributedMs).toBe(2);
    expect(summary.framesPerSecond).toBe(0);
  });

  it('keeps a lane apart from the main marks but adds into the same totals', () => {
    const time = fakeTime();
    const clock = createStageClock(true, time.now);
    const lane = clock.lane();
    clock.mark();
    lane.mark();
    time.advance(2);
    lane.lap('audioMix');
    time.advance(3);
    clock.lap('encode'); // the main interval is not cut by the lane's lap
    lane.lap('audioEncode');
    const summary = clock.summary(1)!;
    expect(summary.stages.encode?.totalMs).toBe(5);
    expect(summary.stages.audioMix?.totalMs).toBe(2);
    expect(summary.stages.audioEncode?.totalMs).toBe(3);
    // Overlapping stages add up to more than the wall time; nothing is negative.
    expect(summary.unattributedMs).toBe(0);
  });

  it('gives a no-op lane when disabled', () => {
    const lane = createStageClock(false).lane();
    lane.mark();
    lane.lap('audioMix');
  });

  it('never counts negative durations', () => {
    const clock = createStageClock(true, () => 0);
    clock.add('draw', -3);
    expect(clock.summary(1)!.stages.draw).toMatchObject({ totalMs: 0, count: 1, maxMs: 0 });
  });
});
