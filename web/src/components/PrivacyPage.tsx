import Link from 'next/link';

import { Wordmark } from '@/components/Icon';
import { ExportLogPanel } from '@/components/ExportLogPanel';
import { LanguageChoicePanel } from '@/components/LanguageChoicePanel';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { CloudInviteSlot } from '@/components/transcript/CloudInviteSlot';
import { ModelStoragePanel } from '@/components/transcript/ModelStoragePanel';
import type { CloudMessageKey } from '@/i18n/cloudMessages';
import { PROVIDER_PAGES, cloudTranslator } from '@/i18n/cloudTranslate';
import { localizedPath } from '@/i18n/localePath';
import type { MessageKey } from '@/i18n/messages';
import { translator, type Locale } from '@/i18n/translate';

/**
 * The in-app privacy page (/gizlilik, /gizlilik/en).
 *
 * Every sentence describes behaviour that exists in the code today; the
 * source of truth is docs/privacy/DATA_INVENTORY.md, which cites the files.
 * Facts the founder has not decided (doc 30 K02) are rendered as a visible
 * "belirlenmedi" marker rather than filled with plausible-looking data:
 * a made-up company name here would be worse than an honest gap.
 *
 * Build-time values are read from process.env directly: this is a server
 * component and cannot take constants from a 'use client' module.
 *
 * The cloud transcript route (ADR-039) exists only in a build that names our
 * proxy. In every other build — the published site today — this page says
 * what it always said: nothing leaves the device. In a build WITH the route
 * the sentences that would then be untrue are replaced (`CLOUD_SWAPS`), and
 * the route gets its own section: what is sent, to whom, where, when it is
 * deleted, and the invite code kept in this browser.
 */

/** '1' only in a build that names the proxy (next.config.ts). */
const CLOUD_ON = process.env.NEXT_PUBLIC_CLOUD_TRANSCRIPT === '1';

/** What the route's section says, in order. */
const CLOUD_FACTS: CloudMessageKey[] = [
  'cloud.privacy.what',
  'cloud.privacy.who',
  'cloud.privacy.region',
  'cloud.privacy.deletion',
  'cloud.privacy.retention',
  'cloud.privacy.kept',
  'cloud.privacy.others',
  'cloud.privacy.ledger',
  'cloud.privacy.quota',
  'cloud.privacy.training',
  'cloud.privacy.trial',
];

const STORED: Array<{ name: MessageKey; body: MessageKey; where: MessageKey; delete: MessageKey; id: string }> = [
  {
    id: 'project',
    name: 'privacy.stored.project.name',
    body: 'privacy.stored.project.body',
    where: 'privacy.stored.project.where',
    delete: 'privacy.stored.project.delete',
  },
  {
    id: 'log',
    name: 'privacy.stored.log.name',
    body: 'privacy.stored.log.body',
    where: 'privacy.stored.log.where',
    delete: 'privacy.stored.log.delete',
  },
  {
    id: 'temp',
    name: 'privacy.stored.temp.name',
    body: 'privacy.stored.temp.body',
    where: 'privacy.stored.temp.where',
    delete: 'privacy.stored.temp.delete',
  },
  {
    id: 'memory',
    name: 'privacy.stored.memory.name',
    body: 'privacy.stored.memory.body',
    where: 'privacy.stored.memory.where',
    delete: 'privacy.stored.memory.delete',
  },
  {
    id: 'hint',
    name: 'privacy.stored.hint.name',
    body: 'privacy.stored.hint.body',
    where: 'privacy.stored.hint.where',
    delete: 'privacy.stored.hint.delete',
  },
  {
    // ADR-044: written only when a page did not come alive and reloaded itself once.
    id: 'recovery',
    name: 'privacy.stored.recovery.name',
    body: 'privacy.stored.recovery.body',
    where: 'privacy.stored.recovery.where',
    delete: 'privacy.stored.recovery.delete',
  },
  {
    id: 'offline',
    name: 'privacy.stored.offline.name',
    body: 'privacy.stored.offline.body',
    where: 'privacy.stored.offline.where',
    delete: 'privacy.stored.offline.delete',
  },
  {
    // ADR-047: a video shared to the app from the phone's share menu, until a task takes it.
    id: 'shared',
    name: 'privacy.stored.shared.name',
    body: 'privacy.stored.shared.body',
    where: 'privacy.stored.shared.where',
    delete: 'privacy.stored.shared.delete',
  },
  {
    // ADR-036: the speech model of "Yazıya dök", only after an explicit download.
    id: 'model',
    name: 'privacy.stored.model.name',
    body: 'privacy.stored.model.body',
    where: 'privacy.stored.model.where',
    delete: 'privacy.stored.model.delete',
  },
  {
    // ADR-036 addendum (14 Oct 2026): written only when the large model failed while writing here.
    id: 'largeNote',
    name: 'privacy.stored.largeNote.name',
    body: 'privacy.stored.largeNote.body',
    where: 'privacy.stored.largeNote.where',
    delete: 'privacy.stored.largeNote.delete',
  },
  {
    // ADR-048: written only when the language button is used.
    id: 'language',
    name: 'privacy.stored.language.name',
    body: 'privacy.stored.language.body',
    where: 'privacy.stored.language.where',
    delete: 'privacy.stored.language.delete',
  },
];

const DOWNLOADS: MessageKey[] = [
  'privacy.downloads.mp4',
  'privacy.downloads.backup',
  'privacy.downloads.subtitles',
  'privacy.downloads.share',
  'privacy.downloads.diag',
];

function Undecided({ label }: { label: string }) {
  return (
    <span className="legal-undecided" data-testid="undecided">
      {label}
    </span>
  );
}

export function PrivacyPage({ locale }: { locale: Locale }) {
  const t = translator(locale);
  const ct = cloudTranslator(locale);
  const undecided = t('privacy.undecided');
  const supportContact = (process.env.NEXT_PUBLIC_SUPPORT_CONTACT ?? '').trim();
  // The data controller (doc 30 K02; founder decision 14 Oct 2026): the founder, as a private person, until a
  // company exists. Only the deploy build names them; the contact is the support contact above. Without the
  // name the page says "belirlenmedi" — it never guesses one.
  const controllerName = (process.env.NEXT_PUBLIC_DATA_CONTROLLER_NAME ?? '').trim();
  // Set by the deploy build only (language-neutral values: a name and a URL).
  // Without them the page keeps saying "belirlenmedi" instead of guessing.
  const hostingProvider = (process.env.NEXT_PUBLIC_HOSTING_PROVIDER ?? '').trim();
  const hostingLogPolicy = (process.env.NEXT_PUBLIC_HOSTING_LOG_POLICY ?? '').trim();
  const updated = t('privacy.updated')
    .replace('{version}', process.env.NEXT_PUBLIC_APP_VERSION ?? 'dev')
    .replace('{commit}', process.env.NEXT_PUBLIC_GIT_COMMIT ?? 'unknown');

  const controller: Array<[MessageKey, string | null]> = [
    ['privacy.controller.name', controllerName ? t('privacy.controller.person').replace('{name}', controllerName) : null],
    ['privacy.controller.contact', controllerName && supportContact ? supportContact : null],
    ['privacy.controller.country', null],
    ['privacy.controller.basis', null],
    ['privacy.controller.rights', null],
    ['privacy.controller.support', supportContact || null],
    ['privacy.network.host', hostingProvider || null],
    ['privacy.network.logs', hostingLogPolicy || null],
  ];

  return (
    <div className="landing legal" lang={locale}>
      <header className="landing-bar">
        <Link href={localizedPath('/', locale)} aria-label={t('privacy.back')} className="legal-home">
          <Wordmark />
        </Link>
        {/* The app's one language button (ADR-048): the other language's page, and the choice remembered. */}
        <LanguageSwitch className="btn-ghost-light" testId="privacy-language" />
      </header>

      <main className="legal-main">
        <p className="legal-eyebrow">{t('privacy.eyebrow')}</p>
        <h1>{t('privacy.heading')}</h1>

        <div className="legal-draft" role="note" data-testid="privacy-draft">
          <b>{t(controllerName ? 'privacy.draftBadge.named' : 'privacy.draftBadge')}</b>
          <p>{t('privacy.draftBody')}</p>
        </div>

        <section aria-labelledby="privacy-summary">
          <h2 id="privacy-summary">{t('privacy.summary.title')}</h2>
          <ul className="legal-list">
            <li data-testid="privacy-local">{CLOUD_ON ? ct('cloud.privacy.summary.local') : t('privacy.summary.local')}</li>
            <li>{t('privacy.summary.nothingCollected')}</li>
            <li data-testid="privacy-search">{t('privacy.summary.search')}</li>
            <li>{t('privacy.summary.stored')}</li>
            <li>{CLOUD_ON ? ct('cloud.privacy.summary.report') : t('privacy.summary.report')}</li>
          </ul>
        </section>

        <section aria-labelledby="privacy-network">
          <h2 id="privacy-network">{t('privacy.network.title')}</h2>
          <p>{t('privacy.network.body')}</p>
          {CLOUD_ON ? <p data-testid="privacy-network-cloud">{ct('cloud.privacy.network.extra')}</p> : null}
        </section>

        {CLOUD_ON ? (
          <section aria-labelledby="privacy-cloud" data-testid="privacy-cloud">
            <h2 id="privacy-cloud">{ct('cloud.privacy.title')}</h2>
            <p>{ct('cloud.privacy.intro')}</p>
            <ul className="legal-list">
              {CLOUD_FACTS.map((key) => (
                <li key={key}>{ct(key)}</li>
              ))}
              <li data-testid="privacy-cloud-provider">
                {ct('cloud.privacy.provider')}{' '}
                <a href={PROVIDER_PAGES.retention} rel="noopener noreferrer" hrefLang="en">
                  {ct('cloud.privacy.provider.retention')}
                </a>
                {' · '}
                <a href={PROVIDER_PAGES.dpa} rel="noopener noreferrer" hrefLang="en">
                  {ct('cloud.privacy.provider.dpa')}
                </a>
              </li>
              <li data-testid="privacy-cloud-controller">
                {ct(controllerName ? 'cloud.privacy.controller.named' : 'cloud.privacy.controller.unset')}
              </li>
            </ul>
          </section>
        ) : null}

        <section aria-labelledby="privacy-stored">
          <h2 id="privacy-stored">{t('privacy.stored.title')}</h2>
          {/* A definition list per item instead of a wide table: it reflows on a phone. */}
          {STORED.map((item) => (
            <article className="legal-card" key={item.id} data-testid={`stored-${item.id}`}>
              <h3>{t(item.name)}</h3>
              <p>{t(item.body)}</p>
              {/* The body names the one wizard hand-over that IS stored; a build with the route adds what of the internet one is kept (ADR-034 addendum). */}
              {CLOUD_ON && item.id === 'project' ? <p data-testid="stored-project-cloud">{ct('cloud.privacy.stored.project.extra')}</p> : null}
              {/* A shared video is a video like any picked one: in this build its sound leaves only on "İnternette" (ADR-047). */}
              {CLOUD_ON && item.id === 'shared' ? <p data-testid="stored-shared-cloud">{ct('cloud.privacy.stored.shared.extra')}</p> : null}
              <dl>
                <dt>{t('privacy.stored.where')}</dt>
                <dd>{t(item.where)}</dd>
                <dt>{t('privacy.stored.howLong')}</dt>
                <dd>{t(item.delete)}</dd>
              </dl>
              {item.id === 'log' ? (
                <ExportLogPanel locale={locale} buttonClassName="btn-ghost-light" />
              ) : null}
              {item.id === 'model' ? <ModelStoragePanel locale={locale} buttonClassName="btn-ghost-light" /> : null}
              {item.id === 'language' ? <LanguageChoicePanel buttonClassName="btn-ghost-light" /> : null}
            </article>
          ))}
          {CLOUD_ON ? (
            <article className="legal-card" data-testid="stored-invite">
              <h3>{ct('cloud.privacy.stored.invite.name')}</h3>
              <p>{ct('cloud.privacy.stored.invite.body')}</p>
              <dl>
                <dt>{t('privacy.stored.where')}</dt>
                <dd>{ct('cloud.privacy.stored.invite.where')}</dd>
                <dt>{t('privacy.stored.howLong')}</dt>
                <dd>{ct('cloud.privacy.stored.invite.delete')}</dd>
              </dl>
              <CloudInviteSlot
                buttonClassName="btn-ghost-light"
                words={{
                  present: ct('cloud.privacy.invite.present'),
                  absent: ct('cloud.privacy.invite.absent'),
                  remove: ct('cloud.invite.remove'),
                  removed: ct('cloud.invite.removed'),
                }}
              />
            </article>
          ) : null}
          <p>{CLOUD_ON ? ct('cloud.privacy.stored.none') : t('privacy.stored.none')}</p>
        </section>

        <section aria-labelledby="privacy-downloads">
          <h2 id="privacy-downloads">{t('privacy.downloads.title')}</h2>
          <p>{t('privacy.downloads.body')}</p>
          <ul className="legal-list">
            {DOWNLOADS.map((key) => (
              <li key={key}>{t(key)}</li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="privacy-not-collected">
          <h2 id="privacy-not-collected">{t('privacy.notCollected.title')}</h2>
          <p data-testid="privacy-not-collected">{CLOUD_ON ? ct('cloud.privacy.notCollected.body') : t('privacy.notCollected.body')}</p>
        </section>

        <section aria-labelledby="privacy-report">
          <h2 id="privacy-report">{t('privacy.report.title')}</h2>
          <p>{t('privacy.report.body')}</p>
        </section>

        <section aria-labelledby="privacy-controller">
          <h2 id="privacy-controller">{t('privacy.controller.title')}</h2>
          <dl className="legal-facts" data-testid="privacy-controller">
            {controller.map(([key, value]) => (
              <div key={key} data-testid={`controller-${key.slice(key.lastIndexOf('.') + 1)}`}>
                <dt>{t(key)}</dt>
                <dd>{value ?? <Undecided label={undecided} />}</dd>
              </div>
            ))}
          </dl>
          {/* The contact is the support contact; when that is a public issue tracker, say so (as "Sorun bildir" does). */}
          {controllerName && /^https:\/\/github\.com\/[^/]+\/[^/]+\/issues/.test(supportContact) ? (
            <p className="legal-muted" data-testid="privacy-contact-public">
              {t('support.publicWarning')}
            </p>
          ) : null}
          <p className="legal-muted" data-testid="privacy-controller-note">
            {t(controllerName ? 'privacy.controller.note.named' : 'privacy.controller.note')}
          </p>
        </section>

        <p className="legal-muted" data-testid="privacy-updated">
          {updated}
        </p>
      </main>

      <footer className="landing-footer">
        <Link href={localizedPath('/', locale)}>{t('privacy.back')}</Link>
      </footer>
    </div>
  );
}
