import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { Project } from '@/domain/edl';
import { bindingFor, createRecord, parseRecord, type ProjectRecord } from '@/domain/projectRecord';
import { US_PER_SECOND } from '@/domain/time';
import { handoffAction, storedProjectHasWork, storedProjectName, type StoredProbe } from '@/domain/wizardHandoff';
import { cloudTr } from '@/i18n/cloudMessages';
import { cloudEn } from '@/i18n/cloudMessages.en';
import { tr, type MessageKey } from '@/i18n/messages';
import { en } from '@/i18n/messages.en';

import { strongJargon } from '../quality/lib/jargon';

/**
 * The editor opened from a wizard (ADR-034, addendum of 13 Oct 2026): only a
 * transcript — written on this device or on the internet, the founder's two
 * decisions of that day — makes it a stored project, and a project that is
 * already stored is never replaced without the user saying so.
 */

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), 'utf8');
const fixture = (name: string): Project => JSON.parse(read('fixtures', 'edl', 'valid', name)) as Project;

const full = fixture('doc10-example.json');
const speakers = fixture('caption-transcript-speakers.json');
/** What `/editor` stores when a video was opened and nothing was done with it (ADR-012, addendum of 10 Oct 2026). */
const openedOnly: Project = (() => {
  const { music: _music, ...rest } = full;
  void _music;
  return { ...rest, assets: full.assets.filter((asset) => asset.kind === 'video'), clips: [], captionTracks: [] };
})();

const videoBinding = bindingFor(
  'a_video_001',
  'video',
  { name: 'tatil.mp4', size: 12_345_678, lastModified: 1_700_000_000_000, type: 'video/mp4' },
  { durationUs: 20 * US_PER_SECOND, displayWidth: 1080, displayHeight: 1920 },
  new Date('2026-10-13T00:00:00.000Z'),
);

const record = (edl: Project, title = ''): ProjectRecord => createRecord(edl.projectId, title, edl, [videoBinding]);
const stored = (edl: Project, title = ''): StoredProbe => ({ kind: 'project', record: record(edl, title) });

/** Every store the rule can meet: the two routes of "Yazıya dök" must get the same answer from each. */
const PROBES: StoredProbe[] = [{ kind: 'empty' }, stored(full), stored(openedOnly), { kind: 'unreadable', reason: 'corrupt' }, { kind: 'unreadable', reason: 'newer' }];

describe('what becomes of a wizard\'s work when the editor opens over it', () => {
  it('nothing to keep: unsaved, whatever the store holds (every wizard but one)', () => {
    for (const probe of PROBES) expect(handoffAction(false, probe), probe.kind).toBe('unsaved');
  });

  it('a transcript, an empty store: it becomes the stored project, no question', () => {
    expect(handoffAction(true, { kind: 'empty' })).toBe('store');
  });

  it('the rule does not know where the transcript was written: one answer per store, for both routes', () => {
    // `keep` is all the wizard says; the on-device transcript (ADR-036) and the internet one (ADR-039) say the same.
    const onDevice = PROBES.map((probe) => handoffAction(true, probe));
    const internet = PROBES.map((probe) => handoffAction(true, probe));
    expect(onDevice).toEqual(internet);
    expect(onDevice).toEqual(['store', 'ask', 'store', 'store', 'store']);
  });

  it('a stored project with work in it is never replaced unasked', () => {
    expect(handoffAction(true, stored(full))).toBe('ask');
    expect(handoffAction(true, stored(speakers))).toBe('ask');
    // One thing the user made is enough: a kesit, lines, music, a name.
    expect(handoffAction(true, stored({ ...openedOnly, clips: full.clips }))).toBe('ask');
    expect(handoffAction(true, stored({ ...openedOnly, captionTracks: speakers.captionTracks }))).toBe('ask');
    expect(handoffAction(true, stored(openedOnly, 'Düğün'))).toBe('ask');
    if (full.music) {
      const withMusic: Project = { ...openedOnly, assets: full.assets, music: full.music };
      expect(handoffAction(true, stored(withMusic))).toBe('ask');
    }
  });

  it('a video that was only opened is not work: replaced as /editor itself replaces it', () => {
    expect(storedProjectHasWork(record(openedOnly))).toBe(false);
    expect(storedProjectHasWork(record(openedOnly, '   '))).toBe(false);
    expect(handoffAction(true, stored(openedOnly))).toBe('store');
    // Such a record is a real stored project (it opens), not a broken one.
    expect(parseRecord(JSON.parse(JSON.stringify(record(openedOnly)))).ok).toBe(true);
  });

  it('a store that cannot be read is not asked about: the editor\'s own saving meets it and says so', () => {
    for (const reason of ['unavailable', 'blocked', 'quota_exceeded', 'corrupt', 'newer', 'unknown']) {
      expect(handoffAction(true, { kind: 'unreadable', reason }), reason).toBe('store');
    }
    // "newer" is then left alone by the saving itself (ADR-043): it neither opens nor writes over it.
    const hook = read('src', 'components', 'editor', 'useProjectPersistence.ts');
    expect(hook).toMatch(/if \(newerRef\.current\) \{[^}]*setSaveState\(\{ kind: 'failed', reason: 'newer' \}\);\s*return;/);
  });

  it('the stored project is named in the user\'s words: its name, else its video\'s file name', () => {
    expect(storedProjectName(record(full, ' Düğün '))).toBe('Düğün');
    expect(storedProjectName(record(full))).toBe('tatil.mp4');
    expect(storedProjectName({ ...record(full), bindings: [] })).toBe('');
  });
});

describe('who may ask for a stored hand-over', () => {
  it('only "Yazıya dök", over a transcript with lines in it — written on this device or on the internet', () => {
    const yazi = read('src', 'components', 'wizard', 'YaziWizard.tsx');
    expect(yazi).toContain('const keepsOnHandoff = transcript !== undefined && hasLines;');
    expect(yazi).toContain('onOpenEditor={keepsOnHandoff ? () => setKeeping(true) : host.onOpenEditor}');
    // The part that stores is in every build, behind no build literal, and knows nothing of the route.
    expect(yazi).toMatch(/const KeepOnHandoff = lazyPart<KeepOnHandoffProps>\(\(\) => import\('@\/components\/transcript\/KeepOnHandoff'\)/);
    expect(yazi).not.toContain('CloudKeep');
    const keep = read('src', 'components', 'transcript', 'KeepOnHandoff.tsx');
    expect(keep).not.toMatch(/from '@\/(adapters\/cloud|components\/transcript\/Cloud|i18n\/cloudMessages)/);
    expect(keep).not.toContain("'cloud.");
    expect(keep).toContain("import { translator } from '@/i18n/messages';");
    // No other wizard, and not the shared frame, hands over anything but "unsaved" (ADR-034 stands for them).
    for (const file of ['wizards.tsx', 'IyilestirWizard.tsx', 'WizardFlow.tsx']) {
      const source = read('src', 'components', 'wizard', file);
      expect(source, file).not.toMatch(/onOpenEditor\(\s*\{/);
      expect(source, file).not.toContain('KeepOnHandoff');
    }
  });

  it('the route: stored only when asked, and then the recipe takes the stored project\'s place', () => {
    const route = read('src', 'components', 'wizard', 'TaskWizard.tsx');
    expect(route).toContain('const stored = handoff?.stored === true;');
    expect(route).toContain('<EditorView state={state} stored={editor.stored} adopt={editor.stored} />');
    // The stored project lives at /editor: a reload must land there.
    expect(route).toContain('window.history.replaceState(null, \'\', `${BASE_PATH}/editor${slash}`);');
  });
});

describe('what the user reads', () => {
  const KEEP_KEYS = (Object.keys(tr) as MessageKey[]).filter((key) => key.startsWith('wizard.yazi.keep'));

  it('before the hand-over: not stored yet, and the two ways to keep it — one sentence, in the table every build carries', () => {
    const note = tr['wizard.yazi.keepNote'];
    expect(note).toBe('Bu yazı henüz saklanmadı: editörde açarsan ya da metni indirirsen kalır, yoksa sayfa kapanınca gider.');
    expect(note.match(/[.!?]/g)).toHaveLength(1);
    // It names what the screen really offers: the editor link and the text file's button.
    expect(tr['wizard.moreSettings']).toContain('editörde aç');
    expect(tr['transcript.file.txt']).toContain('Metni indir');
    expect(en['wizard.yazi.keepNote']).toMatch(/not kept yet/);
    // The sentence is the wizard's own now: the cloud route's table has no copy of it.
    expect(Object.keys(cloudTr).filter((key) => key.startsWith('cloud.keep'))).toEqual([]);
    expect(Object.keys(cloudEn).filter((key) => key.startsWith('cloud.keep'))).toEqual([]);
  });

  it('the choice: each button says what it keeps and what that costs', () => {
    expect(tr['wizard.yazi.keep.old']).toBe('Eski proje kalsın (bu yazı saklanmaz)');
    expect(tr['wizard.yazi.keep.new']).toBe('Bu yazı saklansın (eski proje silinir)');
    expect(tr['wizard.yazi.keep.hint']).toContain('Vazgeçersen hiçbir şey değişmez');
    expect(en['wizard.yazi.keep.old']).toMatch(/not kept/);
    expect(en['wizard.yazi.keep.new']).toMatch(/deleted/);
  });

  it('plain words, no word of the cloud, and the same word for storing as the editor\'s header', () => {
    expect(KEEP_KEYS.length).toBeGreaterThanOrEqual(8);
    for (const key of KEEP_KEYS) {
      expect(strongJargon(tr[key]), key).toEqual([]);
      expect(tr[key], key).not.toMatch(/IndexedDB|kayıt deposu|veritabanı|tarif|senkron/i);
      // The published build carries these: nothing in them may speak of a route it does not have.
      expect(`${tr[key]}\n${en[key]}`, key).not.toMatch(/internet|bulut|cloud|AssemblyAI|davet|invite/i);
    }
    // "saklan-": what the header says once it is stored ("Düzenleme saklandı"), and when it is not.
    expect(tr['topbar.saveState.saved']).toBe('Düzenleme saklandı');
    expect(tr['wizard.editor.unsaved']).toBe('Bu düzenleme saklanmıyor');
    expect(tr['wizard.yazi.keepNote']).toContain('saklanmadı');
  });

  it('the privacy page of every build says the opened transcript is stored, and that an earlier project is asked about', () => {
    const body = tr['privacy.stored.project.body'];
    // The rule for the other wizards still stands, and is still said.
    expect(body).toContain('ana ekrandaki bir işten (Kes, Dikey yap…) başlattığın çalışma saklanmaz');
    // The one exception, in the words the screen uses.
    expect(body).toContain('Tek istisna “Yazıya dök”');
    expect(body).toContain(tr['wizard.moreSettings']);
    expect(body).toContain('burada proje olarak saklanır');
    expect(body).toContain('hangisinin kalacağı sana sorulur');
    // How it is deleted is the card's own "Ne zaman silinir" row, in the button's words.
    expect(tr['privacy.stored.project.delete']).toContain(tr['relink.discard']);
    expect(en['privacy.stored.project.body']).toContain('One exception, “Yazıya dök”');
    expect(en['privacy.stored.project.body']).toContain(en['wizard.moreSettings']);
    expect(en['privacy.stored.project.delete']).toContain(en['relink.discard']);
    // The sentences added for it are in plain words (the card's older list of file facts is not judged here).
    expect(strongJargon(body.slice(body.indexOf('Tek istisna')))).toEqual([]);
  });

  it('the privacy page of a build with the route says the same of the internet one, and what more it keeps', () => {
    expect(cloudTr['cloud.privacy.kept']).toContain('bu tarayıcıda proje olarak saklanır');
    expect(cloudTr['cloud.privacy.kept']).toContain(tr['relink.discard']);
    expect(cloudTr['cloud.privacy.kept']).toContain('hangisinin kalacağı sana sorulur');
    expect(cloudTr['cloud.privacy.stored.project.extra']).toContain('İnternette yazılan yazı için de aynı');
    expect(cloudTr['cloud.privacy.stored.project.extra']).toContain('kimin konuştuğu');
    expect(cloudEn['cloud.privacy.stored.project.extra']).toContain('The same for a text written on the internet');
    const page = read('src', 'components', 'PrivacyPage.tsx');
    expect(page).toContain("'cloud.privacy.kept',");
    expect(page).toContain("{CLOUD_ON && item.id === 'project' ? <p data-testid=\"stored-project-cloud\">{ct('cloud.privacy.stored.project.extra')}</p> : null}");
  });
});
