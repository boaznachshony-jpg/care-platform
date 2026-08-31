import { describe, expect, it } from 'vitest';
import { InMemoryTermsAcceptanceStore } from './terms-acceptance-store.js';

const TENANT = '00000000-0000-4000-8000-000000000001';
const OTHER_TENANT = '00000000-0000-4000-8000-0000000000ff';
const USER = '00000000-0000-4000-8000-000000000002';
const OTHER_USER = '00000000-0000-4000-8000-0000000000ee';
const base = { context: 'billing', correlationId: 'corr-1' } as const;

/**
 * The in-memory store is what the route tests run against, so its contract has
 * to be the same contract Postgres enforces - otherwise a route can pass its
 * tests and fail in production. These tests pin the two properties that matter:
 * idempotence per (user, document, version), and no way to mutate or remove a
 * row once written.
 */
describe('InMemoryTermsAcceptanceStore', () => {
  it('exposes no way to change or remove an acceptance', () => {
    // `terms_acceptance` is granted `select, insert` and nothing else (0043). A
    // fallback that offered an update would let a route be written that passes
    // here and is refused by the database.
    const store = new InMemoryTermsAcceptanceStore();
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(store)).sort()).toEqual([
      'constructor',
      'list',
      'record',
    ]);
  });

  it('records each document once per version, however many times it is asked', async () => {
    const store = new InMemoryTermsAcceptanceStore();
    const documents = [
      { document: 'terms', version: '2026-08-31' },
      { document: 'privacy', version: '2026-08-31' },
    ] as const;

    await store.record(TENANT, { ...base, userId: USER, documents });
    await store.record(TENANT, { ...base, userId: USER, documents });
    await store.record(TENANT, { ...base, userId: USER, documents });

    expect(await store.list(TENANT, USER)).toHaveLength(2);
  });

  it('returns the first acceptance on a replay, not a fresh timestamp', async () => {
    const store = new InMemoryTermsAcceptanceStore();
    const documents = [{ document: 'terms', version: '2026-08-31' }] as const;

    const [first] = await store.record(TENANT, { ...base, userId: USER, documents });
    const [replayed] = await store.record(TENANT, { ...base, userId: USER, documents });

    // The moment of acceptance is the fact being recorded. A replay that moved
    // it forward would be quietly rewriting evidence.
    expect(replayed?.acceptedAt).toBe(first?.acceptedAt);
  });

  it('keeps a superseded version alongside the new one, newest first', async () => {
    const store = new InMemoryTermsAcceptanceStore();
    await store.record(TENANT, {
      ...base,
      userId: USER,
      documents: [{ document: 'terms', version: '2026-08-31' }],
    });
    await store.record(TENANT, {
      ...base,
      userId: USER,
      documents: [{ document: 'terms', version: '2027-01-15' }],
    });

    const listed = await store.list(TENANT, USER);
    expect(listed.map((entry) => entry.version)).toEqual(['2027-01-15', '2026-08-31']);
  });

  it('never returns another tenant or another user their acceptances', async () => {
    const store = new InMemoryTermsAcceptanceStore();
    const documents = [{ document: 'terms', version: '2026-08-31' }] as const;
    await store.record(TENANT, { ...base, userId: USER, documents });

    expect(await store.list(OTHER_TENANT, USER)).toEqual([]);
    expect(await store.list(TENANT, OTHER_USER)).toEqual([]);
  });

  it('records the same document separately for two users in one tenant', async () => {
    const store = new InMemoryTermsAcceptanceStore();
    const documents = [{ document: 'terms', version: '2026-08-31' }] as const;
    await store.record(TENANT, { ...base, userId: USER, documents });
    await store.record(TENANT, { ...base, userId: OTHER_USER, documents });

    // The acceptance belongs to a person, not to an account.
    expect(await store.list(TENANT, USER)).toHaveLength(1);
    expect(await store.list(TENANT, OTHER_USER)).toHaveLength(1);
  });

  it('keeps the context of the moment the acceptance was collected', async () => {
    const store = new InMemoryTermsAcceptanceStore();
    const [recorded] = await store.record(TENANT, {
      ...base,
      context: 'onboarding',
      userId: USER,
      documents: [{ document: 'privacy', version: '2026-08-31' }],
    });
    expect(recorded).toMatchObject({ document: 'privacy', context: 'onboarding' });
  });
});
