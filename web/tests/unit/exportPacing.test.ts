import { describe, expect, it } from 'vitest';

import { MediaPacer } from '@/adapters/export/exportPacing';

async function settled(promise: Promise<void> | null): Promise<boolean> {
  if (promise === null) return true;
  let done = false;
  void promise.then(() => {
    done = true;
  });
  // Let resolved promise callbacks run.
  await Promise.resolve();
  await Promise.resolve();
  return done;
}

describe('MediaPacer', () => {
  it('lets audio run up to the lead ahead of the video, and no further', async () => {
    const pacer = new MediaPacer(1);
    expect(pacer.until(0.5)).not.toBeNull(); // nothing produced yet
    pacer.advance(0);
    expect(pacer.until(0.5)).toBeNull();
    expect(pacer.until(1)).toBeNull();
    const later = pacer.until(2.5);
    expect(await settled(later)).toBe(false);
    pacer.advance(1.4);
    expect(await settled(later)).toBe(false);
    pacer.advance(1.5);
    expect(await settled(later)).toBe(true);
  });

  it('releases only the waiters whose time has come, in any order', async () => {
    const pacer = new MediaPacer(0);
    const a = pacer.until(3);
    const b = pacer.until(1);
    pacer.advance(2);
    expect(await settled(b)).toBe(true);
    expect(await settled(a)).toBe(false);
    pacer.advance(1); // going back is ignored
    pacer.advance(3);
    expect(await settled(a)).toBe(true);
  });

  it('releases everything when the segment video is finished', async () => {
    const pacer = new MediaPacer(0.5);
    const waiting = pacer.until(100);
    pacer.finish();
    expect(await settled(waiting)).toBe(true);
    expect(pacer.until(1000)).toBeNull();
    expect(pacer.isStopped).toBe(false);
  });

  it('stop releases waiters and says the export is ending', async () => {
    const pacer = new MediaPacer(0.5);
    const waiting = pacer.until(10);
    pacer.stop();
    expect(await settled(waiting)).toBe(true);
    expect(pacer.isStopped).toBe(true);
  });
});
