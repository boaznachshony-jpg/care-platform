import { forwardRef, useId, type InputHTMLAttributes } from 'react';
import './TextField.css';

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  /**
   * One short line under the field explaining what belongs in it.
   *
   * A label names a field; it does not always explain it. "כינוי" is a correct
   * label and still left the owner asking what it was for. The hint is the
   * place for that answer, so the label can stay short and the explanation does
   * not become placeholder text that vanishes the moment typing starts.
   */
  hint?: string;
  /**
   * Set 'ltr' for values that are inherently left-to-right (passport
   * numbers, email, IBAN) while the label/layout stay RTL (Constitution §8).
   */
  inputDir?: 'rtl' | 'ltr';
}

/**
 * Purpose: single-line labeled input (design-system-and-component-catalog.md §5 TextField).
 * Props: label (required — placeholder is never the only label), error, required, inputDir,
 *   plus native input attributes; works with react-hook-form's register via ref forwarding.
 * States: default, focus, error (border + message), disabled.
 * Accessibility: label linked via htmlFor; error linked via aria-describedby and role=alert so
 *   screen readers hear it when it appears; aria-invalid set when in error (Constitution §9).
 * RTL: layout follows document direction; only the input value direction flips via inputDir.
 */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, error, hint, inputDir, required, id: idProp, className, ...rest },
  ref,
) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');

  return (
    <div className={['cd-text-field', className].filter(Boolean).join(' ')}>
      <label className="cd-text-field__label" htmlFor={id}>
        {label}
        {required ? (
          <span aria-hidden="true" className="cd-text-field__required">
            *
          </span>
        ) : null}
      </label>
      <input
        ref={ref}
        id={id}
        dir={inputDir}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className="cd-text-field__input"
        {...rest}
      />
      {hint ? (
        <p id={hintId} className="cd-text-field__hint">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="cd-text-field__error">
          {error}
        </p>
      ) : null}
    </div>
  );
});
