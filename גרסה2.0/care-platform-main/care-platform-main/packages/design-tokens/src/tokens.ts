/**
 * Programmatic mirror of tokens.css, for non-CSS consumers (tests, future
 * email templates). tokens.css is authoritative — see tokens.sync.test.ts,
 * which fails if these two drift apart.
 */
export const colorTokens = {
  'color-bg-canvas': '#f7f8fa',
  'color-bg-surface': '#ffffff',
  'color-text-primary': '#17202a',
  'color-text-secondary': '#52606d',
  'color-border': '#d9e0e7',
  'color-action': '#1e5aa8',
  'color-action-hover': '#174780',
  'color-focus': '#7c3aed',
  'color-success': '#16794b',
  'color-warning': '#9a6700',
  'color-danger': '#b42318',
  'color-info': '#1769aa',
} as const;

export const spacingTokens = {
  'space-1': '4px',
  'space-2': '8px',
  'space-3': '12px',
  'space-4': '16px',
  'space-5': '24px',
  'space-6': '32px',
  'space-7': '48px',
  'space-8': '64px',
} as const;

export const radiusTokens = {
  'radius-input': '8px',
  'radius-card': '12px',
  'radius-dialog': '16px',
  'radius-pill': '999px',
} as const;

export const motionTokens = {
  'motion-duration-default': '160ms',
  'motion-duration-complex': '240ms',
} as const;

export type ColorToken = keyof typeof colorTokens;
