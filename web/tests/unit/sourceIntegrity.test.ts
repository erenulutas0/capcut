import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Input,
  IsobmffInputFormat,
  Mp4OutputFormat,
  Output,
} from 'mediabunny';
import { beforeAll, describe, expect, it } from 'vitest';

import { INCOMPLETE_TOLERANCE_US, sourceIntegrity, type IntegrityTools } from '@/adapters/sourceIntegrity';
import { refusedFileText } from '@/components/editor/mediaErrorText';
import { en, tr, type MessageKey } from '@/i18n/messages';

/**
 * ADR-040: a download that stopped half way. The repository's sample (1280×720,
 * 24 s) is rewritten with its index first — what phones and most sites produce —
 * with mediabunny itself (packets copied, nothing decoded), and then cut short.
 */

const SAMPLE = join(process.cwd(), 'tests', 'media', 'sample-24s.mp4');
const TOOLS: IntegrityTools = {
  EncodedPacketSink,
  isIndexed: (format) => format instanceof IsobmffInputFormat,
};

async function indexFirstCopy(file: string): Promise<Uint8Array> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(new Blob([readFileSync(file)])) });
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const video = await input.getPrimaryVideoTrack();
  const audio = await input.getPrimaryAudioTrack();
  if (!video || !audio) throw new Error('the sample needs a picture and a sound');
  const videoSource = new EncodedVideoPacketSource('avc');
  const audioSource = new EncodedAudioPacketSource('aac');
  output.addVideoTrack(videoSource);
  output.addAudioTrack(audioSource);
  await output.start();
  const videoConfig = await video.getDecoderConfig();
  const audioConfig = await audio.getDecoderConfig();
  // Interleaved by time, as a camera or a downloader writes them.
  const videoPackets = new EncodedPacketSink(video).packets();
  const audioPackets = new EncodedPacketSink(audio).packets();
  let nextVideo = await videoPackets.next();
  let nextAudio = await audioPackets.next();
  let firstVideo = true;
  let firstAudio = true;
  while (!nextVideo.done || !nextAudio.done) {
    const takeVideo = !nextVideo.done && (nextAudio.done || nextVideo.value.timestamp <= nextAudio.value.timestamp);
    if (takeVideo && !nextVideo.done) {
      await videoSource.add(nextVideo.value, firstVideo && videoConfig ? { decoderConfig: videoConfig } : undefined);
      firstVideo = false;
      nextVideo = await videoPackets.next();
    } else if (!nextAudio.done) {
      await audioSource.add(nextAudio.value, firstAudio && audioConfig ? { decoderConfig: audioConfig } : undefined);
      firstAudio = false;
      nextAudio = await audioPackets.next();
    }
  }
  await output.finalize();
  const buffer = output.target.buffer;
  if (!buffer) throw new Error('no output');
  return new Uint8Array(buffer);
}

describe('the sentence for a file that is not all there', () => {
  const t = (key: MessageKey) => tr[key];
  const e = (key: MessageKey) => en[key];

  it('says the length the file declares and how far it really goes, never more than is there', () => {
    expect(
      refusedFileText(t, { reason: 'incomplete', name: 'tatil.mp4', extent: { declaredUs: 24_000_000, readableUs: 13_180_000 } }),
    ).toBe(
      '“tatil.mp4” açılamadı: bu video yarım kalmış görünüyor: 24,0 sn uzunluğunda olması gerekirken dosyada yalnızca ilk 13,1 sn var. İnerken ya da kopyalanırken yarıda kesilmiş olabilir. Videoyu yeniden indir ya da yeniden kopyala, sonra tekrar dene.',
    );
    // Long videos read as a clock.
    expect(
      refusedFileText(t, { reason: 'incomplete', name: 'dugun.mp4', extent: { declaredUs: 3_725_000_000, readableUs: 1_810_000_000 } }),
    ).toContain('62:05 dk uzunluğunda olması gerekirken dosyada yalnızca ilk 30:10 dk var.');
    expect(
      refusedFileText(e, { reason: 'incomplete', name: 'trip.mp4', extent: { declaredUs: 24_000_000, readableUs: 13_180_000 } }),
    ).toBe(
      '“trip.mp4” could not be opened: this video looks incomplete: it should be 24.0 s long, but only the first 13.1 s is in the file. The download or the copy may have stopped half way. Download or copy the video again, then retry.',
    );
  });

  it('under a second of it: “almost none”, not “the first 0,0 sn”', () => {
    const text = refusedFileText(t, { reason: 'incomplete', name: 'a.mp4', extent: { declaredUs: 24_000_000, readableUs: 300_000 } });
    expect(text).toContain('24,0 sn uzunluğunda olması gerekirken dosyada neredeyse hiçbiri yok.');
    expect(text).not.toMatch(/\{\w+\}/);
    expect(refusedFileText(t, { reason: 'incomplete', name: 'a.mp4' })).not.toContain('yalnızca ilk');
  });

  it('music has its own sentence', () => {
    expect(
      refusedFileText(t, { reason: 'music_incomplete', name: 'sarki.m4a', extent: { declaredUs: 30_000_000, readableUs: 15_020_000 } }),
    ).toBe(
      '“sarki.m4a” açılamadı: bu müzik dosyası yarım kalmış görünüyor: 30,0 sn uzunluğunda olması gerekirken dosyada yalnızca ilk 15,0 sn var. Dosyayı yeniden indir ya da yeniden kopyala, sonra tekrar dene.',
    );
  });

  it('none of these sentences sends the user to another browser, and each says what to do', () => {
    for (const key of ['error.incomplete', 'error.incompleteStart', 'error.music_incomplete', 'error.music_incompleteStart', 'export.fail.source_incomplete'] as const) {
      expect(tr[key]).not.toMatch(/tarayıcı|Chrome|Edge/i);
      expect(tr[key]).toMatch(/yeniden indir ya da yeniden kopyala/);
      expect(en[key]).not.toMatch(/browser|Chrome|Edge/i);
    }
    // The browser is named in one separate sentence only, shown outside Chromium.
    expect(tr['export.fail.source_frames_missing']).not.toMatch(/Chrome|Edge/);
    expect(tr['export.fail.no_frames_decoded']).not.toMatch(/Chrome|Edge/);
    expect(tr['export.fail.tryChromium']).toMatch(/Chrome ya da Edge/);
  });
});

const open = (bytes: Uint8Array) => new Input({ formats: ALL_FORMATS, source: new BlobSource(new Blob([bytes as BlobPart])) });

describe('is the whole video in the file? (ADR-040)', () => {
  let whole: Uint8Array;

  beforeAll(async () => {
    whole = await indexFirstCopy(SAMPLE);
  });

  it('a whole file is complete', async () => {
    expect(await sourceIntegrity(open(whole), TOOLS)).toEqual({ kind: 'complete' });
    // The repository's own sample too (its index is at the end).
    expect(await sourceIntegrity(open(new Uint8Array(readFileSync(SAMPLE))), TOOLS)).toEqual({ kind: 'complete' });
  });

  it('55 % of the bytes: incomplete, with the declared length and about how far the file really goes', async () => {
    const half = whole.subarray(0, Math.floor(whole.length * 0.55));
    const verdict = await sourceIntegrity(open(half), TOOLS);
    expect(verdict.kind).toBe('incomplete');
    if (verdict.kind !== 'incomplete') return;
    expect(verdict.declaredUs).toBeGreaterThan(23_900_000);
    expect(verdict.declaredUs).toBeLessThanOrEqual(24_100_000);
    // Bytes and time do not run in step (the picture's size varies), but the cut is well inside the video …
    expect(verdict.readableUs).toBeGreaterThan(4_000_000);
    expect(verdict.readableUs).toBeLessThan(20_000_000);
    // … and what is said to be there really is: the packet at that time can be read, the one a second later cannot.
    const input = open(half);
    const video = await input.getPrimaryVideoTrack();
    const audio = await input.getPrimaryAudioTrack();
    if (!video || !audio) throw new Error('tracks');
    const atS = verdict.readableUs / 1_000_000;
    const packets = [new EncodedPacketSink(video), new EncodedPacketSink(audio)];
    const before = await Promise.all(packets.map((sink) => sink.getPacket(Math.max(0, atS - 0.2)).catch(() => null)));
    expect(before.every((packet) => packet !== null)).toBe(true);
    const after = await Promise.all(packets.map((sink) => sink.getPacket(atS + 1).catch(() => null)));
    expect(after.some((packet) => packet === null)).toBe(true);
  });

  it('every cut from 10 % to 95 % of the bytes is caught; the readable part grows with the bytes', async () => {
    let last = -1;
    for (const share of [0.1, 0.25, 0.4, 0.6, 0.8, 0.95]) {
      const verdict = await sourceIntegrity(open(whole.subarray(0, Math.floor(whole.length * share))), TOOLS);
      expect(verdict.kind, `share ${share}`).toBe('incomplete');
      if (verdict.kind !== 'incomplete') continue;
      expect(verdict.readableUs).toBeGreaterThanOrEqual(last);
      expect(verdict.declaredUs - verdict.readableUs).toBeGreaterThan(INCOMPLETE_TOLERANCE_US);
      last = verdict.readableUs;
    }
  });

  it('a few missing bytes at the very end are not a refusal', async () => {
    const verdict = await sourceIntegrity(open(whole.subarray(0, whole.length - 40)), TOOLS);
    expect(verdict.kind).toBe('complete');
  });

  it('never guesses: a container without an index, a file that is no video and a slow file are “unknown”', async () => {
    expect(await sourceIntegrity(open(whole), { ...TOOLS, isIndexed: () => false })).toEqual({ kind: 'unknown' });
    expect(await sourceIntegrity(open(new TextEncoder().encode('bu bir video değil')), TOOLS)).toEqual({ kind: 'unknown' });
    expect(await sourceIntegrity(open(new Uint8Array(0)), TOOLS)).toEqual({ kind: 'unknown' });
    // The index of this file is at its end: cut short, nothing of it can be read at all.
    const original = new Uint8Array(readFileSync(SAMPLE));
    expect(await sourceIntegrity(open(original.subarray(0, Math.floor(original.length * 0.55))), TOOLS)).toEqual({ kind: 'unknown' });
    // A file whose packets do not come back in time: unknown, not a guess, and the caller is not kept waiting.
    class NeverAnswers {
      getPacket(): Promise<null> {
        return new Promise(() => undefined);
      }
    }
    const started = Date.now();
    const slow = await sourceIntegrity(open(whole), { ...TOOLS, EncodedPacketSink: NeverAnswers as unknown as IntegrityTools['EncodedPacketSink'] }, 30);
    expect(slow).toEqual({ kind: 'unknown' });
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
