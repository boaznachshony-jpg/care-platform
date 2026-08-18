import type { ReactNode } from 'react';
import './StatusBadge.css';

export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export interface StatusBadgeProps {
  tone: StatusTone;
  label: string;
  icon?: ReactNode;
}

/**
 * Purpose: typed semantic status indicator (design-system-and-component-catalog.md §5 StatusBadge).
 * Props: tone (success/warning/danger/info/neutral), label (required text — never color-only), optional icon.
 * States: one per tone; label text always renders, so status reads correctly in an accessibility tree
 *   or a screenshot converted to grayscale.
 * Accessibility: icon (if given) must be decorative — pass an icon component with aria-hidden already set;
 *   the visible label is the accessible name via normal text content.
 * RTL: icon-before-label ordering uses a flex row that already reverses correctly under dir="rtl"
 *   because it relies on logical (not left/right) flex direction.
 *
 * Only use tone/label values that trace back to a canonical status in
 * SYNC_MATRIX.md's "Canonical status enums" table — do not invent new
 * status names at the component call site.
 */
export function StatusBadge({ tone, label, icon }: StatusBadgeProps) {
  return (
    <span className={`cd-status-badge cd-status-badge--${tone}`}>
      {icon}
      {label}
    </span>
  );
}
