import './Skeleton.css';

export interface SkeletonProps {
  /** CSS width, e.g. "100%" or "12rem". */
  width?: string;
  /** CSS height, e.g. "1rem". */
  height?: string;
  shape?: 'text' | 'rect' | 'circle';
  /** Announced to screen readers once, via a visually-hidden polite live region. */
  loadingLabel: string;
}

/**
 * Purpose: approximates the final layout while data loads (design-system-and-component-catalog.md §5
 *   Skeleton/EmptyState/ErrorState).
 * Props: width, height, shape (text/rect/circle), loadingLabel (required — the only thing a screen reader
 *   hears; the shimmering box itself is aria-hidden).
 * States: static (the shimmer animation respects prefers-reduced-motion).
 * Accessibility: role="status" + visually-hidden loadingLabel gives one polite announcement instead of
 *   screen readers reading out an empty decorative box.
 * RTL: shimmer gradient direction is symmetric, no LTR/RTL divergence.
 */
export function Skeleton({
  width = '100%',
  height = '1rem',
  shape = 'text',
  loadingLabel,
}: SkeletonProps) {
  const radius = shape === 'circle' ? '999px' : shape === 'rect' ? 'var(--radius-card)' : '4px';

  return (
    <span role="status">
      <span
        aria-hidden="true"
        className="cd-skeleton"
        style={{ width, height, borderRadius: radius, display: 'inline-block' }}
      />
      <span className="cd-visually-hidden">{loadingLabel}</span>
    </span>
  );
}
