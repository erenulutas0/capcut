import { FallbackLink, NavigationFallbackScope } from '@/components/FallbackLink';
import { Wordmark } from '@/components/Icon';
import { HomeIntro } from '@/components/home/HomeIntro';
import { TaskFinder } from '@/components/home/TaskFinder';
import { translator } from '@/i18n/messages';

import './home.css';

const t = translator('tr');

/**
 * A build with the internet route of "Yazıya dök" (ADR-039) cannot say "no cloud upload" here: the
 * sound of a video leaves when the user chooses it. Compared to the literal, so a build without the
 * route keeps today's sentences.
 */
const ONLINE_ROUTE = process.env.NEXT_PUBLIC_CLOUD_TRANSCRIPT === '1';

/**
 * The opening screen (ADR-034, founder decision 3 Oct 2026: designs A + C):
 * "Ne yapmak istiyorsun?" — a box to type what you want and, under it, a card
 * for every task that works today. A card opens that task's wizard
 * (`/yap/<id>/`): pick the video, at most one choice, İndir. The editor
 * stays one quiet link away ("Kendim düzenleyeceğim").
 *
 * It is the installed app's start page (`manifest.ts`) and is kept for
 * offline use by the service worker like every other page.
 *
 * No press here is ever silent (ADR-044 addendum, 14 and 15 Oct 2026): the
 * cards, the search results, "Kendim düzenleyeceğim" and the privacy link
 * share one guard (`NavigationFallbackScope`) — the pressed one says
 * "Açılıyor…", and a page whose data never arrives is loaded in full after
 * 10 s, once per visit of this screen.
 */
export default function HomePage() {
  return (
    <NavigationFallbackScope>
    <div className="home">
      <header className="home-bar">
        <Wordmark />
        {/*
          prefetch={false} on every link here (FallbackLink): Next 16's static
          export writes nested segment payloads
          (editor/__next.editor/__PAGE__.txt) under a different name than its
          prefetcher requests, which 404s on GitHub Pages. A click still
          navigates normally.
        */}
        <FallbackLink className="home-editor-link" href="/editor" data-testid="home-editor-link">
          {t('home.editorLink')}
        </FallbackLink>
      </header>

      <main className="home-main">
        {/* The title and, with a shared video in hand (ADR-047), that video and "Başka bir video seç". */}
        <HomeIntro />
        <TaskFinder />
      </main>

      <footer className="home-footer">
        <p className="home-trust" data-testid="home-trust">
          {t(ONLINE_ROUTE ? 'home.trust.online' : 'home.trust')}
        </p>
        <p className="home-note">
          {t(ONLINE_ROUTE ? 'landing.note.online' : 'landing.note')}{' '}
          <FallbackLink href="/gizlilik" data-testid="footer-privacy">
            {t('privacy.link')}
          </FallbackLink>
        </p>
      </footer>
    </div>
    </NavigationFallbackScope>
  );
}
