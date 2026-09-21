import Link from 'next/link';

import { Icon, Wordmark } from '@/components/Icon';
import { translator } from '@/i18n/messages';

const t = translator('tr');

const STEPS = [
  ['Videonu seç', 'Dosya bilgisayarından çıkmaz. Tarayıcıda açılır.'],
  ['Anları işaretle', 'Başlangıç ve bitiş ver; istediğin kadar an ekle.'],
  ['Sırala', 'Kartları yukarı-aşağı taşı; çıktı sırası değişsin.'],
  ['Görüntü ve sesi ayarla', 'Dikey, yatay veya kare; kendi müziğini ekle.'],
] as const;

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
        <h1>Video düzenlemeyi öğrenmeden, tutmak istediğin anları seç.</h1>
        <p className="lede">{t('app.tagline')}</p>
        <Link className="btn-primary-light" href="/editor" prefetch={false}>
          {t('nav.openEditor')}
        </Link>

        <ol className="landing-steps">
          {STEPS.map(([title, body], index) => (
            <li className="landing-step" key={title}>
              <b>
                {index + 1}. {title}
              </b>
              <span>{body}</span>
            </li>
          ))}
        </ol>

        <p className="landing-note">
          Bu sürüm geliştirmenin W0 aşamasıdır: editör arayüzü ve düzenleme tarifi çalışır,
          gerçek video çıktısı (encode) henüz yoktur. Hesap, abonelik, bulut yükleme ve yapay
          zekâ özelliği yok. {t('app.workingName')}
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
