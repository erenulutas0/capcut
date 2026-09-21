import Link from 'next/link';

import { Wordmark } from '@/components/Icon';
import { ExportLogPanel } from '@/components/ExportLogPanel';
import { translator, type Locale, type MessageKey } from '@/i18n/messages';

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
 */

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
];

const DOWNLOADS: MessageKey[] = [
  'privacy.downloads.mp4',
  'privacy.downloads.backup',
  'privacy.downloads.subtitles',
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
  const undecided = t('privacy.undecided');
  const supportContact = (process.env.NEXT_PUBLIC_SUPPORT_CONTACT ?? '').trim();
  // Set by the deploy build only (language-neutral values: a name and a URL).
  // Without them the page keeps saying "belirlenmedi" instead of guessing.
  const hostingProvider = (process.env.NEXT_PUBLIC_HOSTING_PROVIDER ?? '').trim();
  const hostingLogPolicy = (process.env.NEXT_PUBLIC_HOSTING_LOG_POLICY ?? '').trim();
  const updated = t('privacy.updated')
    .replace('{version}', process.env.NEXT_PUBLIC_APP_VERSION ?? 'dev')
    .replace('{commit}', process.env.NEXT_PUBLIC_GIT_COMMIT ?? 'unknown');

  const controller: Array<[MessageKey, string | null]> = [
    ['privacy.controller.name', null],
    ['privacy.controller.contact', null],
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
        <Link href="/" aria-label={t('privacy.back')} className="legal-home">
          <Wordmark />
        </Link>
        <Link
          // No prefetch: Next 16's static export writes nested segment payloads
          // under a different name than the prefetcher asks for (404s on Pages).
          prefetch={false}
          className="btn-ghost-light"
          href={locale === 'tr' ? '/gizlilik/en' : '/gizlilik'}
          hrefLang={locale === 'tr' ? 'en' : 'tr'}
          lang={locale === 'tr' ? 'en' : 'tr'}
          data-testid="privacy-language"
        >
          {t('privacy.otherLanguage')}
        </Link>
      </header>

      <main className="legal-main">
        <p className="legal-eyebrow">{t('privacy.eyebrow')}</p>
        <h1>{t('privacy.heading')}</h1>

        <div className="legal-draft" role="note" data-testid="privacy-draft">
          <b>{t('privacy.draftBadge')}</b>
          <p>{t('privacy.draftBody')}</p>
        </div>

        <section aria-labelledby="privacy-summary">
          <h2 id="privacy-summary">{t('privacy.summary.title')}</h2>
          <ul className="legal-list">
            <li>{t('privacy.summary.local')}</li>
            <li>{t('privacy.summary.nothingCollected')}</li>
            <li>{t('privacy.summary.stored')}</li>
            <li>{t('privacy.summary.report')}</li>
          </ul>
        </section>

        <section aria-labelledby="privacy-network">
          <h2 id="privacy-network">{t('privacy.network.title')}</h2>
          <p>{t('privacy.network.body')}</p>
        </section>

        <section aria-labelledby="privacy-stored">
          <h2 id="privacy-stored">{t('privacy.stored.title')}</h2>
          {/* A definition list per item instead of a wide table: it reflows on a phone. */}
          {STORED.map((item) => (
            <article className="legal-card" key={item.id} data-testid={`stored-${item.id}`}>
              <h3>{t(item.name)}</h3>
              <p>{t(item.body)}</p>
              <dl>
                <dt>{t('privacy.stored.where')}</dt>
                <dd>{t(item.where)}</dd>
                <dt>{t('privacy.stored.howLong')}</dt>
                <dd>{t(item.delete)}</dd>
              </dl>
              {item.id === 'log' ? (
                <ExportLogPanel locale={locale} buttonClassName="btn-ghost-light" />
              ) : null}
            </article>
          ))}
          <p>{t('privacy.stored.none')}</p>
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
          <p>{t('privacy.notCollected.body')}</p>
        </section>

        <section aria-labelledby="privacy-report">
          <h2 id="privacy-report">{t('privacy.report.title')}</h2>
          <p>{t('privacy.report.body')}</p>
        </section>

        <section aria-labelledby="privacy-controller">
          <h2 id="privacy-controller">{t('privacy.controller.title')}</h2>
          <dl className="legal-facts" data-testid="privacy-controller">
            {controller.map(([key, value]) => (
              <div key={key}>
                <dt>{t(key)}</dt>
                <dd>{value ?? <Undecided label={undecided} />}</dd>
              </div>
            ))}
          </dl>
          <p className="legal-muted">{t('privacy.controller.note')}</p>
        </section>

        <p className="legal-muted" data-testid="privacy-updated">
          {updated}
        </p>
      </main>

      <footer className="landing-footer">
        <Link href="/">{t('privacy.back')}</Link>
      </footer>
    </div>
  );
}
