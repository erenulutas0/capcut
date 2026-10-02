/**
 * Keeps the decoder behind a mediabunny `VideoSampleSink` open until the
 * export has used every frame it delivered (ADR-033).
 *
 * `VideoSampleSink.samples()` decodes ahead of its consumer: up to 8 decoded
 * frames wait in its queue. When the range's packets run out it flushes the
 * decoder and then closes it at once, while those frames are still waiting.
 * On a desktop browser a delivered `VideoFrame` owns its picture, so nothing
 * changes. Chrome on Android (measured on a Galaxy S23, Chrome 154) backs a
 * frame with the hardware decoder's own output buffer until the frame is
 * first drawn; closing the decoder releases those buffers, and every frame
 * not drawn by then draws as the last picture that was — stale, with a
 * perfect timestamp. That was the frozen tail of every full-encode kesit on
 * the phone. A flush alone does not do it: frames held through a flush and
 * drawn before the close were right (scripts/android/decode-probe.mjs).
 *
 * The hold wraps the sink's decoder factory so the sink's own `close()` is
 * deferred until `release()`; the export releases after the moment's last
 * frame is drawn. A decoder that closes by itself (an error, the browser
 * reclaiming it) cannot be held: `decoderClosed()` then says so, and frames
 * drawn after it are counted as missing, never as real.
 *
 * `_createDecoder` is mediabunny's internal factory (1.58.1, pinned). The
 * unit test fails if a mediabunny upgrade removes it; `holdDecoder` throws
 * rather than export without the hold.
 */

/** The parts of mediabunny's decoder wrapper the hold touches. */
interface DecoderWrapperLike {
  close(): void;
  /** The WebCodecs decoder inside (mediabunny's field); absent for a custom decoder. */
  decoder?: { state?: string } | null;
}

type DecoderFactory = (...args: never[]) => Promise<DecoderWrapperLike>;

export interface DecoderHold {
  /** True once the sink asked to close its decoder (the decode pass is over). */
  readonly closeRequested: boolean;
  /** True when a held decoder was closed anyway: its undrawn frames are not trustworthy. */
  decoderClosed(): boolean;
  /** Closes what the sink wanted closed, and lets later decoders close at once. */
  release(): void;
}

export class DecoderHoldUnavailable extends Error {
  constructor() {
    super('decoder hold unavailable');
    this.name = 'DecoderHoldUnavailable';
  }
}

/** Installs the hold on `sink` (a `VideoSampleSink`); call before `samples()`. */
export function holdDecoder(sink: object): DecoderHold {
  const internals = sink as { _createDecoder?: DecoderFactory };
  const create = internals._createDecoder;
  if (typeof create !== 'function') throw new DecoderHoldUnavailable();

  const wrappers: DecoderWrapperLike[] = [];
  const deferred: (() => void)[] = [];
  let released = false;
  let closeRequested = false;

  internals._createDecoder = async (...args: Parameters<DecoderFactory>) => {
    const wrapper = await create.apply(sink, args);
    const close = wrapper.close.bind(wrapper);
    wrapper.close = () => {
      closeRequested = true;
      if (released) close();
      else deferred.push(close);
    };
    wrappers.push(wrapper);
    return wrapper;
  };

  return {
    get closeRequested() {
      return closeRequested;
    },
    decoderClosed() {
      return !released && wrappers.some((wrapper) => wrapper.decoder?.state === 'closed');
    },
    release() {
      if (released) return;
      released = true;
      for (const close of deferred.splice(0)) close();
    },
  };
}
