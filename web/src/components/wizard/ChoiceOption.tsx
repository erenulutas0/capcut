'use client';

/** One of the two big options of a wizard's decision: a real radio button. */
export function ChoiceOption({
  name,
  value,
  checked,
  disabled,
  onSelect,
  label,
  hint,
}: {
  name: string;
  value: string;
  checked: boolean;
  disabled: boolean;
  onSelect: () => void;
  label: string;
  hint: string;
}) {
  return (
    <label className="wizard-option" data-checked={checked}>
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
        data-testid={`option-${value}`}
      />
      <span className="wizard-option-text">
        <span className="wizard-option-label">{label}</span>
        <span className="wizard-option-hint">{hint}</span>
      </span>
    </label>
  );
}
