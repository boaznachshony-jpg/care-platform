import type { ReactNode } from 'react';
import './ErrorState.css';

export type ErrorStateKind = 'retryable' | 'validation' | 'authorization';

export interface ErrorStateProps {
  kind: ErrorStateKind;
  title: string;
  body: string;
  action?: ReactNode;
}

/**
 * Purpose: distinguishes retryable/validation/authorization failures so the user knows what to do next
 *   (design-system-and-component-catalog.md §5 Skeleton/EmptyState/ErrorState).
 * Props: kind (retryable/validation/authorization), title, body, action (e.g. a Retry button — only for
 *   kind="retryable"; validation/authorization failures should not offer a blind retry).
 * States: one per kind.
 * Accessibility: role="alert" — a failed data fetch should interrupt and be announced immediately.
 * RTL: no directional layout.
 */
export function ErrorState({ kind, title, body, action }: ErrorStateProps) {
  return (
    <div className={`cd-error-state cd-error-state--${kind}`} role="alert">
      <p className="cd-error-state__title">{title}</p>
      <p className="cd-error-state__body">{body}</p>
      {action ? <div className="cd-error-state__action">{action}</div> : null}
    </div>
  );
}
