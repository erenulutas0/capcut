import { VideoSampleSink } from 'mediabunny';
import { describe, expect, it } from 'vitest';

import { DecoderHoldUnavailable, holdDecoder } from '@/adapters/export/decoderHold';

/** Stands in for mediabunny's decoder wrapper: records when it is really closed. */
function fakeSink() {
  const wrappers: { closed: boolean; decoder: { state: string }; close(): void }[] = [];
  const sink = {
    _track: 'track',
    async _createDecoder(this: { _track: string }) {
      // The factory runs as a method of the sink, as mediabunny calls it.
      expect(this._track).toBe('track');
      const wrapper = {
        closed: false,
        decoder: { state: 'configured' },
        close() {
          this.closed = true;
          this.decoder.state = 'closed';
        },
      };
      wrappers.push(wrapper);
      return wrapper;
    },
  };
  return { sink, wrappers };
}

type Factory = () => Promise<{ close(): void }>;

describe('holdDecoder (ADR-033)', () => {
  it('defers the sink closing its decoder until release', async () => {
    const { sink, wrappers } = fakeSink();
    const hold = holdDecoder(sink);
    const wrapper = await (sink._createDecoder as unknown as Factory).call(sink);

    // The decode pass ends: mediabunny closes its decoder right after the flush.
    wrapper.close();
    expect(hold.closeRequested).toBe(true);
    expect(wrappers[0]?.closed).toBe(false);
    expect(hold.decoderClosed()).toBe(false);

    hold.release();
    expect(wrappers[0]?.closed).toBe(true);
    // Releasing twice closes nothing twice.
    hold.release();
  });

  it('closes at once once released', async () => {
    const { sink, wrappers } = fakeSink();
    const hold = holdDecoder(sink);
    hold.release();
    const wrapper = await (sink._createDecoder as unknown as Factory).call(sink);
    wrapper.close();
    expect(wrappers[0]?.closed).toBe(true);
  });

  it('holds every decoder the sink makes', async () => {
    const { sink, wrappers } = fakeSink();
    const hold = holdDecoder(sink);
    const factory = sink._createDecoder as unknown as Factory;
    (await factory.call(sink)).close();
    (await factory.call(sink)).close();
    expect(wrappers.map((w) => w.closed)).toEqual([false, false]);
    hold.release();
    expect(wrappers.map((w) => w.closed)).toEqual([true, true]);
  });

  it('says so when a held decoder was closed anyway (an error, the browser reclaiming it)', async () => {
    const { sink, wrappers } = fakeSink();
    const hold = holdDecoder(sink);
    await (sink._createDecoder as unknown as Factory).call(sink);
    expect(hold.decoderClosed()).toBe(false);
    const inner = wrappers[0];
    if (inner) inner.decoder.state = 'closed';
    expect(hold.decoderClosed()).toBe(true);
  });

  it('refuses a sink without the factory instead of exporting without the hold', () => {
    expect(() => holdDecoder({})).toThrow(DecoderHoldUnavailable);
  });

  it("finds mediabunny's own decoder factory (fails when an upgrade removes it)", () => {
    const prototype = VideoSampleSink.prototype as unknown as { _createDecoder?: unknown };
    expect(typeof prototype._createDecoder).toBe('function');
  });
});
