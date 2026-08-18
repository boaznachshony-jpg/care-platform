import { forwardRef, type ButtonHTMLAttributes } from 'react';
import './Button.css';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/**
 * Purpose: the single primary-action control (design-system-and-component-catalog.md §5 Button).
 * Props: variant (primary/secondary/quiet/danger/link), size (sm/md/lg), plus native button attributes.
 * States: default, hover, focus-visible, disabled — disabled sets aria-disabled and blocks the click handler.
 * Accessibility: renders a native <button>, so keyboard/Enter/Space activation and focus are free;
 *   every size meets the 44x44px minimum touch target (Constitution §9).
 * RTL: no directional icon or asymmetric padding — safe unchanged in RTL and LTR.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', className, disabled, ...rest },
  ref,
) {
  const classes = ['cd-button', `cd-button--${variant}`, `cd-button--${size}`, className]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      ref={ref}
      type="button"
      className={classes}
      disabled={disabled}
      aria-disabled={disabled || undefined}
      {...rest}
    />
  );
});
