import type { ReactNode } from 'react';
import './EmptyState.css';

export interface EmptyStateProps {
  title: string;
  /** Optional explanation; when omitted or empty no <p> is rendered. */
  body?: string;
  action?: ReactNode;
}

/**
 * Purpose: says what is missing and offers exactly one next action (design-system-and-component-catalog.md
 *   §5 Skeleton/EmptyState/ErrorState).
 * Props: title (required), body (optional — rendered only when non-empty, so callers never leave a blank
 *   paragraph behind), action (optional, a single Button — do not pass more than one competing action).
 * States: static; no loading/error variant of its own.
 * Accessibility: plain semantic text, no ARIA needed; heading level is left to the caller's page structure
 *   (this renders a <p>, not an <h*>, so it composes into any heading hierarchy).
 * RTL: no directional layout.
 */
export function EmptyState({ title, body, action }: EmptyStateProps) {
  return (
    <div className="cd-empty-state">
      <p className="cd-empty-state__title">{title}</p>
      {body ? <p className="cd-empty-state__body">{body}</p> : null}
      {action ? <div className="cd-empty-state__action">{action}</div> : null}
    </div>
  );
}
