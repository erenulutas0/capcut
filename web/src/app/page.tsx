import Link from 'next/link';

import { Wordmark } from '@/components/Icon';
import { TaskFinder } from '@/components/home/TaskFinder';
import { translator } from '@/i18n/messages';

import './home.css';

const t = translator('tr');

/**
 * The opening screen (ADR-034, founder decision 3 Oct 2026: designs A + C):
 * "Ne yapmak istiyorsun?" — a box to type what you want and, under it, a card
 * for every task that works today. A card opens that task's wizard
 * (`/yap/<id>/`): pick the video, at most one choice, İndir. The editor
 * stays one quiet link away ("Kendim düzenleyeceğim").
 *
 * It is the installed app's start page (`manifest.ts`) and is kept for
 * offline use by the service worker like every other page.
 */
export default function HomePage() {
  return (
    <div className="home">
      <header className="home-bar">
        <Wordmark />
        {/*
          prefetch={false} on every link here: Next 16's static export writes
          nested segment payloads (editor/__next.editor/__PAGE__.txt) under a
          different name than its prefetcher requests, which 404s on GitHub
          Pages. A click still navigates normally.
        */}
        <Link className="home-editor-link" href="/editor" prefetch={false} data-testid="home-editor-link">
          {t('home.editorLink')}
        </Link>
      </header>

      <main className="home-main">
        <h1 className="home-title">{t('home.title')}</h1>
        <p className="home-lede">{t('home.lede')}</p>
        <TaskFinder />
      </main>

      <footer className="home-footer">
        <p className="home-trust" data-testid="home-trust">
          {t('home.trust')}
        </p>
        <p className="home-note">
          {t('landing.note')} {t('app.workingName')}{' '}
          <Link href="/gizlilik" prefetch={false} data-testid="footer-privacy">
            {t('privacy.link')}
          </Link>
        </p>
      </footer>
    </div>
  );
}
