import Link from 'next/link';

import { Icon, Wordmark } from '@/components/Icon';
import { translator, type MessageKey } from '@/i18n/messages';

const t = translator('tr');

/** The kesit flow (ADR-026) in four steps, as the editor names its buttons. */
const STEPS: ReadonlyArray<readonly [MessageKey, MessageKey]> = [
  ['landing.step1.title', 'landing.step1.body'],
  ['landing.step2.title', 'landing.step2.body'],
  ['landing.step3.title', 'landing.step3.body'],
  ['landing.step4.title', 'landing.step4.body'],
];

export default function LandingPage() {
  return (
    <div className="landing">
      <header className="landing-bar">
        <Wordmark />
        <Link className="btn-primary-light" href="/editor" prefetch={false}>
          {t('nav.openEditor')}
          <Icon name="play" size={16} />
        </Link>
      </header>

      <main className="landing-main">
        <h1>{t('landing.title')}</h1>
        <p className="lede">{t('app.tagline')}</p>
        <Link className="btn-primary-light" href="/editor" prefetch={false}>
          {t('nav.openEditor')}
        </Link>

        <ol className="landing-steps">
          {STEPS.map(([title, body], index) => (
            <li className="landing-step" key={title}>
              <b>
                {index + 1}. {t(title)}
              </b>
              <span>{t(body)}</span>
            </li>
          ))}
        </ol>

        <p className="landing-note">
          {t('landing.note')} {t('app.workingName')}
        </p>
      </main>

      <footer className="landing-footer">
        <span>{t('footer.local')}</span>
        {/*
          prefetch={false} on the landing links: Next 16's static export writes
          nested segment payloads (editor/__next.editor/__PAGE__.txt) under a
          different name than its prefetcher requests, which 404s on GitHub
          Pages. A click still navigates normally.
        */}
        <Link href="/gizlilik" prefetch={false} data-testid="footer-privacy">
          {t('privacy.link')}
        </Link>
      </footer>
    </div>
  );
}
