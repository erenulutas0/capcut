import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { cloudOriginFromEnv, normalizeCloudOrigin } from '../../scripts/lib/cloudOrigin.mjs';
import { controllerNameFromEnv, normalizeControllerName } from '../../scripts/lib/dataController.mjs';
import { applyCsp, buildPolicy, inlineHashes } from '../../scripts/lib/csp.mjs';
import { tr } from '@/i18n/messages';
import { en } from '@/i18n/messages.en';
import { cloudTr, cloudTranslator, type CloudMessageKey } from '@/i18n/cloudMessages';
import { cloudEn } from '@/i18n/cloudMessages.en';

import { strongJargon } from '../quality/lib/jargon';

/**
 * The cloud transcript route (ADR-039) is a build-time matter: one setting,
 * `NEXT_PUBLIC_CLOUD_TRANSCRIPT_URL`, empty by default. These checks hold the
 * two things that follow from it — the policy gains exactly one origin or
 * none, and the route's words are kept out of the table every page carries —
 * and the rules the route's own words must keep.
 */

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), 'utf8');

describe('the one setting', () => {
  it('empty or absent: the route is off', () => {
    for (const value of [undefined, '', '   ']) expect(normalizeCloudOrigin(value)).toBe('');
    expect(cloudOriginFromEnv({})).toBe('');
    expect(cloudOriginFromEnv({ NEXT_PUBLIC_CLOUD_TRANSCRIPT_URL: '' })).toBe('');
  });

  it('one https origin, as the browser compares it', () => {
    expect(normalizeCloudOrigin('https://lilocut-transcript-proxy.example.workers.dev')).toBe('https://lilocut-transcript-proxy.example.workers.dev');
    expect(normalizeCloudOrigin(' https://proxy.example.com/ ')).toBe('https://proxy.example.com');
    expect(normalizeCloudOrigin('https://proxy.example.com:8443')).toBe('https://proxy.example.com:8443');
  });

  it('anything that is not one bare origin stops the build', () => {
    for (const bad of [
      'proxy.example.com',
      'https://proxy.example.com/v1',
      'https://proxy.example.com/?x=1',
      'https://proxy.example.com/#a',
      'https://user:pass@proxy.example.com',
      'https://*.workers.dev',
      'https://a.example https://b.example',
      "https://a.example'; script-src *",
      'https://a.example; connect-src *',
      'https://Proxy.Example.com',
      'https://proxy.example.com:443',
      'wss://proxy.example.com',
      'ftp://proxy.example.com',
      '*',
      'https:',
    ]) {
      expect(() => normalizeCloudOrigin(bad), bad).toThrow(/NEXT_PUBLIC_CLOUD_TRANSCRIPT_URL/);
    }
  });

  it('plain http only for a loopback address in the test-hooks build — never in what is published', () => {
    expect(() => normalizeCloudOrigin('http://127.0.0.1:38197')).toThrow(/https/);
    expect(() => normalizeCloudOrigin('http://proxy.example.com', { allowLoopbackHttp: true })).toThrow(/https/);
    expect(normalizeCloudOrigin('http://127.0.0.1:38197', { allowLoopbackHttp: true })).toBe('http://127.0.0.1:38197');
    expect(cloudOriginFromEnv({ NEXT_PUBLIC_CLOUD_TRANSCRIPT_URL: 'http://127.0.0.1:38197', CLIP_TEST_HOOKS: '1' })).toBe('http://127.0.0.1:38197');
    expect(() => cloudOriginFromEnv({ NEXT_PUBLIC_CLOUD_TRANSCRIPT_URL: 'http://127.0.0.1:38197' })).toThrow();
    // The static export refuses test hooks (next.config.ts), so a published site can only carry an https origin.
    expect(read('next.config.ts')).toMatch(/if \(testHooks && staticExport\) \{\s*throw new Error/);
  });
});

describe('the data controller (doc 30 K02; founder decision 14 Oct 2026)', () => {
  it('a plain name from the deploy build, or nothing — and never an address', () => {
    for (const value of [undefined, '', '  ']) expect(normalizeControllerName(value)).toBe('');
    expect(controllerNameFromEnv({})).toBe('');
    expect(normalizeControllerName('  Ad Soyad ')).toBe('Ad Soyad');
    expect(normalizeControllerName('Çağrı Öztürk-Işık')).toBe('Çağrı Öztürk-Işık');
    for (const bad of ['ad@example.com', 'Ad Soyad <ad@example.com>', 'https://example.com', 'www.example.com', 'x'.repeat(121)]) {
      expect(() => normalizeControllerName(bad), bad).toThrow(/NEXT_PUBLIC_DATA_CONTROLLER_NAME/);
    }
    // The build checks it; the page reads it, and its contact is the support contact.
    expect(read('next.config.ts')).toContain('controllerNameFromEnv()');
    const page = read('src', 'components', 'PrivacyPage.tsx');
    expect(page).toContain('process.env.NEXT_PUBLIC_DATA_CONTROLLER_NAME');
    expect(page).toMatch(/\['privacy\.controller\.contact', controllerName && supportContact \? supportContact : null\]/);
  });

  it('the deploy build is handed the repository variable, and nothing breaks while it is undefined', () => {
    const ci = read('..', '.github', 'workflows', 'ci.yml');
    expect(ci.match(/NEXT_PUBLIC_DATA_CONTROLLER_NAME: \$\{\{ vars\.DATA_CONTROLLER_NAME \}\}/g)).toHaveLength(2);
    // The cloud suite stops the deploy exactly when the route is in the site.
    expect(ci).toContain("continue-on-error: ${{ vars.CLOUD_TRANSCRIPT_URL == '' }}");
  });

  it('says who it is in both languages, as a person, until a company exists', () => {
    expect(tr['privacy.controller.person']).toBe('{name} — kişi olarak; şirket kurulunca güncellenecek');
    expect(en['privacy.controller.person']).toContain('{name}');
    expect(en['privacy.controller.person']).toContain('private person');
    for (const locale of [tr, en]) expect(locale['privacy.controller.note.named']).not.toMatch(/@/);
  });
});

describe('the policy', () => {
  const PAGE = '<!DOCTYPE html><html lang="tr"><head><meta charSet="utf-8"/><script src="/a.js" async=""></script></head><body><p>x</p></body></html>';
  const connect = (policy: string) => /connect-src ([^;]*);/.exec(policy)?.[1];

  it('without the setting: same-origin only, byte for byte what it was', () => {
    expect(connect(buildPolicy(inlineHashes(PAGE)))).toBe("'self'");
    expect(buildPolicy(inlineHashes(PAGE), { connectOrigin: '' })).toBe(buildPolicy(inlineHashes(PAGE)));
    expect(applyCsp(PAGE).html).toBe(applyCsp(PAGE, {}).html);
    expect(applyCsp(PAGE).policy).not.toMatch(/https?:/);
  });

  it('with it: exactly that one origin more, in connect-src and nowhere else', () => {
    const origin = 'https://lilocut-transcript-proxy.example.workers.dev';
    const off = buildPolicy(inlineHashes(PAGE));
    const on = buildPolicy(inlineHashes(PAGE), { connectOrigin: origin });
    expect(connect(on)).toBe(`'self' ${origin}`);
    expect(on.replace(` ${origin}`, '')).toBe(off);
    expect(on.split(origin)).toHaveLength(2);
    // The provider's own address is never in the policy: the browser does not talk to it.
    expect(on).not.toContain('assemblyai');
    expect(applyCsp(PAGE, { connectOrigin: origin }).html).toContain(`connect-src 'self' ${origin};`);
  });

  it('refuses anything but a bare origin, whatever handed it over', () => {
    for (const bad of ['*', 'https://*.workers.dev', 'https://a.example/path', "https://a.example 'unsafe-inline'", 'https://a.example; script-src *', 'https:']) {
      expect(() => buildPolicy(inlineHashes(PAGE), { connectOrigin: bad }), bad).toThrow(/bare origin/);
    }
  });

  it('the build step and the page read the setting through the same function', () => {
    expect(read('scripts', 'apply-csp.mjs')).toContain('cloudOriginFromEnv()');
    expect(read('next.config.ts')).toContain('cloudOriginFromEnv()');
    // The export is looked at: a build without the setting that carries the route's code stops.
    expect(read('scripts', 'apply-csp.mjs')).toMatch(/CLOUD_MARKERS = \['\/v1\/jobs', '\/v1\/quota', 'AssemblyAI'\]/);
  });
});

describe('the route is not in the build unless it is on', () => {
  it('the two places that load it compare the build\'s literal themselves (an imported flag is not folded before chunking)', () => {
    for (const file of [['src', 'components', 'wizard', 'YaziWizard.tsx'], ['src', 'components', 'transcript', 'CloudInviteSlot.tsx']]) {
      const source = read(...file);
      expect(source, file.join('/')).toMatch(/process\.env\.NEXT_PUBLIC_CLOUD_TRANSCRIPT === '1'\s*\? lazyPart/);
      // Nothing of the route is imported for its value (types only: they are erased).
      expect(source.match(/^import (?!type)[^;]*from '@\/(adapters\/cloud|components\/transcript\/Cloud(Route|InvitePanel|Keep)|i18n\/cloudMessages)[^']*';/gm) ?? [], file.join('/')).toEqual([]);
    }
  });

  it('its words are not in the table every page carries', () => {
    const everywhere = [...Object.values(tr), ...Object.values(en)].join('\n');
    expect(everywhere).not.toMatch(/AssemblyAI|Cloudflare|davet kodu|invite code/i);
    expect(Object.keys(tr).filter((key) => key.startsWith('cloud.'))).toEqual([]);
  });
});

describe('the route\'s own words', () => {
  const keys = Object.keys(cloudTr) as CloudMessageKey[];
  /** What the screens say — everything but the privacy page's longer explanations. */
  const screenKeys = keys.filter((key) => !key.startsWith('cloud.privacy.'));

  it('Turkish and English have the same keys, none empty', () => {
    expect(Object.keys(cloudEn).sort()).toEqual([...keys].sort());
    for (const key of keys) {
      expect(cloudTr[key].trim().length, key).toBeGreaterThan(0);
      expect(cloudEn[key].trim().length, key).toBeGreaterThan(0);
      // The same blanks to fill, and the same number of bold marks, in both.
      expect((cloudEn[key].match(/\{\w+\}/g) ?? []).sort(), key).toEqual((cloudTr[key].match(/\{\w+\}/g) ?? []).sort());
      expect((cloudEn[key].match(/\*\*/g) ?? []).length, key).toBe((cloudTr[key].match(/\*\*/g) ?? []).length);
      expect((cloudTr[key].match(/\*\*/g) ?? []).length % 2, key).toBe(0);
    }
    expect(cloudTranslator('tr')('cloud.online.go')).toBe('Sesi gönder ve yaz');
    expect(cloudTranslator('en')('cloud.online.go')).toBe(cloudEn['cloud.online.go']);
  });

  it('the consent screen is the founder\'s text of 11 Oct 2026, word for word', () => {
    expect(cloudTr['cloud.choice.title']).toBe('Yazıyı nerede çıkaralım?');
    expect(cloudTr['cloud.device.title']).toBe('Cihazımda');
    expect(cloudTr['cloud.device.body']).toBe('Hiçbir şey gitmez. Daha yavaş, biraz daha az doğru. Kimin konuştuğunu ayırmaz.');
    expect(cloudTr['cloud.device.go']).toBe('Cihazımda yaz');
    expect(cloudTr['cloud.online.title']).toBe('İnternette');
    expect(cloudTr['cloud.online.body']).toBe('Daha doğru, çok daha hızlı. Kimin konuştuğunu da ayırır.');
    expect(cloudTr['cloud.online.fact.sound']).toBe('**Yalnızca ses** gider, görüntü gitmez.');
    expect(cloudTr['cloud.online.fact.who']).toBe('**AssemblyAI** adlı bir şirkete gider. Bilgisayarları Avrupa’da.');
    expect(cloudTr['cloud.online.fact.deleted']).toBe('Yazı gelince oradaki ses ve yazı **silinir**.');
    expect(cloudTr['cloud.online.fact.others']).toBe('Başka insanlar konuşuyorsa **onların sesi de gider**.');
    expect(cloudTr['cloud.online.minutes']).toBe('Yaklaşık {n} dakika sürer · {x} dakika düşer, {y} dakikan kalır');
    expect(cloudTr['cloud.online.go']).toBe('Sesi gönder ve yaz');
    expect(cloudTr['cloud.machine']).toBe('İnternette yazıldı — yanlış olabilir, düzeltebilirsin.');
    expect(cloudTr['cloud.invite.need']).toBe('Bunu kullanmak için davet kodu gerekiyor.');
    expect(cloudTr['cloud.invite.save']).toBe('Kodu kaydet');
  });

  it('no word we cannot show to be true (ADR-039 "Rıza ekranı")', () => {
    const unprovableTr = /güvenli|şifreli|anonim|kimse dinlemez|eğitimde kullanılmaz|gizli kalır|garanti/i;
    const unprovableEn = /\bsecure|\bsafe\b|encrypt|anonym|nobody listens|not used for training|never used to train|guarantee/i;
    for (const key of keys) {
      expect(cloudTr[key], key).not.toMatch(unprovableTr);
      expect(cloudEn[key], key).not.toMatch(unprovableEn);
    }
  });

  it('no invented number: the on-device card promises no minutes, and nothing is said in per cent', () => {
    expect(cloudTr['cloud.device.time']).not.toMatch(/\d/);
    for (const key of keys) expect(cloudTr[key], key).not.toContain('%');
    // The one time claim of the internet card is a blank filled from the measured model, said as "yaklaşık".
    expect(cloudTr['cloud.online.minutes']).toMatch(/^Yaklaşık \{n\} dakika sürer/);
    // What the provider says about its own deletion is said as its statement, not as our fact.
    expect(cloudTr['cloud.cleanup.unstarted']).toMatch(/AssemblyAI .* söylüyor\.$/);
  });

  it('plain words on the screens: no engineering vocabulary, Turkish decimals', () => {
    const found = screenKeys.flatMap((key) => strongJargon(cloudTr[key]).map((hit) => `${key}: ${hit.term} — “${hit.context}”`));
    expect(found).toEqual([]);
    for (const key of keys) {
      expect(cloudTr[key], key).not.toMatch(/\d\.\d/);
      expect(cloudEn[key], key).not.toMatch(/\d,\d/);
    }
  });

  it('the product is named from one place', () => {
    for (const key of keys) {
      expect(cloudTr[key], key).not.toMatch(/\bClip\b|CapCut/);
      expect(cloudEn[key], key).not.toMatch(/\bClip\b(?! \{)|CapCut/);
    }
    expect(read('src', 'i18n', 'cloudMessages.ts')).toContain("import { APP_NAME } from '../appIdentity';");
  });
});
