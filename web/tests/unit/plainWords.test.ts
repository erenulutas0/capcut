import { describe, expect, it } from 'vitest';

import type { FastCutFallbackReason } from '@/domain/fastPath';
import { tr, type MessageKey } from '@/i18n/messages';
import { en } from '@/i18n/messages.en';

import { strongJargon } from '../quality/lib/jargon';

/**
 * The default path of a task speaks in plain words (10 Oct 2026). What a
 * wizard shows without "Ayarlar" or "Ayrıntılar" being opened must not use
 * the engineering vocabulary of tests/quality/lib/jargon.ts — the same list
 * the quality report counts with — and must not get less honest for it: a
 * picture that was re-made is still said to be re-made.
 */

/** Every reason the fast cut can give: the compiler refuses a list that misses one. */
const REASONS: Record<FastCutFallbackReason, true> = {
  requested_encode: true,
  enhance: true,
  captions: true,
  text: true,
  hdr: true,
  codec: true,
  bitstream: true,
  color: true,
  crop: true,
  aspect: true,
  resolution: true,
  pixel_aspect: true,
  fps: true,
  reorder: true,
  no_keyframe: true,
  timing: true,
  encoder: true,
  seam_check: true,
  target_size: true,
  output_size: true,
  error: true,
};

/** Shown under "Kaydedildi", on the choose step, or while the file is made — with nothing opened. */
const PLAIN_PREFIXES = ['export.method.', 'export.why.', 'download.target', 'wizard.kucult.', 'wizard.cevir.', 'wizard.ses.', 'wizard.sustur.', 'wizard.muzik.', 'wizard.dikey.', 'wizard.bosluk.', 'export.running.'];

const plainKeys = (Object.keys(tr) as MessageKey[]).filter((key) => PLAIN_PREFIXES.some((prefix) => key.startsWith(prefix)));

describe('plain words on the default path', () => {
  it('covers the sentences the quality report found', () => {
    for (const key of ['export.method.copy', 'export.method.audio', 'export.why.codec', 'export.why.resolution', 'download.targetCopy', 'wizard.cevir.body', 'wizard.kucult.plan', 'wizard.kucult.note'] as const) {
      expect(plainKeys).toContain(key);
    }
  });

  it('no engineering word in any of them (Turkish)', () => {
    const found = plainKeys.flatMap((key) => strongJargon(tr[key]).map((hit) => `${key}: ${hit.term} — “${hit.context}”`));
    expect(found).toEqual([]);
  });

  it('every reason has a plain sentence and an engineering one, in both languages', () => {
    for (const reason of Object.keys(REASONS)) {
      for (const locale of [tr, en]) {
        expect(locale[`export.why.${reason}` as MessageKey], `export.why.${reason}`).toBeTruthy();
        expect(locale[`export.fallback.${reason}` as MessageKey], `export.fallback.${reason}`).toBeTruthy();
      }
    }
  });

  it('plain is not less honest: a re-made picture is said to be re-made, a kept one to be kept', () => {
    expect(tr['export.method.encode']).toBe('Görüntü yeniden işlendi');
    expect(tr['export.method.encodeWhy']).toContain('Görüntü yeniden işlendi');
    expect(tr['export.method.copy']).toMatch(/dokunulmadı/);
    // The smart cut says that some frames WERE re-made, and how many.
    expect(tr['export.method.smart']).toMatch(/\{count\} kare yeniden işlendi/);
    // Fitting a size costs the picture something, and the sentence says what.
    expect(tr['download.targetReduced']).toMatch(/ayrıntısı azaltıldı/);
    expect(tr['download.targetSmaller']).toMatch(/küçültüldü/);
    expect(tr['wizard.kucult.plan']).toMatch(/ayrıntısı biraz azalır/);
    expect(tr['wizard.kucult.planSmaller']).toMatch(/küçülür/);
  });

  it('the engineering words did not disappear: they are the wording of “Ayrıntılar”', () => {
    expect(tr['export.methodDetail.copy']).toContain('yeniden kodlanmadı');
    expect(tr['export.methodDetail.audio']).toContain('AAC');
    expect(tr['export.fallback.codec']).toContain('H.264');
    expect(tr['export.fallback.resolution']).toContain('çözünürlük');
    expect(tr['export.methodDetail.targetResolution']).toContain('{height}p');
  });
});
