/**
 * AAC encoder delay: measured, then undone with an edit list (ADR-032).
 *
 * Every AAC encoder puts a few "priming" frames in front of the audio. A
 * player skips them only when the file says how many there are (the MP4 edit
 * list). The WebCodecs `AudioEncoder` of desktop Chrome/Edge hands out chunks
 * whose first sample is already the first input sample; Chrome on Android
 * (MediaCodec, measured on a Galaxy S23) hands out 2048 priming frames from
 * timestamp 0 and says nothing about them. Written as they came, the sound
 * of every Android export was 42.7 ms late against the picture, its last
 * input frames were missing, and a moment whose length fell just past a
 * 1024-frame boundary came out one frame longer than the picture and was
 * refused as "süre uyuşmadı".
 *
 * WebCodecs has no field for the delay, so it is measured in the browser that
 * exports: a known signal goes through the same encoder configuration and
 * back through the browser's own decoder, and the position where it comes
 * out is the delay. The export's packets are then moved back by that many
 * frames (the muxer writes the edit list that hides the priming), packets
 * that hold only the silence fed after the end to flush the encoder are
 * dropped, and a result that does not cover the whole moment is refused.
 *
 * Pure: no WebCodecs here, so every rule runs in node.
 */

/** Calibration buffer layout, in frames at the export's sample rate. */
export const CALIBRATION = {
  /** Frames fed to the encoder, silence apart from the two markers. */
  frames: 32_768,
  /** Length of one marker (a windowed chirp). */
  markerFrames: 2048,
  /** Where the two markers start in the input. */
  markers: [4096, 14_336] as const,
  /** Delays searched: an encoder that outputs early, up to one that primes 8192 frames. */
  minLag: -1024,
  maxLag: 8192,
  /**
   * A marker must come back at least this similar (normalised correlation).
   * AAC at 128 kbit/s returns the chirp at ~0.99; noise and a wrong lag are
   * far below.
   */
  minCorrelation: 0.9,
} as const;

/**
 * One marker: a Hann-windowed linear chirp from 500 Hz to 8 kHz. A sweep has
 * one sharp correlation peak (a tone would match at every period), and it
 * stays inside the band AAC keeps at any usual bitrate.
 */
export function calibrationMarker(sampleRate: number): Float32Array {
  const n = CALIBRATION.markerFrames;
  const marker = new Float32Array(n);
  const f0 = 500;
  const f1 = Math.min(8000, sampleRate * 0.35);
  const seconds = n / sampleRate;
  for (let i = 0; i < n; i += 1) {
    const t = i / sampleRate;
    const phase = 2 * Math.PI * (f0 * t + ((f1 - f0) * t * t) / (2 * seconds));
    const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    marker[i] = 0.5 * window * Math.sin(phase);
  }
  return marker;
}

/** The whole calibration input, one channel. */
export function calibrationSignal(sampleRate: number): Float32Array {
  const signal = new Float32Array(CALIBRATION.frames);
  const marker = calibrationMarker(sampleRate);
  for (const at of CALIBRATION.markers) signal.set(marker, at);
  return signal;
}

export interface LagMatch {
  lag: number;
  correlation: number;
}

/**
 * Where `marker` (placed at `at` in the input) is in `decoded`: the lag with
 * the highest normalised correlation in [minLag, maxLag]. Samples beyond the
 * decoded audio count as silence.
 */
export function findMarkerLag(
  marker: Float32Array,
  decoded: Float32Array,
  at: number,
  minLag: number = CALIBRATION.minLag,
  maxLag: number = CALIBRATION.maxLag,
): LagMatch {
  let markerEnergy = 0;
  for (let i = 0; i < marker.length; i += 1) markerEnergy += (marker[i] ?? 0) ** 2;
  let best: LagMatch = { lag: 0, correlation: -1 };
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    const start = at + lag;
    if (start < 0) continue;
    let dot = 0;
    let energy = 0;
    for (let i = 0; i < marker.length; i += 1) {
      const value = decoded[start + i] ?? 0;
      dot += (marker[i] ?? 0) * value;
      energy += value * value;
    }
    const correlation = energy > 0 ? dot / Math.sqrt(markerEnergy * energy) : 0;
    if (correlation > best.correlation) best = { lag, correlation };
  }
  return best;
}

export type EncoderDelay =
  | { ok: true; delayFrames: number; correlation: number }
  | { ok: false; reason: 'marker_not_found' | 'delay_inconsistent'; matches: LagMatch[] };

/**
 * The encoder's delay from the decoded calibration audio (one channel). Both
 * markers must be found, clearly, at the same delay (one frame apart at most,
 * for an encoder that resamples inside); anything else is not a delay that
 * can be undone, and the export is refused rather than written misaligned.
 */
export function measureEncoderDelay(decoded: Float32Array, sampleRate: number): EncoderDelay {
  const marker = calibrationMarker(sampleRate);
  const matches = CALIBRATION.markers.map((at) => findMarkerLag(marker, decoded, at));
  if (matches.some((match) => match.correlation < CALIBRATION.minCorrelation)) {
    return { ok: false, reason: 'marker_not_found', matches };
  }
  const lags = matches.map((match) => match.lag);
  if (Math.max(...lags) - Math.min(...lags) > 1) {
    return { ok: false, reason: 'delay_inconsistent', matches };
  }
  return {
    ok: true,
    delayFrames: lags[0] ?? 0,
    correlation: Math.min(...matches.map((match) => match.correlation)),
  };
}

/**
 * Silence fed after the last real frame so the encoder lets go of all of it.
 * Android's encoder returned ceil((n + 1024) / 1024) packets for n frames,
 * short of the n + 2048 its delay needs; the delay plus two AAC frames covers
 * that with room. Everything past the end is dropped again (see below).
 */
export function flushPaddingFrames(delayFrames: number): number {
  return Math.max(0, delayFrames) + 2048;
}

export interface PlacedPacket {
  /** Seconds, after undoing the delay; negative for priming packets. */
  timestamp: number;
  /** Seconds; undefined when the encoder did not say. */
  duration: number | undefined;
}

/**
 * Moves every encoded packet back by the measured delay and drops the ones
 * that only hold the flush padding.
 *
 * Priming packets keep their (now negative) place: the decoder needs them to
 * warm up, and the muxer turns the negative start into the edit list that
 * players skip. A packet is past the end when its first frame, after the
 * shift, is at or after the moment's last frame.
 */
export class AacPacketAligner {
  private coveredTo = Number.NEGATIVE_INFINITY;
  private droppedPackets = 0;
  private keptPackets = 0;

  constructor(
    private readonly sampleRate: number,
    readonly delayFrames: number,
    /** Output frames the audio must cover: [0, endFrame). */
    readonly endFrame: number,
  ) {}

  place(timestampUs: number, durationUs: number | null): PlacedPacket | null {
    const rate = this.sampleRate;
    // Snapped to whole frames, as mediabunny does with its own encoder's
    // chunks: the microsecond timestamps lose the exact frame.
    const startFrame = Math.round((timestampUs * rate) / 1_000_000) - this.delayFrames;
    if (startFrame >= this.endFrame) {
      this.droppedPackets += 1;
      return null;
    }
    const durationFrames = durationUs === null ? null : Math.round((durationUs * rate) / 1_000_000);
    if (durationFrames !== null) this.coveredTo = Math.max(this.coveredTo, startFrame + durationFrames);
    this.keptPackets += 1;
    return {
      timestamp: startFrame / rate,
      duration: durationFrames === null ? undefined : durationFrames / rate,
    };
  }

  /**
   * Whether the kept packets reach the end of the moment. Two frames of
   * slack for the microsecond rounding of chunk durations (a desktop chunk of
   * 1024 frames reads 21333 µs).
   */
  get complete(): boolean {
    return this.coveredTo >= this.endFrame - 2;
  }

  get stats(): { delayFrames: number; endFrame: number; coveredTo: number; kept: number; dropped: number } {
    return {
      delayFrames: this.delayFrames,
      endFrame: this.endFrame,
      coveredTo: this.coveredTo,
      kept: this.keptPackets,
      dropped: this.droppedPackets,
    };
  }
}

const AAC_SAMPLE_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

/** The first five bits of an AudioSpecificConfig: the audio object type (0 = invalid). */
function objectTypeOf(description: Uint8Array): number {
  return (description[0] ?? 0) >> 3;
}

/**
 * Whether an encoder's AAC description must be replaced. WebKit has emitted
 * an empty or invalid one (mediabunny works around it for its own encoder,
 * https://bugs.webkit.org/show_bug.cgi?id=302253); this encoder is ours, so
 * the same check is made here.
 */
export function aacDescriptionInvalid(description: Uint8Array | null): boolean {
  return description === null || description.byteLength < 2 || objectTypeOf(description) === 0;
}

/** AudioSpecificConfig for AAC-LC (ISO 14496-3 §1.6.2.1), without extensions. */
export function aacLcAudioSpecificConfig(sampleRate: number, channels: number): Uint8Array {
  const index = AAC_SAMPLE_RATES.indexOf(sampleRate);
  const bits: number[] = [];
  const push = (value: number, width: number) => {
    for (let bit = width - 1; bit >= 0; bit -= 1) bits.push((value >> bit) & 1);
  };
  push(2, 5); // AAC-LC
  if (index >= 0) push(index, 4);
  else {
    push(15, 4);
    push(sampleRate, 24);
  }
  push(channels, 4);
  push(0, 3); // frameLengthFlag, dependsOnCoreCoder, extensionFlag
  const bytes = new Uint8Array(Math.ceil(bits.length / 8));
  bits.forEach((bit, i) => {
    bytes[i >> 3] = (bytes[i >> 3] ?? 0) | (bit << (7 - (i & 7)));
  });
  return bytes;
}
