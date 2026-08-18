import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import * as matchers from 'vitest-axe/matchers';
import { afterEach, expect } from 'vitest';

expect.extend(matchers);

// Auto-cleanup only runs with vitest globals enabled; we keep globals off,
// so unmount explicitly or every render leaks into the next test's DOM.
afterEach(() => {
  cleanup();
});
