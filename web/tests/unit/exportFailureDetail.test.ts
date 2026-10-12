import { describe, expect, it } from 'vitest';

import { stageOf, staged, stagedIterable, tagStage } from '@/adapters/export/failureStage';
import {
  EXPORT_STAGES,
  KNOWN_ERROR_NAMES,
  failureDetailLine,
  failureHint,
  pageSideFailureDetail,
  safeErrorName,
  sanitizeCodecUse,
  sanitizeExportFailureDetail,
  type ExportFailureDetail,
} from '@/domain/exportFailureDetail';

/** What an error could say about a user's video. None of it may ever be kept. */
const PRIVATE = ['aile-tatili-antalya-2025.mp4', 'C:\\Users\\ayse\\Videos', 'Doğum günün kutlu olsun', 'blob:https://lilocut.example/1f2e'];

class NamedError extends Error {
  constructor(name: string, message: string) {
    super(message);
    this.name = name;
  }
}

const full: ExportFailureDetail = {
  errorName: 'EncodingError',
  stage: 'encode',
  via: 'exception',
  hint: 'encoding_error',
  phase: 'encoding',
  framesDone: 12,
  totalFrames: 7590,
  videoPacketsOut: 9,
  videoEncoder: { codec: 'avc1.640028', hardwareAcceleration: 'no-preference' },
  hardwareEncoderAvailable: true,
  videoDecoder: { codec: 'avc1.64001f', hardwareAcceleration: 'prefer-software' },
  audioEncoder: { codec: 'mp4a.40.2', hardwareAcceleration: 'no-preference' },
  route: 'file',
  pageWasHidden: true,
  attemptInSession: 0,
};

describe('safeErrorName', () => {
  it('keeps the names WebCodecs and the file system really use', () => {
    for (const name of ['EncodingError', 'InvalidStateError', 'NotSupportedError', 'DataError', 'OperationError', 'TypeError', 'AbortError', 'QuotaExceededError', 'NotReadableError', 'NoModificationAllowedError']) {
      expect(safeErrorName(new NamedError(name, 'x'))).toBe(name);
    }
    expect(safeErrorName(new TypeError('x'))).toBe('TypeError');
    expect(safeErrorName(new DOMException('x', 'EncodingError'))).toBe('EncodingError');
  });

  it('turns a name that is not on the list into "Other" — a name is not trusted to be only a name', () => {
    for (const secret of PRIVATE) expect(safeErrorName(new NamedError(secret, 'x'))).toBe('Other');
    expect(safeErrorName(new NamedError('SomeLibraryError', 'x'))).toBe('Other');
    expect(safeErrorName({ name: 42 })).toBe('Other');
    expect(safeErrorName({})).toBe('Other');
  });

  it('says so when what was thrown is not an error object, and survives a name that throws', () => {
    expect(safeErrorName('a string was thrown: tatil.mp4')).toBe('NonError');
    expect(safeErrorName(undefined)).toBe('NonError');
    expect(safeErrorName(null)).toBe('NonError');
    const hostile = Object.defineProperty({}, 'name', {
      get() {
        throw new Error('no');
      },
    });
    expect(safeErrorName(hostile)).toBe('Other');
  });

  it('every name on the list looks like a class name (no room for a path or a sentence)', () => {
    for (const name of KNOWN_ERROR_NAMES) expect(name).toMatch(/^[A-Z][A-Za-z]{2,31}$/);
  });
});

describe('failureHint', () => {
  it('names the known sentences of the browser and the media library', () => {
    expect(failureHint(new DOMException('Codec reclaimed due to inactivity.', 'QuotaExceededError'))).toBe('codec_reclaimed');
    expect(failureHint(new DOMException('Encoding error.', 'EncodingError'))).toBe('encoding_error');
    expect(failureHint(new DOMException('Decoding error.', 'EncodingError'))).toBe('decoding_error');
    expect(failureHint(new DOMException('Encoder creation error.', 'OperationError'))).toBe('encoder_creation');
    expect(failureHint(new DOMException('Unsupported configuration.', 'NotSupportedError'))).toBe('unsupported_config');
    expect(
      failureHint(new Error('This specific encoder configuration (avc1.640028, 4000000 bps, 1280x720, hardware acceleration: no-preference) is not supported in this environment.')),
    ).toBe('encoder_config_unsupported');
    expect(failureHint(new Error('Assertion failed.'))).toBe('assertion');
    expect(failureHint(new Error('something nobody has seen yet'))).toBeNull();
    expect(failureHint('Encoding error')).toBeNull();
    expect(failureHint({ message: 7 })).toBeNull();
  });

  it('returns a label from its own list, never a piece of the message', () => {
    for (const secret of PRIVATE) {
      for (const sentence of [`Encoding error in ${secret}`, `Failed to decode ${secret}`, `The file ${secret} could not be read`, `${secret}`]) {
        const hint = failureHint(new Error(sentence));
        if (hint !== null) {
          expect(hint).toMatch(/^[a-z_]{3,40}$/);
          expect(secret).not.toContain(hint);
        }
      }
    }
  });
});

describe('sanitizeExportFailureDetail', () => {
  it('keeps a complete detail as it is', () => {
    expect(sanitizeExportFailureDetail(full)).toEqual(full);
    // And only these fields exist: a new field has to be added here, on purpose.
    expect(Object.keys(sanitizeExportFailureDetail(full) ?? {}).sort()).toEqual(
      [
        'attemptInSession',
        'audioEncoder',
        'errorName',
        'framesDone',
        'hardwareEncoderAvailable',
        'hint',
        'pageWasHidden',
        'phase',
        'route',
        'stage',
        'totalFrames',
        'via',
        'videoDecoder',
        'videoEncoder',
        'videoPacketsOut',
      ].sort(),
    );
  });

  it('lets nothing private through, whichever field it is put into', () => {
    const fields = Object.keys(full) as (keyof ExportFailureDetail)[];
    for (const secret of PRIVATE) {
      for (const field of fields) {
        const poisoned = { ...full, [field]: secret, message: secret, stack: secret, fileName: secret, cause: { message: secret } };
        const json = JSON.stringify(sanitizeExportFailureDetail(poisoned));
        expect(json, `${field} = ${secret}`).not.toContain(secret);
        expect(json).not.toContain(JSON.stringify(secret).slice(1, -1));
      }
      // Inside the codec objects too.
      for (const codecField of ['videoEncoder', 'videoDecoder', 'audioEncoder'] as const) {
        const poisoned = { ...full, [codecField]: { codec: secret, hardwareAcceleration: secret, extra: secret } };
        const json = JSON.stringify(sanitizeExportFailureDetail(poisoned));
        expect(json).not.toContain(secret);
        expect(json).not.toContain(JSON.stringify(secret).slice(1, -1));
      }
    }
  });

  it('answers null for something that is not an object, and "unknown" for what it cannot read', () => {
    expect(sanitizeExportFailureDetail(null)).toBeNull();
    expect(sanitizeExportFailureDetail(undefined)).toBeNull();
    expect(sanitizeExportFailureDetail('EncodingError')).toBeNull();
    expect(sanitizeExportFailureDetail({})).toEqual({
      errorName: 'Other',
      stage: 'unknown',
      via: 'exception',
      hint: null,
      phase: null,
      framesDone: null,
      totalFrames: null,
      videoPacketsOut: null,
      videoEncoder: null,
      hardwareEncoderAvailable: null,
      videoDecoder: null,
      audioEncoder: null,
      route: null,
      pageWasHidden: null,
      attemptInSession: null,
    });
  });

  it('accepts codec strings and nothing that could be a path, a URL or a sentence', () => {
    for (const codec of ['avc1.640028', 'avc1.42001f', 'mp4a.40.2', 'hev1.1.6.L93.B0', 'vp09.00.10.08', 'opus', 'av01.0.04M.08']) {
      expect(sanitizeCodecUse({ codec })).toEqual({ codec, hardwareAcceleration: 'no-preference' });
    }
    // Among them names made only of letters, digits, dots and dashes — what a looser rule would let through.
    for (const bad of ['', 'a b', 'C:\\x.mp4', '/home/x', 'tatil videosu.mp4', 'blob:https://x/y', 'x'.repeat(41), '.mp4', 'a/b', 'ğ', 'tatil-2025.mp4', 'avc1.mp4', 'opus.mp4', 'mp4a.tatil', 'hev1.mp4', 'video', 'avc', 'aile-tatili-antalya-2025.mp4']) {
      expect(sanitizeCodecUse({ codec: bad }), bad).toBeNull();
    }
    expect(sanitizeCodecUse({ codec: 'avc1.640028', hardwareAcceleration: 'prefer-hardware' })?.hardwareAcceleration).toBe('prefer-hardware');
    expect(sanitizeCodecUse(null)).toBeNull();
  });

  it('describes a worker that broke without inventing what it was doing', () => {
    expect(pageSideFailureDetail('worker_error_event')).toMatchObject({ errorName: 'WorkerError', stage: 'worker_crash', via: 'worker_error_event', framesDone: null });
    expect(pageSideFailureDetail('worker_message_error')).toMatchObject({ errorName: 'DataCloneError', stage: 'worker_crash', via: 'worker_message_error' });
    expect(sanitizeExportFailureDetail(pageSideFailureDetail('worker_error_event'))).toEqual(pageSideFailureDetail('worker_error_event'));
    // A request that could not be handed over has an error on the page: its name, never its text.
    const unsent = pageSideFailureDetail('request_not_sent', new DOMException(`${PRIVATE[0]} could not be cloned`, 'DataCloneError'));
    expect(unsent).toMatchObject({ errorName: 'DataCloneError', stage: 'unknown', via: 'request_not_sent' });
    expect(JSON.stringify(unsent)).not.toContain('tatili');
    expect(sanitizeExportFailureDetail(unsent)).toEqual(unsent);
  });
});

describe('failureDetailLine', () => {
  it('is one line of the checked values', () => {
    expect(failureDetailLine(full, 'kare')).toBe(
      'EncodingError · encode · encoding_error · kare 12/7590 · enc avc1.640028 no-preference hw+ · dec avc1.64001f prefer-software · file · hidden',
    );
    expect(failureDetailLine(pageSideFailureDetail('worker_error_event'), 'kare')).toBe('WorkerError · worker_crash · worker_error_event');
  });
});

describe('stage tagging', () => {
  it('has a stage for every step, each a plain word', () => {
    for (const stage of EXPORT_STAGES) expect(stage).toMatch(/^[a-z_]{3,24}$/);
    expect(new Set(EXPORT_STAGES).size).toBe(EXPORT_STAGES.length);
  });

  it('the innermost step names the error; the error itself is not touched', () => {
    const error = new DOMException('short write', 'QuotaExceededError');
    expect(stageOf(error)).toBeNull();
    expect(tagStage(error, 'write')).toBe(error);
    // It surfaces later through the encoder's next frame: still a write.
    tagStage(error, 'encode');
    expect(stageOf(error)).toBe('write');
    expect(Object.keys(error)).toEqual([]);
    expect(error.message).toBe('short write');
    // Things that are not objects cannot be tagged and do not break it.
    expect(tagStage('text', 'encode')).toBe('text');
    expect(stageOf('text')).toBeNull();
    expect(stageOf(undefined)).toBeNull();
  });

  it('staged() tags what its step throws and passes a result through', async () => {
    await expect(staged('verify', () => 7)).resolves.toBe(7);
    const error = new Error('x');
    await expect(staged('verify', () => Promise.reject(error))).rejects.toBe(error);
    expect(stageOf(error)).toBe('verify');
  });

  it('stagedIterable() tags an error of the source, not one of the consumer, and lets the source clean up', async () => {
    const log: string[] = [];
    const sourceError = new Error('decoder broke');
    async function* failing(): AsyncGenerator<number> {
      try {
        yield 1;
        yield 2;
        throw sourceError;
      } finally {
        log.push('source closed');
      }
    }
    const seen: number[] = [];
    await expect(
      (async () => {
        for await (const value of stagedIterable(failing(), 'decode')) seen.push(value);
      })(),
    ).rejects.toBe(sourceError);
    expect(seen).toEqual([1, 2]);
    expect(stageOf(sourceError)).toBe('decode');
    expect(log).toEqual(['source closed']);

    // The consumer fails while drawing: that error is not a decode error, and the source is ended.
    const consumerError = new Error('draw broke');
    async function* endless(): AsyncGenerator<number> {
      try {
        for (let i = 0; ; i += 1) yield i;
      } finally {
        log.push('endless closed');
      }
    }
    await expect(
      (async () => {
        for await (const value of stagedIterable(endless(), 'decode')) {
          if (value === 3) throw consumerError;
        }
      })(),
    ).rejects.toBe(consumerError);
    expect(stageOf(consumerError)).toBeNull();
    expect(log).toEqual(['source closed', 'endless closed']);

    // A source that simply ends, ends.
    async function* two(): AsyncGenerator<number> {
      yield 1;
      yield 2;
    }
    const all: number[] = [];
    for await (const value of stagedIterable(two(), 'decode')) all.push(value);
    expect(all).toEqual([1, 2]);
  });
});
