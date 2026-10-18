'use client';

import { useState } from 'react';

import { forgetLanguage, rememberedLanguage } from '@/adapters/languageChoice';
import { useBrowserValue } from '@/components/useBrowserValue';
import { useT } from '@/i18n/locale';

/** The language names, each in its own language (as the language button writes them). */
const NAME = { tr: 'Türkçe', en: 'English' } as const;

/**
 * The privacy page's control over the remembered language (ADR-048): whether this browser
 * remembers a choice, and the button that forgets it. Forgotten, the next page follows the
 * browser's own languages again.
 */
export function LanguageChoicePanel({ buttonClassName }: { buttonClassName: string }) {
  const t = useT();
  const [forgotten, setForgotten] = useState(false);
  const stored = useBrowserValue(rememberedLanguage, null);
  const current = forgotten ? null : stored;
  return (
    <div className="help-model" data-testid="language-storage">
      <p className="export-log-note" role="status" data-testid="language-storage-status" data-saved={current !== null}>
        {current !== null
          ? t('privacy.language.present').replace('{name}', NAME[current])
          : forgotten
            ? t('privacy.language.forgotten')
            : t('privacy.language.absent')}
      </p>
      {current !== null ? (
        <button
          type="button"
          className={buttonClassName}
          onClick={() => {
            if (forgetLanguage()) setForgotten(true);
          }}
          data-testid="language-storage-forget"
        >
          {t('privacy.language.forget')}
        </button>
      ) : null}
    </div>
  );
}
