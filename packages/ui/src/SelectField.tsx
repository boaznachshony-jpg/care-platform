import { forwardRef, useId, type SelectHTMLAttributes } from 'react';
import './SelectField.css';

export interface SelectFieldOption {
  value: string;
  label: string;
}

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  options: readonly SelectFieldOption[];
  error?: string;
  hint?: string;
  /** Shown as the first, unselectable entry when the field has no value yet. */
  placeholder?: string;
}

/**
 * Purpose: single-choice labeled select, the counterpart to TextField for
 *   fields where the product knows the answers.
 *
 * Why it exists: free-text inputs for closed questions ("relationship to the
 *   care recipient") produce one spelling per customer, leave the browser's own
 *   autofill as the only guidance, and give an older reader a blank box where a
 *   short list would do.
 *
 * Props: label (required — the placeholder is never the only label), options,
 *   error, hint, placeholder, plus native select attributes; ref-forwarded so
 *   react-hook-form's register works unchanged.
 * Accessibility: label linked via htmlFor; hint and error linked through
 *   aria-describedby, error additionally role=alert; aria-invalid when in error.
 * RTL: layout follows document direction.
 */
export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  { label, options, error, hint, placeholder, required, id: idProp, className, ...rest },
  ref,
) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');

  return (
    <div className={['cd-select-field', className].filter(Boolean).join(' ')}>
      <label className="cd-select-field__label" htmlFor={id}>
        {label}
        {required ? (
          <span aria-hidden="true" className="cd-select-field__required">
            *
          </span>
        ) : null}
      </label>
      <select
        ref={ref}
        id={id}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className="cd-select-field__input"
        {...rest}
      >
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint ? (
        <p id={hintId} className="cd-select-field__hint">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="cd-select-field__error">
          {error}
        </p>
      ) : null}
    </div>
  );
});
