import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { Check, ChevronRight, X } from 'lucide-react';

/**
 * The editor's own field primitives.
 *
 * **Separate from `toolkit.tsx` on purpose.** The toolkit's controls are built
 * for a settings panel in a light surface: a `Dial` is a full-width row with a
 * slider, and an editor needs something closer to a spreadsheet cell — small,
 * dark, tight, and legible at a glance while a drag is happening. Reusing the
 * panel controls here would have meant restyling them for every other tool in the
 * hub, so the canvas has its own and the toolkit is untouched.
 *
 * Every one of them is uncontrolled while it is being typed at and commits on
 * blur or Enter. A number field that re-renders the design on every keystroke
 * makes it impossible to type `1.5` — the field would replace the `1.` with `1`
 * the moment the dot arrived.
 */

/** A titled group of controls, folded or not. */
export function Group({ title, children, tone }: {
  title: string;
  children: ReactNode;
  tone?: 'brand';
}): ReactElement {
  return (
    <section className={`cv-group${tone ? ` cv-group--${tone}` : ''}`}>
      <h4 className="cv-group__title">{title}</h4>
      <div className="cv-group__body">{children}</div>
    </section>
  );
}

/** A row of controls, laid out by a grid rather than by each control's own width. */
export function Row({ children, cols = 2 }: { children: ReactNode; cols?: 1 | 2 | 3 | 4 }): ReactElement {
  return <div className={`cv-row cv-row--${cols}`}>{children}</div>;
}

/** The label every control in a row carries, so a row reads as a table. */
export function Field({ label, children, hint, wide }: {
  label: string;
  children: ReactNode;
  hint?: string;
  wide?: boolean;
}): ReactElement {
  return (
    <label className={`cv-field${wide ? ' cv-field--wide' : ''}`}>
      <span className="cv-field__label">{label}</span>
      {children}
      {hint ? <span className="cv-field__hint">{hint}</span> : null}
    </label>
  );
}

/**
 * A number, typed.
 *
 * **Commits on blur and on Enter, and cancels on Escape.** The value on screen is
 * the value being typed until then, so a half-written number is never pushed into
 * the document — which is also why an invalid entry simply reverts instead of
 * being written as `NaN` and refused by the server.
 */
export function NumberField({ label, value, onChange, step = 1, min, max, unit, disabled, wide }: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
  min?: number;
  max?: number;
  unit?: string;
  disabled?: boolean;
  wide?: boolean;
}): ReactElement {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? format(value);

  const commit = (): void => {
    if (draft === null) return;
    const parsed = Number(draft);
    setDraft(null);
    if (!Number.isFinite(parsed)) return;
    let next = parsed;
    if (min !== undefined) next = Math.max(min, next);
    if (max !== undefined) next = Math.min(max, next);
    if (next !== value) onChange(next);
  };

  return (
    <Field label={label} {...(unit ? { hint: unit } : {})} wide={wide === true}>
      <span className="cv-number">
        <input
          type="text"
          inputMode="decimal"
          className="cv-input cv-input--number mono"
          value={shown}
          disabled={disabled === true}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); (e.target as HTMLInputElement).blur(); }
            if (e.key === 'Escape') { setDraft(null); (e.target as HTMLInputElement).blur(); }
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              const direction = e.key === 'ArrowUp' ? 1 : -1;
              const base = Number(draft ?? value);
              if (Number.isFinite(base)) onChange(base + direction * step * (e.shiftKey ? 10 : 1));
            }
          }}
        />
      </span>
    </Field>
  );
}

/** Two to two decimals, and no trailing `.0` on a whole number. */
function format(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

/** A line of text, committing on blur like the number field. */
export function TextField({ label, value, onChange, placeholder, disabled, wide }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  wide?: boolean;
}): ReactElement {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (): void => {
    if (draft === null) return;
    setDraft(null);
    if (draft !== value) onChange(draft);
  };
  return (
    <Field label={label} wide={wide === true}>
      <input
        type="text"
        className="cv-input"
        value={draft ?? value}
        placeholder={placeholder ?? ''}
        disabled={disabled === true}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); (e.target as HTMLInputElement).blur(); }
          if (e.key === 'Escape') { setDraft(null); (e.target as HTMLInputElement).blur(); }
        }}
      />
    </Field>
  );
}

/** Several lines of a text layer's own copy. */
export function AreaField({ label, value, onChange, rows = 3, disabled }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  disabled?: boolean;
}): ReactElement {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (): void => {
    if (draft === null) return;
    setDraft(null);
    if (draft !== value) onChange(draft);
  };
  return (
    <Field label={label} wide>
      <textarea
        className="cv-input cv-input--area"
        rows={rows}
        value={draft ?? value}
        disabled={disabled === true}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
      />
    </Field>
  );
}

/**
 * A colour, with a swatch and a hex box that only accepts a real one.
 *
 * **The swatch is a native colour input and the hex is a text box**, because a
 * brand palette is used by clicking and a one-off tint is typed — and because a
 * control that only offered a picker would make the brand's own hexes awkward to
 * reach. A hex that is not one is refused on blur and the field snaps back, so a
 * half-typed colour never reaches the document.
 */
const HEX = /^#[0-9a-fA-F]{6}$/;

export function ColorField({ label, value, swatches, onChange, allowCustom, disabled }: {
  label: string;
  value: string;
  swatches: readonly string[];
  /** False when the brand has said no other colour may be reached. */
  allowCustom: boolean;
  onChange: (hex: string) => void;
  disabled?: boolean;
}): ReactElement {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (): void => {
    if (draft === null) return;
    setDraft(null);
    if (HEX.test(draft)) onChange(draft.toUpperCase());
  };
  const known = swatches.map((hex) => hex.toUpperCase()).includes(value.toUpperCase());

  return (
    <Field label={label} wide>
      <div className="cv-colour">
        <input
          type="color"
          className="cv-colour__picker"
          value={HEX.test(value) ? value : '#000000'}
          disabled={disabled === true || !allowCustom}
          aria-label={`${label} colour`}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
        />
        <input
          type="text"
          className={`cv-input cv-input--hex mono${known ? ' is-brand' : ''}`}
          value={draft ?? value}
          disabled={disabled === true || !allowCustom}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); (e.target as HTMLInputElement).blur(); }
            if (e.key === 'Escape') { setDraft(null); (e.target as HTMLInputElement).blur(); }
          }}
        />
        {known ? <span className="cv-colour__tag" title="In the brand palette">brand</span> : null}
      </div>
      {allowCustom ? null : <span className="cv-field__hint">The brand allows its own colours only.</span>}
    </Field>
  );
}

/** A choice among a fixed set, as small buttons rather than a select. */
export function ChoiceField<T extends string>({ label, value, options, onChange, disabled }: {
  label: string;
  value: T;
  options: readonly { id: T; label: string; hint?: string }[];
  onChange: (id: T) => void;
  disabled?: boolean;
}): ReactElement {
  return (
    <Field label={label} wide>
      <div className="cv-choice" role="radiogroup" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={option.id === value}
            className={`cv-choice__item${option.id === value ? ' is-on' : ''}`}
            disabled={disabled === true}
            title={option.hint ?? option.label}
            onClick={() => onChange(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </Field>
  );
}

/** A checkbox, for the properties that are simply on or off. */
export function ToggleField({ label, value, onChange, disabled, hint }: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  hint?: string;
}): ReactElement {
  return (
    <label className={`cv-toggle${disabled === true ? ' is-locked' : ''}`}>
      <input
        type="checkbox"
        checked={value}
        disabled={disabled === true}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="cv-toggle__box" aria-hidden="true">{value ? <Check size={11} strokeWidth={3} /> : null}</span>
      <span className="cv-toggle__label">{label}</span>
      {hint ? <span className="cv-field__hint">{hint}</span> : null}
    </label>
  );
}

/** One slider, for the values a designer wants to feel rather than type. */
export function SliderField({ label, value, min, max, step = 0.01, onChange, disabled, format: show }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  format?: (value: number) => string;
}): ReactElement {
  // The formatted value goes in the hint slot only when there is one, because
  // `exactOptionalPropertyTypes` is on in this repo and a hint that is present
  // and `undefined` is not the same as a hint that is absent.
  return (
    <Field label={label} {...(show ? { hint: show(value) } : {})} wide>
      <input
        type="range"
        className="cv-slider"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled === true}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </Field>
  );
}

/**
 * A dropdown for the things that have names rather than values.
 *
 * A native `<select>` because the brand's own type list is long and a
 * designer should be able to type the first three letters of a typeface.
 */
export function SelectField<T extends string>({ label, value, options, onChange, disabled }: {
  label: string;
  value: T;
  options: readonly { id: T; label: string }[];
  onChange: (id: T) => void;
  disabled?: boolean;
}): ReactElement {
  return (
    <Field label={label} wide>
      <select
        className="cv-select"
        value={value}
        disabled={disabled === true}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
    </Field>
  );
}

/** A read-only fact, for the numbers a designer must see but must not set here. */
export function Readout({ label, value, tone }: {
  label: string;
  value: string;
  tone?: 'bad' | 'good';
}): ReactElement {
  return (
    <div className={`cv-readout${tone ? ` cv-readout--${tone}` : ''}`}>
      <span className="cv-field__label">{label}</span>
      <span className="mono">{value}</span>
    </div>
  );
}

/** A plain action, styled as one line of a panel rather than as a button. */
export function ActionButton({ label, onClick, tone, disabled, icon }: {
  label: string;
  onClick: () => void;
  tone?: 'primary' | 'quiet' | 'bad';
  disabled?: boolean;
  icon?: ReactNode;
}): ReactElement {
  return (
    <button
      type="button"
      className={`cv-action${tone ? ` cv-action--${tone}` : ''}`}
      disabled={disabled === true}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

/** A panel that folds away, so a designer can make room for the artboard. */
export function Disclosure({ title, children, defaultOpen = true, count }: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  count?: number;
}): ReactElement {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`cv-disclosure${open ? ' is-open' : ''}`}>
      <button type="button" className="cv-disclosure__head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <ChevronRight size={12} className={open ? 'cv-disclosure__caret is-open' : 'cv-disclosure__caret'} />
        <span>{title}</span>
        {count === undefined ? null : <span className="cv-disclosure__count mono">{count}</span>}
      </button>
      {open ? <div className="cv-disclosure__body">{children}</div> : null}
    </section>
  );
}

/**
 * A dialog over the editor.
 *
 * **Its own overlay rather than the hub's dialog**, because a canvas is the
 * largest surface in the app and a centred box on top of it has to be able to sit
 * without the design being reachable behind it. `Escape` closes, and a click on
 * the backdrop closes — but a click *inside* does not, which is the mistake that
 * makes a designer lose a form they were halfway through.
 */
export function Sheet({ title, note, children, onClose, wide }: {
  title: string;
  note?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}): ReactElement {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="cv-sheet-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`cv-sheet${wide === true ? ' cv-sheet--wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="cv-sheet__head">
          <h3>{title}</h3>
          {note ? <p className="muted">{note}</p> : null}
          <button type="button" className="cv-icon" onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </header>
        <div className="cv-sheet__body">{children}</div>
      </div>
    </div>
  );
}
