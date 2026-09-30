/**
 * The export's AAC track, written with the encoder's delay undone (ADR-032).
 *
 * mediabunny's `AudioSampleSource` writes the WebCodecs chunks exactly as the
 * encoder timestamps them. That is right where the encoder already hides its
 * priming (desktop Chrome/Edge) and 42.7 ms late where it does not (Chrome on
 * Android). This module runs the `AudioEncoder` itself, with the same
 * configuration mediabunny builds, measures the delay once per worker and
 * configuration, and hands the realigned packets to an
 * `EncodedAudioPacketSource`. Where the delay is 0 the packets are placed
 * where mediabunny placed them; only the encoder's flush now runs over
 * silence fed after the end (dropped again) instead of stopping mid-frame.
 */

import { EncodedPacket, type AudioSample } from 'mediabunny';

import {
  AacPacketAligner,
  aacDescriptionInvalid,
  aacLcAudioSpecificConfig,
  calibrationSignal,
  flushPaddingFrames,
  measureEncoderDelay,
  type EncoderDelay,
} from '@/domain/audioEncoderDelay';

export interface AacSettings {
  sampleRate: number;
  numberOfChannels: number;
  bitrate: number;
}

/** Where the packets go: an `EncodedAudioPacketSource` in the export. */
export interface AacPacketTarget {
  add(packet: EncodedPacket, meta?: EncodedAudioChunkMetadata): Promise<void>;
}

/**
 * The configuration mediabunny's `AudioSampleSource` builds for AAC at this
 * rate (AAC-LC above 24 kHz, raw AAC rather than ADTS), so the files do not
 * change where there is nothing to undo.
 */
export function aacEncoderConfig(settings: AacSettings): AudioEncoderConfig {
  return {
    codec: 'mp4a.40.2',
    sampleRate: settings.sampleRate,
    numberOfChannels: settings.numberOfChannels,
    bitrate: settings.bitrate,
    aac: { format: 'aac' },
  } as AudioEncoderConfig;
}

function bytesOf(source: AllowSharedBufferSource | undefined): Uint8Array | null {
  if (!source) return null;
  return ArrayBuffer.isView(source)
    ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
    : new Uint8Array(source);
}

/** The decoder config with a valid AudioSpecificConfig (see `aacDescriptionInvalid`). */
function validDecoderConfig(config: AudioDecoderConfig): AudioDecoderConfig {
  if (!aacDescriptionInvalid(bytesOf(config.description))) return config;
  return { ...config, description: aacLcAudioSpecificConfig(config.sampleRate, config.numberOfChannels) };
}

function interleavedSilence(frames: number, channels: number, timestampUs: number, sampleRate: number): AudioData {
  return new AudioData({
    format: 'f32',
    sampleRate,
    numberOfChannels: channels,
    numberOfFrames: frames,
    timestamp: timestampUs,
    data: new Float32Array(frames * channels),
  });
}

/**
 * Encodes the calibration signal with `settings` and decodes it again with
 * this browser's decoder; the decoded first channel, as one buffer.
 */
async function roundTripCalibration(settings: AacSettings): Promise<Float32Array> {
  const { sampleRate, numberOfChannels } = settings;
  const mono = calibrationSignal(sampleRate);
  const chunks: EncodedAudioChunk[] = [];
  let decoderConfig: AudioDecoderConfig | null = null;
  let failure: unknown = null;

  const encoder = new AudioEncoder({
    output: (chunk, meta) => {
      chunks.push(chunk);
      if (meta?.decoderConfig) decoderConfig = meta.decoderConfig;
    },
    error: (error) => {
      failure = error;
    },
  });
  try {
    encoder.configure(aacEncoderConfig(settings));
    const step = 4096;
    for (let start = 0; start < mono.length; start += step) {
      const frames = Math.min(step, mono.length - start);
      const data = new Float32Array(frames * numberOfChannels);
      for (let i = 0; i < frames; i += 1) {
        for (let channel = 0; channel < numberOfChannels; channel += 1) {
          data[i * numberOfChannels + channel] = mono[start + i] ?? 0;
        }
      }
      const audio = new AudioData({
        format: 'f32',
        sampleRate,
        numberOfChannels,
        numberOfFrames: frames,
        timestamp: Math.round((start * 1_000_000) / sampleRate),
        data,
      });
      encoder.encode(audio);
      audio.close();
    }
    await encoder.flush();
  } finally {
    if (encoder.state !== 'closed') encoder.close();
  }
  if (failure) throw failure;
  const config = decoderConfig as AudioDecoderConfig | null;
  if (!config) throw new Error('AAC encoder gave no decoder config');

  const pieces: Float32Array[] = [];
  const decoder = new AudioDecoder({
    output: (audio) => {
      const plane = new Float32Array(audio.numberOfFrames);
      audio.copyTo(plane, { planeIndex: 0, format: 'f32-planar' });
      pieces.push(plane);
      audio.close();
    },
    error: (error) => {
      failure = error;
    },
  });
  try {
    decoder.configure(validDecoderConfig(config));
    for (const chunk of chunks) decoder.decode(chunk);
    await decoder.flush();
  } finally {
    if (decoder.state !== 'closed') decoder.close();
  }
  if (failure) throw failure;

  const decoded = new Float32Array(pieces.reduce((sum, piece) => sum + piece.length, 0));
  let offset = 0;
  for (const piece of pieces) {
    decoded.set(piece, offset);
    offset += piece.length;
  }
  return decoded;
}

const delays = new Map<string, Promise<EncoderDelay>>();

/**
 * The encoder delay for `settings`, measured once per worker: the answer
 * cannot change while the browser runs. A browser whose encoder or decoder
 * breaks on the calibration gets `marker_not_found`.
 */
export function measureAacEncoderDelay(settings: AacSettings): Promise<EncoderDelay> {
  const key = `${settings.sampleRate}/${settings.numberOfChannels}/${settings.bitrate}`;
  let measured = delays.get(key);
  if (!measured) {
    measured = roundTripCalibration(settings).then(
      (decoded) => measureEncoderDelay(decoded, settings.sampleRate),
      (): EncoderDelay => ({ ok: false, reason: 'marker_not_found', matches: [] }),
    );
    delays.set(key, measured);
  }
  return measured;
}

/** How far the encoder may run ahead of the writer, in chunks (as mediabunny). */
const ENCODE_QUEUE_LIMIT = 4;

export class AlignedAacEncoder {
  private readonly encoder: AudioEncoder;
  private readonly aligner: AacPacketAligner;
  private written: Promise<void> = Promise.resolve();
  private failure: { error: unknown } | null = null;
  private metaSent = false;
  /** One past the last input frame, in output frames. */
  private fedEnd = 0;

  constructor(
    private readonly target: AacPacketTarget,
    private readonly settings: AacSettings,
    delayFrames: number,
    /** Output frames the audio must cover: [0, endFrame). */
    endFrame: number,
  ) {
    this.aligner = new AacPacketAligner(settings.sampleRate, delayFrames, endFrame);
    this.encoder = new AudioEncoder({
      output: (chunk, meta) => this.onChunk(chunk, meta),
      error: (error) => this.fail(error),
    });
    this.encoder.configure(aacEncoderConfig(settings));
  }

  private fail(error: unknown): void {
    this.failure ??= { error };
  }

  private throwIfFailed(): void {
    if (this.failure) throw this.failure.error;
  }

  private onChunk(chunk: EncodedAudioChunk, meta: EncodedAudioChunkMetadata | undefined): void {
    const placed = this.aligner.place(chunk.timestamp, chunk.duration ?? null);
    if (!placed) return;
    const packet = EncodedPacket.fromEncodedChunk(chunk).clone({
      timestamp: placed.timestamp,
      ...(placed.duration !== undefined ? { duration: placed.duration } : {}),
    });
    let packetMeta: EncodedAudioChunkMetadata | undefined;
    if (!this.metaSent && meta?.decoderConfig) {
      packetMeta = { ...meta, decoderConfig: validDecoderConfig(meta.decoderConfig) };
      this.metaSent = true;
    }
    // In order, one after the other: the muxer takes packets in decode order.
    this.written = this.written
      .then(() => (this.failure ? undefined : this.target.add(packet, packetMeta)))
      .catch((error: unknown) => this.fail(error));
  }

  private async encode(audio: AudioData): Promise<void> {
    try {
      this.encoder.encode(audio);
    } finally {
      audio.close();
    }
    if (this.encoder.encodeQueueSize >= ENCODE_QUEUE_LIMIT) {
      await new Promise((resolve) => this.encoder.addEventListener('dequeue', resolve, { once: true }));
    }
    // Lets the writer apply backpressure, as mediabunny's own source does.
    await this.written;
    this.throwIfFailed();
  }

  /** Encodes one mixed chunk; the caller keeps ownership of `sample`. */
  async add(sample: AudioSample): Promise<void> {
    this.throwIfFailed();
    const rate = this.settings.sampleRate;
    this.fedEnd = Math.max(this.fedEnd, Math.round(sample.timestamp * rate) + sample.numberOfFrames);
    await this.encode(sample.toAudioData());
  }

  /**
   * Feeds the flush padding, drains the encoder and waits for the last
   * packet to be written. Throws `AacAlignmentError` when the kept packets do
   * not reach the end of the moment.
   */
  async finish(): Promise<void> {
    this.throwIfFailed();
    const { sampleRate, numberOfChannels } = this.settings;
    const padding = flushPaddingFrames(this.aligner.delayFrames);
    await this.encode(
      interleavedSilence(padding, numberOfChannels, Math.round((this.fedEnd * 1_000_000) / sampleRate), sampleRate),
    );
    await this.encoder.flush();
    await this.written;
    this.throwIfFailed();
    if (!this.aligner.complete) throw new AacAlignmentError(this.aligner.stats);
  }

  close(): void {
    if (this.encoder.state !== 'closed') this.encoder.close();
  }

  get stats(): AacPacketAligner['stats'] {
    return this.aligner.stats;
  }
}

/** The encoder did not give back audio up to the end of the moment. */
export class AacAlignmentError extends Error {
  constructor(readonly stats: AacPacketAligner['stats']) {
    super('aac_incomplete');
    this.name = 'AacAlignmentError';
  }
}
