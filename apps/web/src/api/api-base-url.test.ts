import { describe, expect, it } from 'vitest';
import { apiBaseUrlIsMisconfigured } from './client.js';

/**
 * WEB-20: with `VITE_API_BASE_URL` unset, `resolveApiBaseUrl()` returns
 * `<the page's own host>:4000`. On a phone pointed at a dev machine that is
 * exactly right; on a deployed site it means every authenticated request goes
 * to a port that never answers, and the user saw only a generic "cloud save
 * failed" banner with a retry that could never succeed.
 *
 * The vitest environment has no VITE_API_BASE_URL, which is the misconfigured
 * deployment this predicate has to recognise.
 */
describe('apiBaseUrlIsMisconfigured', () => {
  it('reports a deployed environment with no configured API base URL', () => {
    expect(apiBaseUrlIsMisconfigured('production')).toBe(true);
    expect(apiBaseUrlIsMisconfigured('staging')).toBe(true);
  });

  it('does not fire for local development, where the host-derived fallback is correct', () => {
    expect(apiBaseUrlIsMisconfigured('local')).toBe(false);
  });
});
