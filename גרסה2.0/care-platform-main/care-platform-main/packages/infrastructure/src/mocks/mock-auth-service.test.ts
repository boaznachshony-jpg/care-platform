import { describe, expect, it } from 'vitest';
import { MockAuthService } from './mock-auth-service.js';

describe('MockAuthService', () => {
  it('returns null for an unknown token', async () => {
    const service = new MockAuthService();
    expect(await service.verifySession('unknown')).toBeNull();
  });

  it('returns the seeded session for a valid token', async () => {
    const service = new MockAuthService();
    service.seedSession('token-1', {
      userId: 'user-1',
      authSubject: 'auth-subject-1',
      issuedAt: new Date(Date.now() - 1000).toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      mfaSatisfied: true,
    });

    const session = await service.verifySession('token-1');
    expect(session?.userId).toBe('user-1');
  });

  it('returns null once the session has expired', async () => {
    const service = new MockAuthService();
    service.seedSession('token-1', {
      userId: 'user-1',
      authSubject: 'auth-subject-1',
      issuedAt: new Date(Date.now() - 120_000).toISOString(),
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
      mfaSatisfied: true,
    });

    expect(await service.verifySession('token-1')).toBeNull();
  });
});
