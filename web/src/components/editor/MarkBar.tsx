'use client';

import { useState } from 'react';

import { Icon } from '@/components/Icon';
import { formatTimecode, parseTimecode, type Micros } from '@/domain/time';
import type { MessageKey } from '@/i18n/messages';

type T = (key: MessageKey) => string;

/** What the two time fields edit: the range being marked, or the selected kesit. */
export type MarkTarget =
  | { kind: 'pending'; inUs: Micros | null; outUs: Micros | null; durationUs: Micros }
  | { kind: 'kesit'; number: number; inUs: Micros; outUs: Micros };

interface Props {
  t: T;
  disabled: boolean;
  target: MarkTarget;
  /** I / O buttons: mark the edge at the playhead. */
  onMark: (edge: 'in' | 'out') => void;
  /** A typed time, already understood. */
  onType: (edge: 'in' | 'out', us: Micros) => void;
  onAdd: () => void;
  /** "Kesit ekle" with a field that holds no understandable time. */
  onInvalid: () => void;
  /** Leaves the selected kesit, back to marking a new one. */
  onDone: () => void;
}

function TimeField({
  t,
  id,
  edge,
  label,
  markLabel,
  markKey,
  valueUs,
  placeholderUs,
  disabled,
  onMark,
  onType,
  onValidity,
}: {
  t: T;
  id: string;
  edge: 'in' | 'out';
  label: string;
  markLabel: string;
  markKey: string;
  valueUs: Micros | null;
  placeholderUs: Micros;
  disabled: boolean;
  onMark: (edge: 'in' | 'out') => void;
  onType: (edge: 'in' | 'out', us: Micros) => void;
  /** Reports whether the text in the field is a time that can be understood. */
  onValidity: (edge: 'in' | 'out', valid: boolean) => void;
}) {
  // Mounted fresh for each stored value (the caller keys it), so what is
  // typed is local until it is understood and committed.
  const [text, setText] = useState(valueUs === null ? '' : formatTimecode(valueUs));
  const [invalid, setInvalid] = useState(false);

  const commit = () => {
    if (text.trim() === '') {
      setInvalid(false);
      onValidity(edge, true);
      return;
    }
    const us = parseTimecode(text);
    if (us === null) {
      setInvalid(true);
      onValidity(edge, false);
      return;
    }
    setInvalid(false);
    onValidity(edge, true);
    if (us !== valueUs) onType(edge, us);
    else setText(formatTimecode(us));
  };

  return (
    <div className="time-field">
      {/* The button sits beside the label, not inside it: inside, its text
          became part of the field's name ("Başlangıç I ..."). */}
      <div className="time-field-head">
        <label htmlFor={id}>{label}</label>
        <button
          type="button"
          className="mark-btn"
          disabled={disabled}
          onClick={() => onMark(edge)}
          title={markLabel}
          data-testid={edge === 'in' ? 'mark-start' : 'mark-end'}
        >
          {markKey}
          <span className="visually-hidden">{markLabel}</span>
        </button>
      </div>
      <input
        id={id}
        className="time-input"
        value={text}
        placeholder={formatTimecode(placeholderUs)}
        inputMode="decimal"
        aria-invalid={invalid}
        aria-describedby={invalid ? `${id}-invalid` : undefined}
        disabled={disabled}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          }
        }}
        data-testid={edge === 'in' ? 'range-start' : 'range-end'}
      />
      {invalid ? (
        <span id={`${id}-invalid`} className="visually-hidden">
          {t('error.invalid_time')}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Başlangıç (I) and Bitiş (O) on the video's own time, and "Kesit ekle"
 * (ADR-026). With a kesit selected the same two fields fine-tune its edges,
 * and the button leaves it ("Bitti").
 */
export function MarkBar({ t, disabled, target, onMark, onType, onAdd, onInvalid, onDone }: Props) {
  const editing = target.kind === 'kesit';
  // A field holding text that is not a time blocks "Kesit ekle": adding the
  // last understood value instead would add a range the user did not type.
  // Remembered per field instance (its key): a field remounted with a new
  // stored value (I / O, an undo) starts valid again.
  const inKey = `in-${target.kind}-${target.inUs ?? 'none'}`;
  const outKey = `out-${target.kind}-${target.outUs ?? 'none'}`;
  const [invalidKeys, setInvalidKeys] = useState<{ in: string | null; out: string | null }>({ in: null, out: null });
  const onValidity = (edge: 'in' | 'out', valid: boolean) => {
    const key = edge === 'in' ? inKey : outKey;
    setInvalidKeys((current) => ({ ...current, [edge]: valid ? null : key }));
  };
  const add = () => {
    if (invalidKeys.in === inKey || invalidKeys.out === outKey) {
      onInvalid();
      return;
    }
    onAdd();
  };
  const inPlaceholder = 0;
  const outPlaceholder = target.kind === 'pending' ? target.durationUs : target.outUs;
  return (
    <div className="markbar" data-editing={editing} data-testid="mark-bar">
      {editing ? (
        <p className="markbar-editing" data-testid="kesit-editing">
          <span className="markbar-badge">{target.number}</span>
          {t('mark.editing').replace('{n}', String(target.number))}
        </p>
      ) : null}
      <div className="markbar-row">
        <TimeField
          key={inKey}
          t={t}
          id="range-start"
          edge="in"
          label={t('range.start')}
          markLabel={t('range.setStart')}
          markKey="I"
          valueUs={target.inUs}
          placeholderUs={inPlaceholder}
          disabled={disabled}
          onMark={onMark}
          onType={onType}
          onValidity={onValidity}
        />
        <TimeField
          key={outKey}
          t={t}
          id="range-end"
          edge="out"
          label={t('range.end')}
          markLabel={t('range.setEnd')}
          markKey="O"
          valueUs={target.outUs}
          placeholderUs={outPlaceholder}
          disabled={disabled}
          onMark={onMark}
          onType={onType}
          onValidity={onValidity}
        />
        <div className="markbar-action">
          {editing ? (
            <button type="button" className="btn btn-block" onClick={onDone} data-testid="kesit-done">
              <Icon name="check" />
              {t('mark.done')}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-accent btn-block"
              onClick={add}
              disabled={disabled}
              aria-keyshortcuts="Enter"
              data-testid="add-moment"
            >
              <Icon name="plus" />
              {t('mark.add')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
