import type { ReactNode } from 'react';
import './EmptyState.css';

export interface EmptyStateProps {
  title: string;
  body: string;
  action?: ReactNode;
}

/**
 * Purpose: says what is missing and offers exactly one next action (design-system-and-component-catalog.md
 *   §5 Skeleton/EmptyState/ErrorState).
 * Props: title, body (both required — never an empty state with no explanation), action (optional, a single
 *   Button — do not pass more than one competing action).
 * States: static; no loading/error variant of its own.
 * Accessibility: plain semantic text, no ARIA needed; heading level is left to the caller's page structure
 *   (this renders a <p>, not an <h*>, so it composes into any heading hierarchy).
 * RTL: no directional layout.
 */
export function EmptyState({ title, body, action }: EmptyStateProps) {
  return (
    <div className="cd-empty-state">
      <p className="cd-empty-state__title">{title}</p>
      <p className="cd-empty-state__body">{body}</p>
      {action ? <div className="cd-empty-state__action">{action}</div> : null}
    </div>
  );
}
