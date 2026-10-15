import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  addCaptionCue,
  addClip,
  addKesitlerFromRanges,
  applyTranscriptTrack,
  convertCaptionTimeBase,
  createEmptyProject,
  importCaptionTrack,
  removeCaptionCue,
  setCaptionStyle,
  setVideoAsset,
  shiftCaptions,
  updateCaptionCue,
} from '@/application/commands';
import { CAPTION_LIMITS, isCaptionSpeaker, outputCuesForExport, primaryCaptionTrack, tellsVoicesApart, videoCues } from '@/domain/captions';
import { EDL_SCHEMA_VERSION, type AssetV1, type CaptionCueV2, type Project } from '@/domain/edl';
import { DEFAULT_KESIT_SETTINGS, downloadRecipe, kesitRecipe } from '@/domain/kesit';
import { loadProject, loadStoredProject, migrateProject } from '@/domain/migration';
import { WEB_LOCAL_POLICY } from '@/domain/policy';
import { createRecord, isNewerRecipe } from '@/domain/projectRecord';
import { parseRecord } from '@/domain/recordParse';
import { compileRenderPlan } from '@/domain/renderPlan';
import { parseSubtitles, serializeSubtitles } from '@/domain/subtitleFormats';
import { totalOutputDurationUs } from '@/domain/timeline';
import { kesitRangesFromLines, speakerTurns, transcriptLines, transcriptText } from '@/domain/transcript';
import { issueCodes, validateProject, validateStoredProject } from '@/domain/validation';

/**
 * Speakers that survive (EDL v5, ADR-043): a transcript line may carry the
 * voice that said it. What is checked here needs no browser — the schema, the
 * way old recipes arrive in it, what every command does to the field, and
 * what each file a user can download says about it.
 */

const S = 1_000_000;
const FIXTURES = join(process.cwd(), 'fixtures', 'edl');
const fixture = (file: string): Record<string, unknown> => JSON.parse(readFileSync(join(FIXTURES, file), 'utf8'));

const video: AssetV1 = { assetId: 'a_video', kind: 'video', durationUs: 30 * S, displayWidth: 1280, displayHeight: 720, hasAudio: true };
const opened = (): Project => setVideoAsset(createEmptyProject(), video);

/** Two people, four turns, as the cloud route hands them over (a line whose voice is unknown carries null). */
const SPOKEN = [
  { startUs: 1 * S, endUs: 3 * S, text: 'Merhaba, başlayalım mı?', speaker: 1 },
  { startUs: 4 * S, endUs: 6 * S, text: 'Olur, hazırım.', speaker: 2 },
  { startUs: 7 * S, endUs: 11 * S, text: 'Önce sesi ayırıyoruz.', speaker: 1 },
  { startUs: 12 * S, endUs: 13 * S, text: 'Teşekkürler.', speaker: 2 },
  { startUs: 14 * S, endUs: 15 * S, text: 'Kimin dediği bilinmiyor.', speaker: null },
];

function spoken(): Project {
  const applied = applyTranscriptTrack(opened(), SPOKEN, [], 'tr');
  if (!applied.ok) throw new Error(applied.reason);
  return applied.project;
}

const cues = (project: Project): CaptionCueV2[] => primaryCaptionTrack(project)?.cues ?? [];
const voices = (project: Project) => cues(project).map((cue) => cue.speaker);
const label = (speaker: number) => `${speaker}. kişi`;

describe('the shape: a small position number on a transcript line, nothing else', () => {
  it('is stored on the line, and left off where the voice is not known', () => {
    const project = spoken();
    expect(project.schemaVersion).toBe(5);
    expect(EDL_SCHEMA_VERSION).toBe(5);
    expect(cues(project)).toEqual([
      { cueId: 'q_001', startUs: 1 * S, endUs: 3 * S, text: 'Merhaba, başlayalım mı?', speaker: 1 },
      { cueId: 'q_002', startUs: 4 * S, endUs: 6 * S, text: 'Olur, hazırım.', speaker: 2 },
      { cueId: 'q_003', startUs: 7 * S, endUs: 11 * S, text: 'Önce sesi ayırıyoruz.', speaker: 1 },
      { cueId: 'q_004', startUs: 12 * S, endUs: 13 * S, text: 'Teşekkürler.', speaker: 2 },
      { cueId: 'q_005', startUs: 14 * S, endUs: 15 * S, text: 'Kimin dediği bilinmiyor.' },
    ]);
    // The track itself has no speaker list, count or name table.
    expect(Object.keys(primaryCaptionTrack(project) ?? {}).sort()).toEqual(['assetId', 'cues', 'language', 'origin', 'style', 'timeBase', 'trackId']);
    // A stored project (no kesit yet) and the export's rules both accept it.
    expect(validateStoredProject(project).ok).toBe(true);
    const withKesit = addClip(project, { sourceInUs: 0, sourceOutUs: 20 * S });
    expect(withKesit.ok && validateProject(withKesit.project).ok).toBe(true);
  });

  it('accepts 1 … 20 and nothing else', () => {
    expect(CAPTION_LIMITS.maxSpeakers).toBe(20);
    for (const good of [1, 2, 19, 20]) expect(isCaptionSpeaker(good), String(good)).toBe(true);
    for (const bad of [0, -1, 21, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '1', null, undefined, true, {}]) {
      expect(isCaptionSpeaker(bad), String(bad)).toBe(false);
    }
  });

  it('every way a recipe can get it wrong has its own stable code, at the line\'s own path', () => {
    const base = addClip(spoken(), { sourceInUs: 0, sourceOutUs: 20 * S });
    if (!base.ok) throw new Error('no kesit');
    const withSpeaker = (speaker: unknown, origin = 'transcript') => {
      const copy = JSON.parse(JSON.stringify(base.project)) as { captionTracks: { origin: string; cues: Record<string, unknown>[] }[] };
      (copy.captionTracks[0]!.cues[1] as Record<string, unknown>).speaker = speaker;
      copy.captionTracks[0]!.origin = origin;
      return validateProject(copy);
    };
    for (const bad of [0, 21, 1.5, -3, '2', null, true, [1]]) {
      const result = withSpeaker(bad);
      expect(issueCodes(result), JSON.stringify(bad)).toEqual(['caption_speaker_invalid']);
      if (!result.ok) expect(result.issues[0]?.path).toBe('captionTracks[0].cues[1].speaker');
    }
    // Typed lines and lines from a file have no speaker: a field there is not a transcript's.
    for (const origin of ['manual', 'imported']) {
      const result = withSpeaker(2, origin);
      expect(issueCodes(result), origin).toContain('caption_track_invalid');
      expect(issueCodes(result), origin).not.toContain('caption_speaker_invalid');
    }
  });

  it('numbers need not start at 1 or be dense: deleting every line of the first voice leaves the others their numbers', () => {
    let project = spoken();
    project = removeCaptionCue(project, 'q_001');
    project = removeCaptionCue(project, 'q_003');
    expect(voices(project)).toEqual([2, 2, undefined]);
    expect(validateStoredProject(project).ok).toBe(true);
  });
});

describe('old recipes: the number changes and nothing else', () => {
  const legacy = readdirSync(join(FIXTURES, 'legacy-v4')).filter((name) => name !== 'v4-with-speaker.json');

  it.each(legacy)('legacy-v4/%s opens as v5, identical apart from the number', (name) => {
    const raw = fixture(`legacy-v4/${name}`);
    expect(raw.schemaVersion).toBe(4);
    const loaded = loadProject(raw);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.project.schemaVersion).toBe(5);
    expect({ ...loaded.project, schemaVersion: 4 }).toEqual(raw);
    // To the byte, in the order the keys were written: nothing is re-sorted or dropped on the way.
    expect(JSON.stringify({ ...loaded.project, schemaVersion: 4 })).toBe(JSON.stringify(raw));
    // The input object itself is not touched.
    expect(raw.schemaVersion).toBe(4);
  });

  it('no migration gives any line a speaker', () => {
    for (const dir of ['legacy-v1', 'legacy-v2', 'legacy-v3', 'legacy-v4']) {
      for (const name of readdirSync(join(FIXTURES, dir))) {
        const loaded = loadProject(fixture(`${dir}/${name}`));
        if (loaded.ok) expect(JSON.stringify(loaded.project), `${dir}/${name}`).not.toContain('"speaker"');
      }
    }
  });

  it('an older recipe whose line names a speaker was written by no build: it keeps its number and is refused', () => {
    const v5 = addClip(spoken(), { sourceInUs: 0, sourceOutUs: 20 * S });
    if (!v5.ok) throw new Error('no kesit');
    for (const schemaVersion of [1, 2, 3, 4]) {
      const odd = { ...v5.project, schemaVersion };
      expect(migrateProject(odd), `v${schemaVersion}`).toBe(odd);
      expect(issueCodes(loadProject(odd)), `v${schemaVersion}`).toEqual(['schema_version_unsupported']);
    }
    // Also when the value is nonsense: the field's presence is what gives it away.
    const nonsense = fixture('legacy-v4/v4-with-speaker.json');
    expect(issueCodes(loadProject(nonsense))).toEqual(['schema_version_unsupported']);
  });

  it('v1, v2 and v3 still arrive at v5 by their own rules', () => {
    for (const dir of ['legacy-v1', 'legacy-v2', 'legacy-v3']) {
      const loaded = loadProject(fixture(`${dir}/single-clip.json`));
      expect(loaded.ok && loaded.project.schemaVersion, dir).toBe(5);
    }
  });
});

describe('the stored project and the backup file', () => {
  it('speakers survive the record through JSON, to the byte — with a kesit and without one', () => {
    const bare = spoken();
    const cut = addClip(bare, { sourceInUs: 0, sourceOutUs: 20 * S });
    if (!cut.ok) throw new Error('no kesit');
    for (const project of [bare, cut.project]) {
      const record = createRecord(project.projectId, 'Görüşme', project, []);
      // As IndexedDB's structured clone and the `.lilocut.json` file carry it.
      const text = JSON.stringify(record, null, 2);
      const parsed = parseRecord(JSON.parse(text));
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) continue;
      expect(parsed.record.edl).toEqual(project);
      expect(JSON.stringify(parsed.record, null, 2)).toBe(text);
      expect(voices(parsed.record.edl)).toEqual([1, 2, 1, 2, undefined]);
    }
  });

  it('a record written by the v4 build opens, and saving it again changes the schema number alone', () => {
    for (const name of ['doc10-example.json', 'caption-transcript-unclear.json', 'enhance-light-with-music.json']) {
      const v4 = fixture(`legacy-v4/${name}`);
      const stored = { ...createRecord('p_fixture_001', 'Eski', v4 as unknown as Project, []), updatedAt: '2026-10-12T09:00:00.000Z' };
      const before = JSON.stringify(stored);
      const parsed = parseRecord(JSON.parse(before));
      expect(parsed.ok, name).toBe(true);
      if (!parsed.ok) continue;
      // What autosave writes back on the first load: the same record with the recipe at v5.
      const after = JSON.stringify(parsed.record);
      expect(after, name).toBe(before.replace('"schemaVersion":4', '"schemaVersion":5'));
    }
    // A v4 project with NO kesit (a video that was opened and not cut) too.
    const noKesit = { ...fixture('legacy-v4/single-clip.json'), clips: [] };
    const loaded = loadStoredProject(noKesit);
    expect(loaded.ok && { ...loaded.project, schemaVersion: 4 }).toEqual(noKesit);
  });

  it('a recipe from a NEWER build is told apart from a broken one, and nothing in it is read', () => {
    const project = spoken();
    const newer = { ...createRecord('p', 'Yarın', project, []), edl: { schemaVersion: EDL_SCHEMA_VERSION + 1, whatever: 'this build cannot know' } };
    expect(parseRecord(JSON.parse(JSON.stringify(newer)))).toEqual({ ok: false, reason: 'edl_newer' });
    expect(isNewerRecipe({ schemaVersion: 6 })).toBe(true);
    expect(isNewerRecipe({ schemaVersion: 99 })).toBe(true);
    // Not newer: this build's own, older ones, and anything that is not a version number.
    for (const edl of [{ schemaVersion: 5 }, { schemaVersion: 4 }, { schemaVersion: 1 }, { schemaVersion: '6' }, { schemaVersion: 6.5 }, { schemaVersion: Number.POSITIVE_INFINITY }, {}, null, 'x', [6]]) {
      expect(isNewerRecipe(edl), JSON.stringify(edl)).toBe(false);
    }
    // A broken recipe of this build's own version is still "invalid", as before.
    const broken = { ...createRecord('p', '', project, []), edl: { ...project, extra: true } };
    expect(parseRecord(JSON.parse(JSON.stringify(broken)))).toEqual({ ok: false, reason: 'edl_invalid' });
    // The validator's own answer for a newer number is unchanged: refused before anything else is looked at.
    expect(issueCodes(validateProject({ schemaVersion: 6 }))).toEqual(['schema_version_unsupported']);
  });
});

describe('editing: who said a line does not change when the line does', () => {
  it('fixing the words keeps the speaker; so does moving the line', () => {
    const project = spoken();
    const fixed = updateCaptionCue(project, 'q_002', { text: 'Olur, hazırım!' });
    expect(fixed.ok && cues(fixed.project)[1]).toEqual({ cueId: 'q_002', startUs: 4 * S, endUs: 6 * S, text: 'Olur, hazırım!', speaker: 2 });
    const moved = updateCaptionCue(project, 'q_002', { startUs: 4.5 * S, endUs: 6.5 * S });
    expect(moved.ok && cues(moved.project)[1]).toEqual({ cueId: 'q_002', startUs: 4.5 * S, endUs: 6.5 * S, text: 'Olur, hazırım.', speaker: 2 });
    // The other lines are the same objects' worth of data.
    if (fixed.ok) expect(voices(fixed.project)).toEqual([1, 2, 1, 2, undefined]);
    // A refused edit changes nothing.
    expect(updateCaptionCue(project, 'q_002', { text: '   ' })).toEqual({ ok: false, reason: 'caption_text_empty' });
  });

  it('a line typed by hand names nobody, and does not break the turn around it', () => {
    const typed = addCaptionCue(spoken(), { startUs: 16 * S, endUs: 18 * S, text: 'Sonradan eklendi' });
    expect(typed.ok).toBe(true);
    if (!typed.ok) return;
    expect(cues(typed.project).at(-1)).toEqual({ cueId: typed.cueId, startUs: 16 * S, endUs: 18 * S, text: 'Sonradan eklendi' });
    expect(validateStoredProject(typed.project).ok).toBe(true);
    const between = addCaptionCue(spoken(), { startUs: 3.2 * S, endUs: 3.8 * S, text: 'Araya yazıldı' });
    if (!between.ok) throw new Error(between.reason);
    // 1. kişi · (typed) · 2. kişi · 1. kişi · 2. kişi: the typed line shows no label and the labels around it are as before.
    expect([...speakerTurns(transcriptLines(primaryCaptionTrack(between.project))).values()]).toEqual([1, 2, 1, 2]);
  });

  it('deleting a line, changing the look and shifting all lines leave the speakers alone', () => {
    const project = spoken();
    expect(voices(removeCaptionCue(project, 'q_002'))).toEqual([1, 1, 2, undefined]);
    expect(voices(setCaptionStyle(project, { preset: 'outline', size: 'large' }))).toEqual([1, 2, 1, 2, undefined]);
    const shifted = shiftCaptions(project, 500_000);
    expect(shifted.ok && voices(shifted.project)).toEqual([1, 2, 1, 2, undefined]);
    expect(shifted.ok && cues(shifted.project)[0]?.startUs).toBe(1.5 * S);
  });

  it('"Bunlardan kesit yap" adds kesitler and does not touch a line', () => {
    const project = spoken();
    const lines = transcriptLines(primaryCaptionTrack(project));
    const ranges = kesitRangesFromLines(lines, new Set(['q_002', 'q_004']), video.durationUs);
    const made = addKesitlerFromRanges(project, ranges);
    expect(made.ok && made.added).toBe(2);
    if (!made.ok) return;
    expect(primaryCaptionTrack(made.project)).toEqual(primaryCaptionTrack(project));
    expect(validateProject(made.project).ok).toBe(true);
    // One kesit downloaded on its own carries its lines with their speakers.
    const one = kesitRecipe(made.project, made.clipIds[0]!);
    expect(one && voices(one)).toEqual([1, 2, 1, 2, undefined]);
  });

  it('a new set of lines replaces the old voices: a subtitle file and an on-device transcript name nobody', () => {
    const fromFile = importCaptionTrack(spoken(), [{ startUs: 1 * S, endUs: 2 * S, text: 'Dosyadan', speaker: 3 }], 'source');
    expect(fromFile.ok && primaryCaptionTrack(fromFile.project)?.origin).toBe('imported');
    expect(fromFile.ok && cues(fromFile.project)).toEqual([{ cueId: 'q_001', startUs: 1 * S, endUs: 2 * S, text: 'Dosyadan' }]);
    if (fromFile.ok) expect(validateStoredProject(fromFile.project).ok).toBe(true);
    const onDevice = applyTranscriptTrack(spoken(), [{ startUs: 1 * S, endUs: 2 * S, text: 'Hello.' }], [{ startUs: 5 * S, endUs: 6 * S }]);
    expect(onDevice.ok && JSON.stringify(onDevice.project)).not.toContain('speaker');
  });
});

describe('a line cut in pieces, and pieces joined: every piece keeps the line\'s speaker', () => {
  /** Two kesitler that cut the third line (7–11 s) in two and use the second line (4–6 s) twice. */
  function cut(): Project {
    let project = spoken();
    for (const range of [
      { sourceInUs: 3.5 * S, sourceOutUs: 9 * S },
      { sourceInUs: 9 * S, sourceOutUs: 12.5 * S },
      { sourceInUs: 4 * S, sourceOutUs: 6 * S },
    ]) {
      const added = addClip(project, range);
      if (!added.ok) throw new Error(added.reason);
      project = added.project;
    }
    return project;
  }

  it('source → output: an appearance per kesit, each with the speaker; a line used twice says it twice', () => {
    const converted = convertCaptionTimeBase(cut(), 'output');
    expect(converted.ok).toBe(true);
    if (!converted.ok) return;
    const track = primaryCaptionTrack(converted.project);
    expect(track?.timeBase).toBe('output');
    expect(track?.origin).toBe('transcript');
    expect(track?.cues.map((cue) => [cue.text, cue.speaker])).toEqual([
      ['Olur, hazırım.', 2],
      ['Önce sesi ayırıyoruz.', 1], // 7–9 s, the first kesit
      ['Önce sesi ayırıyoruz.', 1], // 9–11 s, the second kesit
      ['Teşekkürler.', 2],
      ['Olur, hazırım.', 2], // the same line again, in the third kesit
    ]);
    // New ids for the later pieces, never a lost or swapped voice; the recipe is valid.
    expect(new Set(track?.cues.map((cue) => cue.cueId)).size).toBe(5);
    expect(validateProject(converted.project).ok).toBe(true);
  });

  it('output → source: pieces that are contiguous in the video become one line again, with its speaker', () => {
    // The first two kesitler only (3,5–9 s and 9–12,5 s): they touch in the video.
    const two: Project = { ...cut(), clips: cut().clips.slice(0, 2) };
    const there = convertCaptionTimeBase(two, 'output');
    if (!there.ok) throw new Error(there.reason);
    // On the joined video the third line is two lines (3,5–5,5 s and 5,5–7,5 s). Made one line across the cut:
    const pieces = cues(there.project).filter((cue) => cue.text === 'Önce sesi ayırıyoruz.');
    expect(pieces.map((cue) => [cue.startUs / S, cue.endUs / S, cue.speaker])).toEqual([[3.5, 5.5, 1], [5.5, 7.5, 1]]);
    const stretched = updateCaptionCue(removeCaptionCue(there.project, pieces[1]!.cueId), pieces[0]!.cueId, { endUs: 7.5 * S });
    if (!stretched.ok) throw new Error(stretched.reason);
    const back = convertCaptionTimeBase(stretched.project, 'source');
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.report).toEqual({ split: 0, dropped: 0 });
    expect(primaryCaptionTrack(back.project)?.cues.map((cue) => [cue.startUs / S, cue.endUs / S, cue.text, cue.speaker])).toEqual([
      [4, 6, 'Olur, hazırım.', 2],
      [7, 11, 'Önce sesi ayırıyoruz.', 1],
      [12, 12.5, 'Teşekkürler.', 2],
    ]);
    expect(validateProject(back.project).ok).toBe(true);
  });

  it('two DIFFERENT lines are never joined, so two voices never end up in one line', () => {
    // Lines 1 and 2 made to touch (3 s): still two lines after a round trip through the output clock.
    let project = spoken();
    const touching = updateCaptionCue(project, 'q_001', { endUs: 4 * S });
    if (!touching.ok) throw new Error(touching.reason);
    const whole = addClip(touching.project, { sourceInUs: 0, sourceOutUs: 20 * S });
    if (!whole.ok) throw new Error(whole.reason);
    const there = convertCaptionTimeBase(whole.project, 'output');
    if (!there.ok) throw new Error(there.reason);
    const back = convertCaptionTimeBase(there.project, 'source');
    if (!back.ok) throw new Error(back.reason);
    project = back.project;
    expect(cues(project).slice(0, 2).map((cue) => [cue.endUs - cue.startUs, cue.speaker])).toEqual([[3 * S, 1], [2 * S, 2]]);
  });
});

describe('where the voice is shown', () => {
  it('the panel labels the first line of every turn, from the stored lines alone', () => {
    const lines = transcriptLines(primaryCaptionTrack(spoken()));
    expect([...speakerTurns(lines)]).toEqual([['q_001', 1], ['q_002', 2], ['q_003', 1], ['q_004', 2]]);
    // Through a stored record and back: the same labels.
    const parsed = parseRecord(JSON.parse(JSON.stringify(createRecord('p', '', spoken(), []))));
    expect(parsed.ok && [...speakerTurns(transcriptLines(primaryCaptionTrack(parsed.record.edl)))]).toEqual([['q_001', 1], ['q_002', 2], ['q_003', 1], ['q_004', 2]]);
  });

  it('with one voice left nobody is labelled — on screen or in any file', () => {
    let project = spoken();
    project = removeCaptionCue(project, 'q_002');
    project = removeCaptionCue(project, 'q_004');
    expect(tellsVoicesApart(cues(project))).toBe(false);
    expect(speakerTurns(transcriptLines(primaryCaptionTrack(project))).size).toBe(0);
    expect(tellsVoicesApart(cues(spoken()))).toBe(true);
    expect(tellsVoicesApart([])).toBe(false);
    expect(tellsVoicesApart([{}, {}])).toBe(false);
  });
});

describe('the files', () => {
  const whole = (): Project => {
    const recipe = downloadRecipe(spoken(), { kind: 'all' }, DEFAULT_KESIT_SETTINGS);
    if (!recipe) throw new Error('no recipe');
    return recipe;
  };
  const exported = () => outputCuesForExport(whole(), totalOutputDurationUs(whole()));

  it('TXT names the voice where it changes', () => {
    const lines = transcriptLines(primaryCaptionTrack(spoken()));
    const turns = speakerTurns(lines);
    const text = transcriptText(lines, '(anlaşılamadı)', 'Başlık', (line) => (turns.has(line.key) ? label(turns.get(line.key) as number) : null));
    expect(text.split('\r\n')).toEqual([
      'Başlık',
      '',
      '[00:01] 1. kişi: Merhaba, başlayalım mı?',
      '[00:04] 2. kişi: Olur, hazırım.',
      '[00:07] 1. kişi: Önce sesi ayırıyoruz.',
      '[00:12] 2. kişi: Teşekkürler.',
      '[00:14] Kimin dediği bilinmiyor.',
      '',
    ]);
  });

  it('SRT carries no speaker: byte for byte the file it was before v5, whatever is asked of it', () => {
    const withVoices = exported();
    const without = withVoices.map(({ speaker: _speaker, ...cue }) => cue);
    const plain = serializeSubtitles(without, 'srt');
    expect(serializeSubtitles(withVoices, 'srt')).toBe(plain);
    expect(serializeSubtitles(withVoices, 'srt', label)).toBe(plain);
    expect(plain).not.toContain('kişi');
    expect(plain.split('\r\n').slice(0, 3)).toEqual(['1', '00:00:01,000 --> 00:00:03,000', 'Merhaba, başlayalım mı?']);
  });

  it('VTT carries it as a voice tag on every line that has one', () => {
    const vtt = serializeSubtitles(exported(), 'vtt', label);
    expect(vtt.split('\n')).toEqual([
      'WEBVTT',
      '',
      '00:00:01.000 --> 00:00:03.000',
      '<v 1. kişi>Merhaba, başlayalım mı?',
      '',
      '00:00:04.000 --> 00:00:06.000',
      '<v 2. kişi>Olur, hazırım.',
      '',
      '00:00:07.000 --> 00:00:11.000',
      '<v 1. kişi>Önce sesi ayırıyoruz.',
      '',
      '00:00:12.000 --> 00:00:13.000',
      '<v 2. kişi>Teşekkürler.',
      '',
      '00:00:14.000 --> 00:00:15.000',
      'Kimin dediği bilinmiyor.',
      '',
    ]);
    // Without names to give (one voice, or a caller that has none): the file it always was.
    const without = exported().map(({ speaker: _speaker, ...cue }) => cue);
    expect(serializeSubtitles(exported(), 'vtt')).toBe(serializeSubtitles(without, 'vtt'));
  });

  it('the tag is never part of the words: read back in, the VTT gives the text alone', () => {
    const vtt = serializeSubtitles(exported(), 'vtt', label);
    const parsed = parseSubtitles(vtt);
    expect(parsed.ok && parsed.value.cues.map((cue) => cue.text)).toEqual(SPOKEN.map((cue) => cue.text));
    expect(parsed.ok && parsed.value.problems).toEqual([]);
  });

  it('a voice name can never break out of its tag, and two-line text stays inside one span', () => {
    const cue = { startUs: 0, endUs: 2 * S, text: 'a < b & c\niki satır', speaker: 1 };
    const vtt = serializeSubtitles([cue], 'vtt', () => 'A>B <c>\n&amp; D');
    expect(vtt.split('\n').slice(2)).toEqual(['00:00:00.000 --> 00:00:02.000', '<v A B c amp; D>a &lt; b &amp; c', 'iki satır', '']);
    // A name that is nothing but forbidden characters gives no tag rather than an empty one.
    expect(serializeSubtitles([cue], 'vtt', () => '<>&')).not.toContain('<v');
  });
});

describe('the video itself: burned-in subtitles do not change', () => {
  it('the render plan of a recipe with speakers is the plan of the same recipe without them, to the fingerprint', () => {
    const withVoices = addClip(spoken(), { sourceInUs: 0, sourceOutUs: 20 * S });
    if (!withVoices.ok) throw new Error('no kesit');
    const stripped: Project = {
      ...withVoices.project,
      captionTracks: withVoices.project.captionTracks.map((track) => ({ ...track, cues: track.cues.map(({ speaker: _speaker, ...cue }) => cue) })),
    };
    expect(JSON.stringify(stripped)).not.toContain('speaker');
    const a = compileRenderPlan(withVoices.project, WEB_LOCAL_POLICY);
    const b = compileRenderPlan(stripped, WEB_LOCAL_POLICY);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.plan).toEqual(b.plan);
    expect(a.plan.fingerprint).toBe(b.plan.fingerprint);
    expect(JSON.stringify(a.plan)).not.toContain('speaker');
    expect(JSON.stringify(a.plan)).not.toContain('kişi');
    // The preview draws the same words too: the line on the video's clock has no speaker.
    expect(videoCues(withVoices.project)).toEqual(videoCues(stripped));
    expect(JSON.stringify(videoCues(withVoices.project))).not.toContain('speaker');
  });
});
