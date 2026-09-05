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

/**
 * Ids for new records (tasks, medications, documents, payroll rows, reminder
 * recipients, local clients). Same secure-context problem as above, but a
 * record id has to look like a UUID everywhere it is later sent — the import
 * endpoints and the storage keys were written against `crypto.randomUUID()`
 * output — so the fallback is a real RFC 4122 version-4 UUID built from
 * `crypto.getRandomValues`, which is available in insecure contexts too.
 *
 * Every raw `crypto.randomUUID()` used for a record id used to throw on the
 * plain-http phone path before any write happened, so "save" silently did
 * nothing (R1-08 fixed the idempotency keys; this closes the same gap for ids).
 */
export function newEntityId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  // Version 4, variant 10xx — the two nibbles a UUID validator checks.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
