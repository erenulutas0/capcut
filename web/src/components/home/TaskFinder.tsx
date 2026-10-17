'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Icon } from '@/components/Icon';
import { useNavigationScope } from '@/components/FallbackLink';
import { withHeldVideo } from '@/adapters/pwa/sharedVideo';
import { useHeldVideo } from '@/components/home/HomeIntro';
import { isPlainPress } from '@/components/home/navigationFallback';
import { searchTasks } from '@/domain/taskSearch';
import { TASK_EXAMPLES, availableTasks, type TaskDefinition } from '@/domain/tasks';
import { translator } from '@/i18n/messages';

const t = translator('tr');

const LISTBOX_ID = 'finder-results';

/** Where a task's wizard lives. `next/link` and the router add the base path. */
export function taskHref(task: Pick<TaskDefinition, 'id'>): string {
  return `/yap/${task.id}`;
}

/**
 * Columns of the card grid on a wide screen, chosen so that no card is left
 * alone on the last row when that can be helped: rows that fill first
 * (8 cards → 4 + 4, 9 → 3 + 3 + 3, 6 → 3 + 3), then the fullest last row
 * (7 → 4 + 3, 11 → 4 + 4 + 3, 5 → 3 + 2, 10 → 4 + 4 + 2).
 */
export function wideColumns(count: number): 3 | 4 {
  if (count % 4 === 0) return 4;
  if (count % 3 === 0) return 3;
  if (count % 4 === 3) return 4;
  if (count % 3 === 2) return 3;
  return count % 4 === 2 ? 4 : 3;
}

/**
 * An odd number of cards (eleven since "GIF yap", ADR-046): the lead card takes two places, so the
 * phone's two columns have no card alone on the last row, and the wider grids fill too (12 places:
 * 4 + 4 + 4, or 3 + 3 + 3 + 3).
 */
export function leadWide(count: number): boolean {
  return count % 2 === 1;
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}

/**
 * The opening screen's two ways in (ADR-034, designs A + C):
 *
 * - the box: type what you want in your own words; the cards give way to
 *   "Bunu mu demek istedin?" with the tasks that match (`searchTasks`, in the
 *   page, no network). When the words settle it, the first row is the answer:
 *   it is highlighted and Enter starts it. When they do not (rule 12), the
 *   rows are choices: none is highlighted, a line says so, and Enter starts
 *   nothing until one is picked — it only says "pick one first". A task that
 *   is not built yet says so and has no button.
 * - the cards: every task that works today, largest target on the screen.
 *
 * The box is a combobox over a listbox (WAI-ARIA 1.2): focus stays in the
 * box, ↑/↓ move the highlighted result (`aria-activedescendant`), Enter
 * starts it, Escape clears; a polite status says how many results there are.
 *
 * A press is never silent (ADR-044 addendum, 14 Oct 2026): the pressed card
 * or row says "Açılıyor…" until the task's page is here, and a page whose
 * data never arrives is loaded in full after 10 s (`navigationFallback.ts`).
 * The guard is the screen's (`NavigationFallbackScope` in app/page.tsx),
 * shared with "Kendim düzenleyeceğim" and the privacy link.
 */
export function TaskFinder() {
  const router = useRouter();
  const { pendingPath, begin } = useNavigationScope();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const gridRef = useRef<HTMLHeadingElement | null>(null);
  const [query, setQuery] = useState('');
  // The page is static HTML first: words typed before React owns it stay in the box, but no change event
  // ever told React about them — the box said "kucult" and nothing was found until the next key
  // (13 Oct 2026, seen in WebKit, where the page is usable well before it is hydrated). Read them once.
  useEffect(() => {
    const typed = inputRef.current?.value ?? '';
    if (typed !== '') setQuery(typed);
  }, []);
  /** The highlighted row; null: wherever the answer puts it (the first row when sure, none when asking). */
  const [active, setActive] = useState<number | null>(null);
  /** Enter was pressed on a list of choices before one was picked. */
  const [nudged, setNudged] = useState(false);

  const result = useMemo(() => searchTasks(query), [query]);
  const matches = result.kind === 'results' ? result.matches : [];
  /** The words do not settle it: the rows are choices, none is THE answer (taskSearch.ts, rule 12). */
  const asking = result.kind === 'results' && result.confidence === 'ask';
  const activeIndex = active === null ? (asking ? -1 : 0) : Math.min(active, matches.length - 1);
  const activeMatch = activeIndex >= 0 ? matches[activeIndex] : undefined;
  const cards = availableTasks();
  // With a video in hand (shared to the app, ADR-047), every task opens with it: the address says which.
  const video = useHeldVideo();
  const hrefOf = (task: Pick<TaskDefinition, 'id'>) => withHeldVideo(taskHref(task), video);

  const type = (text: string) => {
    setQuery(text);
    setActive(null);
    setNudged(false);
  };

  const start = (task: TaskDefinition) => {
    if (!task.available) return;
    begin(hrefOf(task));
    router.push(hrefOf(task));
  };

  const showAll = () => {
    type('');
    // The cards are back: continue from their heading.
    window.requestAnimationFrame(() => gridRef.current?.focus());
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      if (query !== '') {
        event.preventDefault();
        type('');
      }
      return;
    }
    if (matches.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive(activeIndex < 0 ? 0 : (activeIndex + 1) % matches.length);
      setNudged(false);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(activeIndex < 0 ? matches.length - 1 : (activeIndex - 1 + matches.length) % matches.length);
      setNudged(false);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      // On a list of choices Enter starts nothing until one is picked: it must not pick for the user.
      if (activeMatch) start(activeMatch.task);
      else setNudged(true);
    }
  };

  const first = matches[0];
  const status = pendingPath
    ? t('home.opening')
    : result.kind === 'none'
      ? t('home.results.statusNone')
      : asking
        ? nudged
          ? t('home.results.statusChoose')
          : fill(t('home.results.statusAsk'), { n: String(matches.length) })
        : first
          ? fill(t(first.task.available ? 'home.results.status' : 'home.results.statusUnavailable'), {
              n: String(matches.length),
              first: t(first.task.labelKey),
            })
          : '';

  return (
    <div className="finder">
      <div className="finder-box">
        <Icon name="search" />
        <label className="visually-hidden" htmlFor="finder-input">
          {t('home.search.label')}
        </label>
        <input
          ref={inputRef}
          id="finder-input"
          className="finder-input"
          type="text"
          role="combobox"
          aria-expanded={matches.length > 0}
          aria-controls={LISTBOX_ID}
          aria-autocomplete="list"
          aria-activedescendant={activeMatch ? `finder-option-${activeMatch.task.id}` : undefined}
          aria-describedby="finder-keys"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          placeholder={t('home.search.placeholder')}
          value={query}
          onChange={(event) => type(event.target.value)}
          onKeyDown={onKeyDown}
          data-testid="finder-input"
        />
        {query !== '' ? (
          <button
            type="button"
            className="finder-clear"
            onClick={() => {
              type('');
              inputRef.current?.focus();
            }}
            aria-label={t('home.search.clear')}
            data-testid="finder-clear"
          >
            <Icon name="close" />
          </button>
        ) : null}
      </div>
      <p className="visually-hidden" id="finder-keys">
        {t('home.search.keys')}
      </p>
      {/* Always in the page, so a screen reader is already listening when results change. */}
      <p className="visually-hidden" role="status" aria-live="polite" data-testid="finder-status">
        {status}
      </p>

      {/* The listbox the box controls: present (empty) while the cards show. */}
      <div
        className="finder-results"
        hidden={result.kind !== 'results'}
        data-confidence={result.kind === 'results' ? result.confidence : undefined}
        data-testid="finder-results"
      >
        <h2 className="home-label" id="finder-results-title">
          {t('home.results.title')}
        </h2>
        {asking ? (
          <p className="finder-ask-hint" data-nudged={nudged ? 'true' : undefined} data-testid="finder-ask-hint">
            {t('home.results.ask.hint')}
          </p>
        ) : null}
        <ul className="result-list" role="listbox" id={LISTBOX_ID} aria-labelledby="finder-results-title">
          {matches.map(({ task }, index) => (
            // Focus stays in the box (aria-activedescendant); the pointer and touch act here.
            <li
              key={task.id}
              id={`finder-option-${task.id}`}
              className="result"
              role="option"
              aria-selected={index === activeIndex}
              aria-disabled={task.available ? undefined : true}
              aria-busy={pendingPath === hrefOf(task) || undefined}
              data-available={task.available}
              data-pending={pendingPath === hrefOf(task) || undefined}
              data-testid={`result-${task.id}`}
              onClick={() => start(task)}
              onPointerMove={() => {
                // Among choices only the arrows pick a row: Enter must never start one because the
                // pointer happened to rest where the list appeared (the row still lights up, in CSS).
                if (!asking && index !== activeIndex) setActive(index);
              }}
            >
              <span className="result-icon">
                <Icon name={task.icon} />
              </span>
              <span className="result-text">
                <span className="result-label">{t(task.labelKey)}</span>
                <span className="result-sub" data-testid={task.available ? undefined : 'result-unavailable'}>
                  {/* A result may say more than its card: what the task does and what it does not (ADR-037). */}
                  {task.available ? t(task.resultKey ?? task.subKey) : t('home.results.unavailable')}
                </span>
              </span>
              {task.available ? (
                <span className="result-start" data-testid="result-start">
                  {pendingPath === hrefOf(task) ? t('home.opening') : t('home.results.start')}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>

      {result.kind === 'none' ? (
        <div className="finder-none" data-testid="finder-none">
          <h2 className="finder-none-title">{t('home.results.none.title')}</h2>
          <p>{t('home.results.none.body')}</p>
        </div>
      ) : null}

      {asking ? (
        <p className="finder-ask-other" data-testid="finder-ask-other">
          {t('home.results.ask.other')}
        </p>
      ) : null}

      {result.kind !== 'empty' ? (
        <button type="button" className="home-quiet-button" onClick={showAll} data-testid="finder-show-all">
          {t('home.results.showAll')}
        </button>
      ) : (
        <>
          {/* With a video already in hand (ADR-047) the cards matter more than examples of what to type. */}
          {video ? null : (
            <div className="finder-examples">
              <h2 className="home-label" id="finder-examples-title">
                {t('home.examples')}
              </h2>
              <ul className="chip-list" aria-labelledby="finder-examples-title">
                {TASK_EXAMPLES.map((example) => (
                  <li key={example}>
                    <button
                      type="button"
                      className="chip"
                      onClick={() => {
                        type(example);
                        inputRef.current?.focus();
                      }}
                      data-testid="finder-example"
                    >
                      {example}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <section className="task-section" aria-labelledby="task-grid-title">
            <h2 className="home-label" id="task-grid-title" ref={gridRef} tabIndex={-1}>
              {t('home.tasks.title')}
            </h2>
            <ul
              className="task-grid"
              data-columns={wideColumns(cards.length + (leadWide(cards.length) ? 1 : 0))}
              data-lead-wide={leadWide(cards.length)}
              data-testid="task-grid"
            >
              {cards.map((task, index) => {
                const href = hrefOf(task);
                const opening = pendingPath === href;
                return (
                  <li key={task.id}>
                    {/* prefetch={false}: see app/page.tsx. */}
                    <Link
                      className={index === 0 ? 'task-card task-card-lead' : 'task-card'}
                      href={href}
                      prefetch={false}
                      onClick={(event) => {
                        // A new tab or window is the browser's own; only a press the router handles is watched.
                        if (isPlainPress(event)) begin(href);
                      }}
                      aria-busy={opening || undefined}
                      data-pending={opening || undefined}
                      data-testid={`task-${task.id}`}
                    >
                      <span className="task-card-icon">
                        <Icon name={task.icon} />
                      </span>
                      <span className="task-card-label">{t(task.labelKey)}</span>
                      <span className="task-card-sub">{opening ? t('home.opening') : t(task.subKey)}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
