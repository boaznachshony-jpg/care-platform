/**
 * Idempotency keys only need to be unique, not secret. `crypto.randomUUID`
 * exists only in secure contexts, and this app is deliberately reachable over
 * plain http on a phone at 192.168.x.x, where a bare `crypto.randomUUID()`
 * throws before any request is sent and the action fails with no error shown
 * (the exact bug `EmergencyBinderPage` hit first). The fallback below keeps
 * every idempotency-bearing action working on exactly the device this
 * mobile-first product most needs testing on.
 *
 * Callers that need retry-safety (the same logical attempt must reuse the same
 * key so a lost response and a second press do not create a duplicate) should
 * generate one key once — e.g. with `useMemo` keyed on the form inputs — and
 * pass it explicitly instead of relying on a default.
 *
 * WHY THIS IS NOT IN `client.ts`
 * -----------------------------
 * Generating a key is not a network call, and twenty-two test files mock
 * `../api/client.js` wholesale. When this lived there, every component that
 * imported it broke in any suite whose mock factory did not happen to list it —
 * a component would fail to render because of an export it uses without ever
 * touching the network. Keeping it in its own module means a test that mocks
 * the API surface still gets the real key generator, which is what it wants.
 */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `idem-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}
