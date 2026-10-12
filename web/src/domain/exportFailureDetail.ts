/**
 * What is known about a download that failed, beyond its code — enough to
 * tell next time WHERE it broke and with WHAT kind of error, and nothing that
 * could say whose video it was.
 *
 * Why this exists (11 Oct 2026): a burn-in download failed once with
 * `internal_error` on a real machine and worked on the next press. The worker
 * (rightly) never forwards an exception's text, so nothing at all was known
 * about it afterwards.
 *
 * Every field is a number, a boolean or a value from a fixed list in this
 * file. There is no free text:
 *
 * - the error's `message` is NEVER kept. Browser and library messages can
 *   quote a file name, a path, a URL or a piece of metadata, and no stripping
 *   rule can be shown to remove all of them — so the message is only compared
 *   against a few known sentences here (`failureHint`) and the name of the
 *   match is kept, never the sentence;
 * - the error's `name` is kept only when it is one of the names listed below
 *   (the standard DOMException and JavaScript error names, and this app's own
 *   error classes); anything else becomes `Other`;
 * - codec strings must BE codec strings, by the grammar of each kind
 *   (`avc1.640028`, `mp4a.40.2`); a file name made of the same characters is
 *   not one.
 *
 * `sanitizeExportFailureDetail` rebuilds the object field by field, so a row
 * from another build, a hand-edited database or a message from a worker can
 * carry nothing else through.
 */

/** Where in the export's own code the failure was raised. Coarse on purpose. */
export const EXPORT_STAGES = [
  /** Caption font and line layout, before anything is opened. */
  'captions',
  /** Opening the source file: tracks, integrity, decodability, reorder scan. */
  'open_source',
  /** ADR-032: measuring the AAC encoder's delay. */
  'audio_calibration',
  /** ADR-037: looking at the frames before "İyileştir". */
  'analyse',
  /** ADR-027: the fast cut (its failures normally fall back to the full encode). */
  'fast_cut',
  /** Choosing and opening the destination (save-dialog file, OPFS, memory) and claiming its space. */
  'open_output',
  /** Canvas and context creation, track set-up. */
  'setup',
  /** Starting the muxer. */
  'mux',
  /** Creating and configuring the video decoder. */
  'configure_decoder',
  /** Somewhere in the frame loop that is not one of the steps below. */
  'frames',
  /** Waiting for the next decoded frame. */
  'decode',
  /** Drawing a frame (and the caption on it) onto the canvas. */
  'draw',
  /** ADR-037: enhancing the drawn frame. */
  'enhance',
  /** Taking the canvas as a video frame for the encoder. */
  'frame_capture',
  /** The first frame handed to the video encoder: where the encoder is created and configured. */
  'configure_encoder',
  /** Handing a later frame to the video encoder (an encoder error surfaces here). */
  'encode',
  /** Decoding the source's or the music's sound. */
  'audio_decode',
  /** Encoding the mixed sound. */
  'audio_encode',
  /** Somewhere else in the sound's lane. */
  'audio',
  /** A write into the destination file. */
  'write',
  /** Flushing the encoders and closing the muxer. */
  'finalize',
  /** Turning the written file into the saved one (close, move over the chosen name). */
  'commit',
  /** Re-opening and probing the produced file. */
  'verify',
  /** The worker itself stopped: an uncaught error or a script that did not load. */
  'worker_crash',
  'unknown',
] as const;
export type ExportStage = (typeof EXPORT_STAGES)[number];

/**
 * How the failure reached the page: `exception` — caught in the worker and
 * reported by it; `worker_error_event` — the worker's `error` event (an
 * uncaught error or a script that did not load); `worker_message_error` — a
 * message of the worker could not be read on the page; `request_not_sent` —
 * the page could not hand the request to the worker at all; `stalled` — no
 * error at all: the worker stopped making progress and the page gave up
 * waiting (seen when the browser's graphics process dies under an export).
 */
export const FAILURE_VIAS = ['exception', 'worker_error_event', 'worker_message_error', 'request_not_sent', 'stalled'] as const;
export type FailureVia = (typeof FAILURE_VIAS)[number];

/** The last thing the page was told before the failure. */
export const FAILURE_PHASES = ['waiting', 'preparing', 'analysing', 'encoding', 'finalizing', 'verifying'] as const;
export type FailurePhase = (typeof FAILURE_PHASES)[number];

export const HARDWARE_ACCELERATIONS = ['no-preference', 'prefer-hardware', 'prefer-software'] as const;
export type HardwareAccelerationHint = (typeof HARDWARE_ACCELERATIONS)[number];

/**
 * Error names that may be kept. Names come from code (the browser's, a
 * library's, ours), never from a file — but a name outside this list is not
 * trusted to be one, and is reported as `Other`.
 */
export const KNOWN_ERROR_NAMES: ReadonlySet<string> = new Set([
  // JavaScript
  'Error',
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'EvalError',
  'URIError',
  'AggregateError',
  'InternalError',
  // DOMException (WebCodecs, File System Access, streams, canvas, fetch)
  'AbortError',
  'ConstraintError',
  'DataCloneError',
  'DataError',
  'EncodingError',
  'InvalidAccessError',
  'InvalidModificationError',
  'InvalidStateError',
  'NetworkError',
  'NoModificationAllowedError',
  'NotAllowedError',
  'NotFoundError',
  'NotReadableError',
  'NotSupportedError',
  'OperationError',
  'QuotaExceededError',
  'SecurityError',
  'TimeoutError',
  'TypeMismatchError',
  'UnknownError',
  'VersionError',
  // This app's own classes
  'ExportFailure',
  'AacAlignmentError',
  'DecoderHoldUnavailable',
  'EnhanceFailed',
  'FastCutFallback',
  /** Something that is not an Error object was thrown. */
  'NonError',
  /** The worker's `error` event carries no error object the page may read. */
  'WorkerError',
  /** Nothing was thrown: the export stood still (see `via: 'stalled'`). */
  'Stalled',
]);

export const OTHER_ERROR_NAME = 'Other';

export function safeErrorName(error: unknown): string {
  if (typeof error !== 'object' || error === null) return 'NonError';
  let name: unknown;
  try {
    name = (error as { name?: unknown }).name;
  } catch {
    return OTHER_ERROR_NAME;
  }
  return typeof name === 'string' && KNOWN_ERROR_NAMES.has(name) ? name : OTHER_ERROR_NAME;
}

/**
 * Known sentences of the browser and of the media library, by what they
 * mean. Only the key on the left ever leaves this function.
 */
const HINTS = [
  /** Chromium closes a codec a background page left idle; it arrives as a QuotaExceededError. */
  ['codec_reclaimed', /codec reclaimed/i],
  ['encoder_config_unsupported', /encoder configuration .* is not supported/i],
  ['encoder_creation', /encoder (creation|initialization) error|unable to (create|initialize) .*encoder/i],
  ['decoder_creation', /decoder (creation|initialization) error|unable to (create|initialize) .*decoder|decoder initialization/i],
  ['unsupported_config', /unsupported (configuration|config|codec)/i],
  ['encoding_error', /encoding error|encode(r)? (failed|failure|error)/i],
  ['decoding_error', /decoding error|decode(r)? (failed|failure|error)|failed to decode/i],
  ['codec_closed', /closed codec|codec (is|was) closed|on a closed|is closed|been closed/i],
  ['flush_aborted', /abort.*flush|flush.*abort|aborted due to (close|reset)/i],
  ['gpu_or_context_lost', /context (was |is )?lost|gpu (process|device)|device (removed|lost|reset)/i],
  ['out_of_memory', /out of memory|allocation failed|array buffer allocation|invalid array (buffer )?length/i],
  ['file_changed', /could not be read|file .*(changed|modified)|permission.* (revoked|denied)|state (had )?changed/i],
  ['write_blocked', /safe browsing|security policy|blocked by|no modification allowed/i],
  ['timestamp_order', /timestamp.* (monotonic|increasing|order|smaller|less than)|out of order/i],
  ['assertion', /assertion failed/i],
  ['source_closed', /source is closed|output has been (canceled|finalized)|not started/i],
  ['frame_detached', /detached|frame (is|was|has been) closed|already closed|source image.* (closed|unusable|invalid)/i],
] as const;
export type FailureHint = (typeof HINTS)[number][0];
const HINT_NAMES: ReadonlySet<string> = new Set(HINTS.map(([name]) => name));

/** Which known sentence the error's message is; null when it is none of them. The message itself is not returned. */
export function failureHint(error: unknown): FailureHint | null {
  if (typeof error !== 'object' || error === null) return null;
  let message: unknown;
  try {
    message = (error as { message?: unknown }).message;
  } catch {
    return null;
  }
  if (typeof message !== 'string') return null;
  // Bounded: a pathological message is not scanned whole.
  const text = message.slice(0, 400);
  for (const [name, pattern] of HINTS) if (pattern.test(text)) return name;
  return null;
}

/** A codec as it was configured. Sizes are the output's, already in the log. */
export interface CodecUse {
  /** The codec string handed to `configure` ("avc1.640028", "mp4a.40.2"). */
  codec: string;
  /** What was asked for; `no-preference` lets the browser choose. */
  hardwareAcceleration: HardwareAccelerationHint;
}

export interface ExportFailureDetail {
  /** The error's `name` when it is a known one, else `Other`. */
  errorName: string;
  stage: ExportStage;
  via: FailureVia;
  hint: FailureHint | null;
  /** Page side: the last progress step that arrived. */
  phase: FailurePhase | null;
  /** Frames handed to the encoder when it failed, of how many. */
  framesDone: number | null;
  totalFrames: number | null;
  /** Encoded video packets that had come back from the encoder. */
  videoPacketsOut: number | null;
  videoEncoder: CodecUse | null;
  /** Whether this browser offers a hardware H.264 encoder for this picture (what `no-preference` would pick). */
  hardwareEncoderAvailable: boolean | null;
  videoDecoder: CodecUse | null;
  audioEncoder: CodecUse | null;
  /** Where the file was being written. */
  route: 'opfs' | 'memory' | 'file' | null;
  /** Whether the page was hidden (another tab, a minimised window) at any time during the attempt. */
  pageWasHidden: boolean | null;
  /** How many downloads this page had started before this one (0: the first). */
  attemptInSession: number | null;
}

const STAGES: ReadonlySet<string> = new Set(EXPORT_STAGES);
const VIAS: ReadonlySet<string> = new Set(FAILURE_VIAS);
const PHASES: ReadonlySet<string> = new Set(FAILURE_PHASES);
const ACCELERATIONS: ReadonlySet<string> = new Set(HARDWARE_ACCELERATIONS);
const ROUTES: ReadonlySet<string> = new Set(['opfs', 'memory', 'file']);
/**
 * Codec strings, by their own grammar (the WebCodecs codec registry): a known
 * four-character code followed by exactly the kind of parts that code has.
 * "Letters, digits and dots" would not do — `tatil-2025.mp4` is made of those
 * too. A string that is not one of these shapes is dropped.
 */
const CODEC_STRING_PATTERNS: readonly RegExp[] = [
  /^avc[13]\.[0-9A-Fa-f]{6}$/, // avc1.640028
  /^(?:hev1|hvc1)\.[A-C]?\d{1,2}\.[0-9A-Fa-f]{1,8}\.[LH]\d{2,3}(?:\.[0-9A-Fa-f]{1,2}){0,6}$/, // hev1.1.6.L93.B0
  /^vp09(?:\.\d{2}){3,8}$/, // vp09.00.10.08
  /^av01\.\d\.\d{2}[MH]\.\d{2}(?:\.\d{1,3}){0,6}$/, // av01.0.04M.08
  /^mp4a\.[0-9A-Fa-f]{2}(?:\.\d{1,2})?$/, // mp4a.40.2
  /^(?:opus|vp8|flac|mp3|vorbis|ulaw|alaw)$/,
];

function isCodecString(value: string): boolean {
  return value.length <= 40 && CODEC_STRING_PATTERNS.some((pattern) => pattern.test(value));
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

function flag(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

export function sanitizeCodecUse(raw: unknown): CodecUse | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.codec !== 'string' || !isCodecString(row.codec)) return null;
  const acceleration =
    typeof row.hardwareAcceleration === 'string' && ACCELERATIONS.has(row.hardwareAcceleration)
      ? (row.hardwareAcceleration as HardwareAccelerationHint)
      : 'no-preference';
  return { codec: row.codec, hardwareAcceleration: acceleration };
}

/** The detail again, field by field, from anything: only known fields with checked values come out. */
export function sanitizeExportFailureDetail(raw: unknown): ExportFailureDetail | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const row = raw as Record<string, unknown>;
  return {
    errorName: typeof row.errorName === 'string' && KNOWN_ERROR_NAMES.has(row.errorName) ? row.errorName : OTHER_ERROR_NAME,
    stage: typeof row.stage === 'string' && STAGES.has(row.stage) ? (row.stage as ExportStage) : 'unknown',
    via: typeof row.via === 'string' && VIAS.has(row.via) ? (row.via as FailureVia) : 'exception',
    hint: typeof row.hint === 'string' && HINT_NAMES.has(row.hint) ? (row.hint as FailureHint) : null,
    phase: typeof row.phase === 'string' && PHASES.has(row.phase) ? (row.phase as FailurePhase) : null,
    framesDone: count(row.framesDone),
    totalFrames: count(row.totalFrames),
    videoPacketsOut: count(row.videoPacketsOut),
    videoEncoder: sanitizeCodecUse(row.videoEncoder),
    hardwareEncoderAvailable: flag(row.hardwareEncoderAvailable),
    videoDecoder: sanitizeCodecUse(row.videoDecoder),
    audioEncoder: sanitizeCodecUse(row.audioEncoder),
    route: typeof row.route === 'string' && ROUTES.has(row.route) ? (row.route as ExportFailureDetail['route']) : null,
    pageWasHidden: flag(row.pageWasHidden),
    attemptInSession: count(row.attemptInSession),
  };
}

/** A detail the page makes itself, when the worker could not say anything (it crashed, or its message was unreadable). */
export function pageSideFailureDetail(via: Exclude<FailureVia, 'exception'>, error?: unknown): ExportFailureDetail {
  return {
    // `request_not_sent` has a real error on the page: its name, if it is a known one.
    errorName:
      via === 'request_not_sent' ? safeErrorName(error) : via === 'worker_message_error' ? 'DataCloneError' : via === 'stalled' ? 'Stalled' : 'WorkerError',
    stage: via === 'request_not_sent' || via === 'stalled' ? 'unknown' : 'worker_crash',
    via,
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
  };
}

/**
 * The detail as one line of small technical text for "Ayrıntılar"
 * (`EncodingError · encode · kare 12/7590 · avc1.640028 no-preference`).
 * Engineering words on purpose; every part is one of the checked values.
 */
export function failureDetailLine(detail: ExportFailureDetail, frameWord: string): string {
  const parts: string[] = [detail.errorName, detail.stage];
  if (detail.hint) parts.push(detail.hint);
  if (detail.via !== 'exception') parts.push(detail.via);
  if (detail.framesDone !== null && detail.totalFrames !== null) parts.push(`${frameWord} ${detail.framesDone}/${detail.totalFrames}`);
  if (detail.videoEncoder) {
    const kind = detail.hardwareEncoderAvailable === null ? '' : detail.hardwareEncoderAvailable ? ' hw+' : ' hw-';
    parts.push(`enc ${detail.videoEncoder.codec} ${detail.videoEncoder.hardwareAcceleration}${kind}`);
  }
  if (detail.videoDecoder) parts.push(`dec ${detail.videoDecoder.codec} ${detail.videoDecoder.hardwareAcceleration}`);
  if (detail.route) parts.push(detail.route);
  if (detail.pageWasHidden) parts.push('hidden');
  return parts.join(' · ');
}
