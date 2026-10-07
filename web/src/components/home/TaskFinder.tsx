'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';

import { Icon } from '@/components/Icon';
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

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}

/**
 * The opening screen's two ways in (ADR-034, designs A + C):
 *
 * - the box: type what you want in your own words; the cards give way to
 *   "Bunu mu demek istedin?" with the tasks that match (`searchTasks`, in the
 *   page, no network). Enter starts the first one; a task that is not built
 *   yet says so and has no button.
 * - the cards: every task that works today, largest target on the screen.
 *
 * The box is a combobox over a listbox (WAI-ARIA 1.2): focus stays in the
 * box, ↑/↓ move the highlighted result (`aria-activedescendant`), Enter
 * starts it, Escape clears; a polite status says how many results there are.
 */
export function TaskFinder() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const gridRef = useRef<HTMLHeadingElement | null>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const result = useMemo(() => searchTasks(query), [query]);
  const matches = result.kind === 'results' ? result.matches : [];
  const activeIndex = Math.min(active, Math.max(0, matches.length - 1));
  const activeMatch = matches[activeIndex];
  const cards = availableTasks();

  const type = (text: string) => {
    setQuery(text);
    setActive(0);
  };

  const start = (task: TaskDefinition) => {
    if (!task.available) return;
    router.push(taskHref(task));
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
      setActive((activeIndex + 1) % matches.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((activeIndex - 1 + matches.length) % matches.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (activeMatch) start(activeMatch.task);
    }
  };

  const first = matches[0];
  const status =
    result.kind === 'none'
      ? t('home.results.statusNone')
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
      <div className="finder-results" hidden={result.kind !== 'results'} data-testid="finder-results">
        <h2 className="home-label" id="finder-results-title">
          {t('home.results.title')}
        </h2>
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
              data-available={task.available}
              data-testid={`result-${task.id}`}
              onClick={() => start(task)}
              onPointerMove={() => {
                if (index !== activeIndex) setActive(index);
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
                  {t('home.results.start')}
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

      {result.kind !== 'empty' ? (
        <button type="button" className="home-quiet-button" onClick={showAll} data-testid="finder-show-all">
          {t('home.results.showAll')}
        </button>
      ) : (
        <>
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

          <section className="task-section" aria-labelledby="task-grid-title">
            <h2 className="home-label" id="task-grid-title" ref={gridRef} tabIndex={-1}>
              {t('home.tasks.title')}
            </h2>
            <ul className="task-grid" data-columns={wideColumns(cards.length)} data-testid="task-grid">
              {cards.map((task, index) => (
                <li key={task.id}>
                  {/* prefetch={false}: see app/page.tsx. */}
                  <Link
                    className={index === 0 ? 'task-card task-card-lead' : 'task-card'}
                    href={taskHref(task)}
                    prefetch={false}
                    data-testid={`task-${task.id}`}
                  >
                    <span className="task-card-icon">
                      <Icon name={task.icon} />
                    </span>
                    <span className="task-card-label">{t(task.labelKey)}</span>
                    <span className="task-card-sub">{t(task.subKey)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
