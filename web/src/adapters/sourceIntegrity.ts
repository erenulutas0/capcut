/**
 * Is the whole video in the file? (ADR-040)
 *
 * A download or a copy that stopped half way leaves an MP4 whose index (at
 * the start of the file) still lists every frame of the full length, while
 * the bytes of the later frames are simply not there. The browser's player
 * then shows the full length; an export decodes until the bytes run out and
 * — before this check — either saved a file whose end was silence, or blamed
 * the browser for frames no browser could have decoded.
 *
 * The check reads the index, not the video: for the picture and the sound it
 * asks for the LAST packet the index lists and looks whether its bytes can be
 * read. When they cannot, a short binary search finds how far the file really
 * goes ("only the first 13 seconds are in the file"). A handful of small
 * reads; nothing is decoded.
 *
 * Only MP4 / MOV: the containers whose index says where every frame is. For
 * anything else (and for a file this takes too long on) the answer is
 * `unknown`, and the caller goes on as before.
 */

import type { EncodedPacketSink as PacketSink, Input, InputTrack } from 'mediabunny';

import type { Micros } from '../domain/time';

/** A tail shorter than this missing from the file is not a refusal: players and the export cope with it. */
export const INCOMPLETE_TOLERANCE_US: Micros = 1_000_000;

/** Longest the check may take before the answer is `unknown` (a container that has to be read through). */
export const INTEGRITY_WAIT_MS = 4000;

export type SourceIntegrity =
  | { kind: 'complete' }
  /** Not an MP4 / MOV, no readable index, or it took too long: nothing is known, nothing is claimed. */
  | { kind: 'unknown' }
  | {
      kind: 'incomplete';
      /** The length the file's index declares. */
      declaredUs: Micros;
      /** How far picture and sound are really in the file, from the start. */
      readableUs: Micros;
    };

/** The parts of mediabunny the check needs, handed in so the page can load the library lazily. */
export interface IntegrityTools {
  EncodedPacketSink: new (track: InputTrack) => PacketSink;
  /** True for MP4 / MOV. */
  isIndexed: (format: unknown) => boolean;
}

const US = 1_000_000;

/** Whether the bytes of the packet shown at `seconds` are in the file. */
async function readable(sink: PacketSink, seconds: number): Promise<boolean> {
  try {
    const packet = await sink.getPacket(seconds);
    return packet !== null && packet.data.byteLength > 0;
  } catch {
    return false;
  }
}

/**
 * One track: its declared end, and how far its packets can really be read.
 * `null` when the index itself gives no answer.
 */
async function trackExtent(
  track: InputTrack,
  tools: IntegrityTools,
): Promise<{ declaredS: number; readableS: number } | null> {
  const sink = new tools.EncodedPacketSink(track);
  const last = await sink.getPacket(Number.POSITIVE_INFINITY, { metadataOnly: true });
  if (!last) return null;
  const declaredS = last.timestamp + Math.max(0, last.duration);
  if (await readable(sink, last.timestamp)) return { declaredS, readableS: declaredS };

  // The end is missing: how far does the file go? Bytes are laid out in time
  // order, so "readable" switches from yes to no once along the track.
  let lowS = 0;
  let highS = last.timestamp;
  if (!(await readable(sink, 0))) {
    const first = await sink.getFirstPacket({ metadataOnly: true });
    if (!first || !(await readable(sink, first.timestamp))) return { declaredS, readableS: 0 };
    lowS = first.timestamp + Math.max(0, first.duration);
  }
  for (let step = 0; step < 24 && highS - lowS > 0.05; step += 1) {
    const middleS = (lowS + highS) / 2;
    // The packet shown at `middleS` is in the file: so is everything before it.
    if (await readable(sink, middleS)) lowS = middleS;
    else highS = middleS;
  }
  return { declaredS, readableS: lowS };
}

async function inspect(input: Input, tools: IntegrityTools): Promise<SourceIntegrity> {
  if (!tools.isIndexed(await input.getFormat())) return { kind: 'unknown' };
  const tracks: InputTrack[] = [];
  const video = await input.getPrimaryVideoTrack();
  if (video) tracks.push(video);
  const audio = await input.getPrimaryAudioTrack();
  if (audio) tracks.push(audio);
  if (tracks.length === 0) return { kind: 'unknown' };

  let declaredS = 0;
  let readableS = Number.POSITIVE_INFINITY;
  let known = 0;
  for (const track of tracks) {
    const extent = await trackExtent(track, tools);
    if (!extent) continue;
    known += 1;
    declaredS = Math.max(declaredS, extent.declaredS);
    // Complete tracks do not bound the answer: a sound that simply ends earlier than the picture is not damage.
    if (extent.readableS < extent.declaredS) readableS = Math.min(readableS, extent.readableS);
  }
  if (known === 0) return { kind: 'unknown' };
  if (!Number.isFinite(readableS)) return { kind: 'complete' };
  const declaredUs = Math.round(declaredS * US);
  const readableUs = Math.max(0, Math.round(readableS * US));
  if (declaredUs - readableUs <= INCOMPLETE_TOLERANCE_US) return { kind: 'complete' };
  return { kind: 'incomplete', declaredUs, readableUs };
}

/**
 * Whether the file behind `input` holds everything its index lists. Never
 * throws and never takes longer than `waitMs`: any doubt is `unknown`.
 */
export async function sourceIntegrity(
  input: Input,
  tools: IntegrityTools,
  waitMs: number = INTEGRITY_WAIT_MS,
): Promise<SourceIntegrity> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<SourceIntegrity>((resolve) => {
    timer = setTimeout(() => resolve({ kind: 'unknown' }), waitMs);
  });
  try {
    return await Promise.race([inspect(input, tools).catch((): SourceIntegrity => ({ kind: 'unknown' })), late]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
