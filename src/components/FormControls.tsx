import { useId, type ReactNode } from 'react';
import { AlertCircleIcon, CheckIcon, ChevronDownIcon } from './Icons';

interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T | '';
  onChange: (value: T) => void;
  ariaLabel: string;
  size?: 'md' | 'lg';
  invalid?: boolean;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  size = 'md',
  invalid,
}: SegmentedControlProps<T>) {
  const index = options.findIndex((o) => o.value === value);
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      aria-invalid={invalid || undefined}
      className={`segmented segmented--${size}${invalid ? ' is-invalid' : ''}`}
      style={{ ['--count' as string]: options.length, ['--index' as string]: Math.max(index, 0) }}
    >
      {index >= 0 && <span className="segmented__thumb" aria-hidden="true" />}
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={`segmented__option${o.value === value ? ' is-active' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

interface ToggleSwitchProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** [off, on] text shown beside the switch */
  stateLabels?: [string, string];
}

export function ToggleSwitch({ label, description, checked, onChange, stateLabels = ['ไม่ใช่', 'ใช่'] }: ToggleSwitchProps) {
  const id = useId();
  return (
    <label className={`toggle${checked ? ' is-on' : ''}`} htmlFor={id}>
      <span className="toggle__text">
        <span className="toggle__label">{label}</span>
        {description && <span className="toggle__desc">{description}</span>}
      </span>
      <span className="toggle__state">{stateLabels[checked ? 1 : 0]}</span>
      <input id={id} type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle__track" aria-hidden="true">
        <span className="toggle__knob" />
      </span>
    </label>
  );
}

interface NumberFieldProps {
  label: string;
  unit: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  hint?: string;
  error?: string;
  min?: number;
  max?: number;
  step?: number;
  optional?: boolean;
}

export function NumberField({ label, unit, value, onChange, onBlur, placeholder, hint, error, min, max, step = 1, optional }: NumberFieldProps) {
  const id = useId();
  const msgId = `${id}-msg`;
  return (
    <div className={`field field--enter${error ? ' is-invalid' : ''}`}>
      <label className="field__label" htmlFor={id}>
        {label}
        {optional && <span className="field__optional">ไม่บังคับ</span>}
      </label>
      <div className="field__control">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          value={value}
          placeholder={placeholder}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          onWheel={(e) => e.currentTarget.blur()}
          aria-invalid={!!error}
          aria-describedby={hint || error ? msgId : undefined}
        />
        <span className="field__unit">{unit}</span>
      </div>
      {error ? (
        <p id={msgId} className="field__error" role="alert">
          <AlertCircleIcon size={14} /> {error}
        </p>
      ) : (
        hint && (
          <p id={msgId} className="field__hint">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

interface SelectFieldProps<T extends string | number> {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  hint?: string;
}

export function SelectField<T extends string | number>({ label, value, options, onChange, hint }: SelectFieldProps<T>) {
  const id = useId();
  return (
    <div className="field field--enter">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <div className="field__control field__control--select">
        <select
          id={id}
          value={String(value)}
          onChange={(e) => {
            const picked = options.find((o) => String(o.value) === e.target.value);
            if (picked) onChange(picked.value);
          }}
        >
          {options.map((o) => (
            <option key={String(o.value)} value={String(o.value)}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDownIcon size={18} className="field__chevron" />
      </div>
      {hint && <p className="field__hint">{hint}</p>}
    </div>
  );
}

interface CheckChipProps {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** e.g. a "เงื่อนไข" button shown after the hint (it must not toggle the box — see ChipInfoButton) */
  hintAction?: ReactNode;
}

/** Small button inside a CheckChip's hint; clicking it does not toggle the checkbox. */
export function ChipInfoButton({ onClick, title, children }: { onClick: () => void; title: string; children: ReactNode }) {
  return (
    <button
      type="button"
      className="chip__info"
      title={title}
      onClick={(e) => {
        e.preventDefault(); // inside the <label>: keep the checkbox as it is
        e.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}

export function CheckChip({ label, hint, checked, onChange, hintAction }: CheckChipProps) {
  return (
    <label className={`chip${checked ? ' is-on' : ''}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="chip__box" aria-hidden="true">
        <CheckIcon size={14} />
      </span>
      <span className="chip__text">
        <span>{label}</span>
        {hint && (
          <small>
            {hint}
            {hintAction}
          </small>
        )}
      </span>
    </label>
  );
}

export type PanelTone = 'primary' | 'blue' | 'amber' | 'teal' | 'slate' | 'indigo';

interface PanelProps {
  icon: ReactNode;
  title: string;
  en: string;
  tone: PanelTone;
  actions?: ReactNode;
  children: ReactNode;
}

/** Titled form section in the style of the HOSxP screening screen. */
export function Panel({ icon, title, en, tone, actions, children }: PanelProps) {
  return (
    <section className={`panel panel--${tone}`}>
      <header className="panel__head">
        <span className="panel__icon">{icon}</span>
        <h2 className="panel__title">
          {title} <span>({en})</span>
        </h2>
        {actions && <div className="panel__actions">{actions}</div>}
      </header>
      <div className="panel__body">{children}</div>
    </section>
  );
}

/** Animated show/hide for a block of content; hidden content is made inert so it can't be focused. */
export function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div className={`collapse${open ? ' is-open' : ''}`} inert={!open} aria-hidden={!open}>
      <div className="collapse__inner">{children}</div>
    </div>
  );
}
