import { forwardRef, type ButtonHTMLAttributes, type MouseEvent } from 'react';
import './Button.css';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /**
   * The action is in flight. The label stays put (so the accessible name never
   * changes mid-submit), a spinner is prepended, aria-busy is announced, and
   * clicks are ignored — without `disabled`, which would drop keyboard focus
   * and silence the screen reader exactly when the user is waiting for news.
   */
  busy?: boolean;
}

/**
 * Purpose: the single primary-action control (design-system-and-component-catalog.md §5 Button).
 * Props: variant (primary/secondary/quiet/danger/link), size (sm/md/lg), busy, plus native button attributes.
 * States: default, hover, focus-visible, busy, disabled — disabled sets aria-disabled and blocks the click
 *   handler; busy keeps the label and focus, shows a spinner, sets aria-busy and ignores onClick.
 * Accessibility: renders a native <button>, so keyboard/Enter/Space activation and focus are free;
 *   every size meets the 44x44px minimum touch target (Constitution §9).
 * RTL: no directional icon or asymmetric padding — safe unchanged in RTL and LTR.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    className,
    disabled,
    busy = false,
    onClick,
    children,
    ...rest
  },
  ref,
) {
  const classes = ['cd-button', `cd-button--${variant}`, `cd-button--${size}`, className]
    .filter(Boolean)
    .join(' ');

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (busy) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };

  return (
    <button
      ref={ref}
      type="button"
      className={classes}
      disabled={disabled}
      aria-disabled={disabled || undefined}
      aria-busy={busy || undefined}
      data-busy={busy || undefined}
      onClick={handleClick}
      {...rest}
    >
      {busy ? <span className="cd-button__spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  );
});
