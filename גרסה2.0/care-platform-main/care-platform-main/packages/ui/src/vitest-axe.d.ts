// vitest-axe@0.1.0 ships type augmentation targeting Vitest 0.x's global
// `Vi` namespace, which Vitest 3 no longer reads — see
// node_modules/vitest-axe/dist/index.d.ts. This is the equivalent
// augmentation written against Vitest 3's documented custom-matcher pattern.
import type { AxeResults } from 'axe-core';

interface AxeMatchers<R = unknown> {
  toHaveNoViolations(): R;
}

declare module 'vitest' {
  interface Assertion<T = AxeResults> extends AxeMatchers<T> {}
  interface AsymmetricMatchersContaining extends AxeMatchers {}
}
