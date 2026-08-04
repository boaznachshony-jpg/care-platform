import { describe, expect, it } from 'vitest';
import { InMemoryActorResolver } from './in-memory-actor-resolver.js';

describe('InMemoryActorResolver', () => {
  it('resolves only a seeded provider subject', async () => {
    const resolver = new InMemoryActorResolver();
    resolver.seedActor('subject-1', { userId: 'user-1', tenantId: 'tenant-1' });
    const session = {
      userId: 'provider-user-1',
      authSubject: 'subject-1',
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      mfaSatisfied: false,
    };

    await expect(resolver.resolveActor(session)).resolves.toEqual({
      userId: 'user-1',
      tenantId: 'tenant-1',
    });
    await expect(resolver.resolveActor({ ...session, authSubject: 'unknown' })).resolves.toBeNull();
  });
});
