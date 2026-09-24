import { describe, expect, it } from 'vitest';

import { HdrClipper, type HdrClipRequest, type HdrClipResponse } from '@/adapters/export/hdrClip';
import { softClipHalfToRgba8 } from '@/domain/hdr';

/** A stand-in for the helper thread: same function, answers asynchronously. */
class FakeHelper {
  onmessage: ((message: MessageEvent<HdrClipResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  terminated = false;
  received = 0;
  constructor(private readonly behaviour: 'ok' | 'wrong' | 'silent' | 'fail' = 'ok') {}
  postMessage(request: HdrClipRequest): void {
    this.received += 1;
    if (this.behaviour === 'silent') return;
    queueMicrotask(() => {
      const target = new Uint8ClampedArray(request.out);
      if (this.behaviour === 'wrong') target.fill(7);
      else softClipHalfToRgba8(new Uint16Array(request.half, request.offset, request.length), target);
      const response: HdrClipResponse =
        this.behaviour === 'fail' && this.received > 1 ? { id: request.id, out: request.out, failed: true } : { id: request.id, out: request.out };
      this.onmessage?.({ data: response } as MessageEvent<HdrClipResponse>);
    });
  }
  terminate(): void {
    this.terminated = true;
  }
}

const halves = (values: number[]) => new Uint16Array(values);

function expected(bits: Uint16Array): Uint8ClampedArray {
  const target = new Uint8ClampedArray(bits.length);
  softClipHalfToRgba8(bits, target);
  return target;
}

describe('HdrClipper (ADR-028)', () => {
  it('proves the helper, then returns exactly the in-thread clip, in order', async () => {
    const helper = new FakeHelper();
    const clipper = new HdrClipper(8, () => helper as unknown as Worker);
    expect(await clipper.ready()).toBe(true);
    expect(clipper.threaded).toBe(true);
    const a = halves([0x3800, 0x3400, 0x3a00, 0x3c00, 0x3c66, 0x3800, 0x3000, 0x3c00]);
    const b = halves([0x3c33, 0x3c00, 0x3b00, 0x3c00, 0x0000, 0x8001, 0x7e00, 0x3c00]);
    const wantA = expected(a.slice());
    const wantB = expected(b.slice());
    const first = clipper.clip({ kind: 'half', bits: a });
    const second = clipper.clip({ kind: 'half', bits: b });
    expect([...(await first)]).toEqual([...wantA]);
    expect([...(await second)]).toEqual([...wantB]);
    clipper.close();
    expect(helper.terminated).toBe(true);
  });

  it('reuses returned buffers for the next frames', async () => {
    const clipper = new HdrClipper(4, () => new FakeHelper() as unknown as Worker);
    await clipper.ready();
    const out = await clipper.clip({ kind: 'half', bits: halves([0x3800, 0x3800, 0x3800, 0x3c00]) });
    clipper.recycle(out);
    const again = await clipper.clip({ kind: 'half', bits: halves([0x3400, 0x3400, 0x3400, 0x3c00]) });
    expect(again.buffer).toBe(out.buffer);
    expect([...again]).toEqual([64, 64, 64, 255]);
  });

  it('clips in this thread when the helper cannot start, answers wrongly or not at all', async () => {
    for (const make of [
      () => {
        throw new Error('no nested workers');
      },
      () => new FakeHelper('wrong') as unknown as Worker,
      () => new FakeHelper('silent') as unknown as Worker,
    ]) {
      const clipper = new HdrClipper(4, make);
      expect(await clipper.ready(20)).toBe(false);
      expect(clipper.threaded).toBe(false);
      const bits = halves([0x3800, 0x3400, 0x3a00, 0x3c00]);
      const want = expected(bits.slice());
      expect([...(await clipper.clip({ kind: 'half', bits }))]).toEqual([...want]);
      clipper.close();
    }
  });

  it('clips a non-half read-back in this thread with the float loop', async () => {
    const helper = new FakeHelper();
    const clipper = new HdrClipper(4, () => helper as unknown as Worker);
    await clipper.ready();
    const out = await clipper.clip({ kind: 'float', values: [0.5, 0.25, 0.75, 1] });
    expect([...out]).toEqual([128, 64, 191, 255]);
    expect(helper.received).toBe(1); // only the readiness check
  });

  it('rejects a frame the helper failed, so the export stops instead of guessing', async () => {
    const clipper = new HdrClipper(4, () => new FakeHelper('fail') as unknown as Worker);
    expect(await clipper.ready()).toBe(true);
    await expect(clipper.clip({ kind: 'half', bits: halves([0x3800, 0x3800, 0x3800, 0x3c00]) })).rejects.toThrow();
  });
});
