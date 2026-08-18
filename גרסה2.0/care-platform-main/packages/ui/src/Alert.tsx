import type { ReactNode } from 'react';
import './Alert.css';

export type AlertVariant = 'info' | 'success' | 'warning' | 'error';

export interface AlertProps {
  variant: AlertVariant;
  title: string;
  children?: ReactNode;
}

const URGENT_VARIANTS: ReadonlySet<AlertVariant> = new Set(['warning', 'error']);

/**
 * Purpose: inline status/feedback message (design-system-and-component-catalog.md §5 Alert/InlineMessage).
 * Props: variant (info/success/warning/error), title (required), children (optional supporting text/action).
 * States: one per variant; no dismiss/loading state in Milestone 0.
 * Accessibility: warning/error use role="alert" (assertive live region — interrupts); info/success use
 *   role="status" (polite — announced without interrupting). Never rely on color alone: an icon slot is
 *   available via children, and the variant name itself is not the only signal (title text carries meaning).
 * RTL: no directional icon baked in; text-align follows the inherited document direction.
 */
export function Alert({ variant, title, children }: AlertProps) {
  const role = URGENT_VARIANTS.has(variant) ? 'alert' : 'status';
  const ariaLive = URGENT_VARIANTS.has(variant) ? 'assertive' : 'polite';

  return (
    <div className={`cd-alert cd-alert--${variant}`} role={role} aria-live={ariaLive}>
      <p className="cd-alert__title">{title}</p>
      {children ? <div className="cd-alert__body">{children}</div> : null}
    </div>
  );
}
