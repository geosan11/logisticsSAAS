import { useId } from 'react';
import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, ReactNode } from 'react';

// Labelled form controls. ~223 raw <input> / 101 raw <select> / 12 raw
// <textarea> hand-roll label + control + error, with 73 ad-hoc
// bg-[rgba(239,68,68,alpha)] error blocks (alpha in {.05,.08,.1,.15,.2}) and
// no red-border-on-error convention. This standardises all three, wraps the
// .ehi-input recipe, and uses the Phase 0 --color-error-bg/-border/-fg tokens.

type FieldSize = 'sm' | 'md' | 'lg';

const CONTROL_SIZE: Record<FieldSize, string> = {
  sm: 'h-[var(--control-height-sm,32px)] px-3 text-[12px]',
  md: 'h-[var(--control-height-md,40px)] px-3.5 text-[13px]',
  lg: 'h-[var(--control-height-lg,48px)] px-3.5 text-[16px]',
};

const baseControl =
  'w-full bg-[var(--color-input-bg)] text-[var(--color-input-text)] border rounded-[var(--radius-input)] font-sans outline-none ' +
  'transition-[border-color,box-shadow] focus:border-[var(--color-border-focus)] focus:shadow-[0_0_0_3px_var(--glow-focus)] ' +
  'disabled:opacity-60 disabled:cursor-not-allowed';

interface Shared {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  fieldSize?: FieldSize;
  containerClassName?: string;
}

function Shell({
  id,
  label,
  hint,
  error,
  required,
  containerClassName = '',
  children,
}: {
  id: string;
  children: ReactNode;
} & Omit<Shared, 'fieldSize'>) {
  return (
    <div className={`flex flex-col ${containerClassName}`}>
      {label && (
        <label htmlFor={id} className="ehi-label">
          {label}
          {required && <span className="text-[var(--color-error-fg)]"> *</span>}
        </label>
      )}
      {children}
      {error ? (
        <p
          id={`${id}-error`}
          className="mt-1 text-[11px] font-mono rounded px-2 py-1 border"
          style={{
            color: 'var(--color-error-fg)',
            background: 'var(--color-error-bg)',
            borderColor: 'var(--color-error-border)',
          }}
        >
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="mt-1 text-[10px] font-mono text-[var(--color-muted)]">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

const borderClass = (error?: string) =>
  error ? 'border-[var(--color-error)]' : 'border-[var(--color-border)]';
const describedBy = (id: string, error?: string, hint?: string) =>
  error ? `${id}-error` : hint ? `${id}-hint` : undefined;

export interface TextFieldProps
  extends Shared,
    Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {}

export const TextField = ({
  label, hint, error, required, fieldSize = 'md', containerClassName,
  id, className = '', ...rest
}: TextFieldProps) => {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <Shell id={fid} label={label} hint={hint} error={error} required={required} containerClassName={containerClassName}>
      <input
        id={fid}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(fid, error, hint)}
        className={`${baseControl} ${CONTROL_SIZE[fieldSize]} ${borderClass(error)} ${className}`}
        {...rest}
      />
    </Shell>
  );
};

export interface SelectFieldProps
  extends Shared,
    Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {}

export const Select = ({
  label, hint, error, required, fieldSize = 'md', containerClassName,
  id, className = '', children, ...rest
}: SelectFieldProps) => {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <Shell id={fid} label={label} hint={hint} error={error} required={required} containerClassName={containerClassName}>
      <select
        id={fid}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(fid, error, hint)}
        className={`${baseControl} ${CONTROL_SIZE[fieldSize]} ${borderClass(error)} ${className}`}
        {...rest}
      >
        {children}
      </select>
    </Shell>
  );
};

export interface TextareaFieldProps extends Shared, TextareaHTMLAttributes<HTMLTextAreaElement> {}

export const Textarea = ({
  // fieldSize is part of Shared but a textarea has no height variants
  // (it's resize-y) -- pull it out so it doesn't spread onto the DOM node.
  label, hint, error, required, containerClassName, fieldSize: _fieldSize,
  id, className = '', rows = 3, ...rest
}: TextareaFieldProps) => {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <Shell id={fid} label={label} hint={hint} error={error} required={required} containerClassName={containerClassName}>
      <textarea
        id={fid}
        rows={rows}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(fid, error, hint)}
        className={`${baseControl} py-2.5 text-[13px] leading-relaxed resize-y ${borderClass(error)} ${className}`}
        {...rest}
      />
    </Shell>
  );
};
