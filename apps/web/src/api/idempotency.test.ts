import { afterEach, describe, expect, it, vi } from 'vitest';
import { newEntityId, newIdempotencyKey } from './idempotency.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Exactly what a browser exposes on plain http (the 192.168.x.x phone path):
 * `getRandomValues` is there, `randomUUID` is not.
 */
function stubInsecureContextCrypto() {
  const real = globalThis.crypto;
  vi.stubGlobal('crypto', {
    getRandomValues: (array: Uint8Array) => real.getRandomValues(array),
  });
}

describe('newEntityId', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is a version-4 UUID in a secure context', () => {
    expect(newEntityId()).toMatch(UUID_V4);
  });

  it('is still a version-4 UUID when crypto.randomUUID is unavailable', () => {
    stubInsecureContextCrypto();
    expect(typeof crypto.randomUUID).toBe('undefined');
    const first = newEntityId();
    expect(first).toMatch(UUID_V4);
    expect(newEntityId()).not.toBe(first);
  });

  it('does not throw even with no crypto object at all', () => {
    vi.stubGlobal('crypto', undefined);
    expect(newEntityId()).toMatch(UUID_V4);
  });
});

describe('newIdempotencyKey', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('falls back to a non-empty unique key when crypto.randomUUID is unavailable', () => {
    stubInsecureContextCrypto();
    const first = newIdempotencyKey();
    expect(first.length).toBeGreaterThan(8);
    expect(newIdempotencyKey()).not.toBe(first);
  });
});
