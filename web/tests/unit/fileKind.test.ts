import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { FILE_KIND_HEAD_BYTES, fileKind, foreignVideoName, readFileKind } from '@/adapters/fileKind';

/**
 * The fuzz run (docs/quality/2026-10-15-fuzz.md): a refused file is told what
 * it really is from its first bytes. The signatures below are the ones the
 * fuzz corpus produced with ffmpeg (scripts/fuzz/make-corpus.mjs), written
 * out by hand so the test needs no media.
 */

const bytes = (...parts: (string | number[])[]): Uint8Array => {
  const out: number[] = [];
  for (const part of parts) {
    if (typeof part === 'string') for (const char of part) out.push(char.charCodeAt(0));
    else out.push(...part);
  }
  const padded = new Uint8Array(Math.max(out.length, FILE_KIND_HEAD_BYTES));
  padded.set(out);
  return padded;
};

const SAMPLE = join(process.cwd(), 'tests', 'media', 'sample-24s.mp4');

describe('fileKind', () => {
  it('an empty file is empty, whatever its name', () => {
    expect(fileKind(new Uint8Array(0), 0)).toBe('empty');
  });

  it('MP4, MOV and 3GP are the containers this app opens', () => {
    expect(fileKind(bytes([0, 0, 0, 0x20], 'ftypisom'), 1000)).toBe('isobmff');
    expect(fileKind(bytes([0, 0, 0, 0x14], 'ftypqt  '), 1000)).toBe('isobmff');
    expect(fileKind(bytes([0, 0, 0, 0x20], 'ftyp3gp6'), 1000)).toBe('isobmff');
    // A file that starts with its index or its data (old QuickTime, some cameras).
    expect(fileKind(bytes([0, 0, 0x10, 0], 'moov'), 1000)).toBe('isobmff');
    expect(fileKind(bytes([0, 0, 0, 8], 'wide'), 1000)).toBe('isobmff');
    expect(fileKind(new Uint8Array(readFileSync(SAMPLE).subarray(0, FILE_KIND_HEAD_BYTES)), 1000)).toBe('isobmff');
  });

  it('a HEIC or AVIF picture is a picture, not a video', () => {
    expect(fileKind(bytes([0, 0, 0, 0x18], 'ftypheic'), 1000)).toBe('image');
    expect(fileKind(bytes([0, 0, 0, 0x1c], 'ftypavif'), 1000)).toBe('image');
  });

  it('WebM and MKV are told apart by the document type', () => {
    expect(fileKind(bytes([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0x82, 0x84], 'webm'), 1000)).toBe('webm');
    expect(fileKind(bytes([0x1a, 0x45, 0xdf, 0xa3, 0xa3, 0x42, 0x86, 0x81, 0x01, 0x42, 0x82, 0x88], 'matroska'), 1000)).toBe('matroska');
  });

  it('AVI, WAV and WebP share RIFF and are told apart by its form', () => {
    expect(fileKind(bytes('RIFF', [0xac, 0x43, 0x28, 0], 'AVI LIST'), 1000)).toBe('avi');
    expect(fileKind(bytes('RIFF', [0, 0, 0, 0], 'WAVEfmt '), 1000)).toBe('audio');
    expect(fileKind(bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8 '), 1000)).toBe('image');
  });

  it('a transport stream is packets of 188 (or 192) bytes', () => {
    const ts = new Uint8Array(FILE_KIND_HEAD_BYTES);
    ts[0] = 0x47;
    ts[188] = 0x47;
    ts[376] = 0x47;
    expect(fileKind(ts, 100_000)).toBe('mpeg_ts');
    const m2ts = new Uint8Array(FILE_KIND_HEAD_BYTES);
    m2ts[4] = 0x47;
    m2ts[196] = 0x47;
    expect(fileKind(m2ts, 100_000)).toBe('mpeg_ts');
    // One 0x47 alone is not a transport stream.
    const one = new Uint8Array(FILE_KIND_HEAD_BYTES);
    one[0] = 0x47;
    expect(fileKind(one, 100_000)).toBe('unknown');
  });

  it('pictures and sounds', () => {
    expect(fileKind(bytes([0x89], 'PNG', [0x0d, 0x0a, 0x1a, 0x0a]), 1000)).toBe('image');
    expect(fileKind(bytes([0xff, 0xd8, 0xff, 0xe0]), 1000)).toBe('image');
    expect(fileKind(bytes('GIF89a'), 1000)).toBe('image');
    expect(fileKind(bytes('ID3', [4, 0]), 1000)).toBe('audio');
    expect(fileKind(bytes([0xff, 0xfb, 0x90, 0x64]), 1000)).toBe('audio');
    expect(fileKind(bytes('fLaC'), 1000)).toBe('audio');
  });

  it('other video files', () => {
    expect(fileKind(bytes([0, 0, 1, 0xba]), 1000)).toBe('mpeg_ps');
    expect(fileKind(bytes('FLV', [1, 5]), 1000)).toBe('flv');
    expect(fileKind(bytes([0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11]), 1000)).toBe('asf');
  });

  it('random bytes are unknown', () => {
    let state = 7;
    const noise = new Uint8Array(FILE_KIND_HEAD_BYTES).map(() => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state >>> 24;
    });
    expect(fileKind(noise, 300_000)).toBe('unknown');
  });

  it('only the kinds this app does not open get a name for the sentence', () => {
    expect(foreignVideoName('avi')).toBe('AVI');
    expect(foreignVideoName('mpeg_ts')).toBe('TS');
    expect(foreignVideoName('matroska')).toBe('MKV');
    for (const kind of ['isobmff', 'webm', 'image', 'audio', 'empty', 'unknown'] as const) expect(foreignVideoName(kind)).toBeNull();
  });

  it('reads no more than the head of the file', async () => {
    expect(await readFileKind(new Blob([]))).toBe('empty');
    expect(await readFileKind(new Blob([readFileSync(SAMPLE)]))).toBe('isobmff');
  });
});
