import { describe, expect, it, vi } from 'vitest';
import { SupabaseAuthService } from './supabase-auth-service.js';

function tokenWithClaims(claims: Record<string, unknown>): string {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'none' })}.${part(claims)}.signature`;
}

describe('SupabaseAuthService', () => {
  it('uses the verified Supabase user as the auth subject', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: 'provider-user-1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const service = new SupabaseAuthService(
      'https://project.supabase.co/',
      'publishable-key',
      fetchImpl,
    );

    const session = await service.verifySession(
      tokenWithClaims({ iat: 1_700_000_000, exp: 1_700_003_600, aal: 'aal2' }),
    );

    expect(session).toMatchObject({
      userId: 'provider-user-1',
      authSubject: 'provider-user-1',
      mfaSatisfied: true,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://project.supabase.co/auth/v1/user',
      expect.objectContaining({
        headers: expect.objectContaining({
          apikey: 'publishable-key',
        }),
      }),
    );
  });

  it('fails closed when Supabase rejects the token', async () => {
    const service = new SupabaseAuthService(
      'https://project.supabase.co',
      'publishable-key',
      vi.fn(async () => new Response(null, { status: 401 })),
    );
    expect(await service.verifySession('rejected')).toBeNull();
  });

  it('fails closed when the auth provider cannot be reached', async () => {
    const service = new SupabaseAuthService(
      'https://project.supabase.co',
      'publishable-key',
      vi.fn(async () => {
        throw new Error('network unavailable');
      }),
    );
    expect(await service.verifySession('token')).toBeNull();
  });

  // ── Auth failure edge cases ───────────────────────────────────────────────

  it.each([403, 500, 503])(
    'fails closed on non-401 HTTP error status %i',
    async (status) => {
      const service = new SupabaseAuthService(
        'https://project.supabase.co',
        'publishable-key',
        vi.fn(async () => new Response(null, { status })),
      );
      expect(await service.verifySession('token')).toBeNull();
    },
  );

  it('fails closed when the user id in the response is not a string', async () => {
    const service = new SupabaseAuthService(
      'https://project.supabase.co',
      'publishable-key',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ id: 12345 }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );
    expect(await service.verifySession(tokenWithClaims({ aal: 'aal2' }))).toBeNull();
  });

  it('fails closed when the user id is present but empty', async () => {
    const service = new SupabaseAuthService(
      'https://project.supabase.co',
      'publishable-key',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ id: '' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );
    expect(await service.verifySession(tokenWithClaims({ aal: 'aal2' }))).toBeNull();
  });

  it('reflects aal1 as MFA not satisfied', async () => {
    const service = new SupabaseAuthService(
      'https://project.supabase.co/',
      'publishable-key',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ id: 'user-1' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );
    const session = await service.verifySession(
      tokenWithClaims({ iat: 1_700_000_000, exp: 1_700_003_600, aal: 'aal1' }),
    );
    expect(session?.mfaSatisfied).toBe(false);
  });

  it('treats a missing aal claim as MFA not satisfied', async () => {
    const service = new SupabaseAuthService(
      'https://project.supabase.co/',
      'publishable-key',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ id: 'user-1' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );
    const session = await service.verifySession(
      tokenWithClaims({ iat: 1_700_000_000, exp: 1_700_003_600 }),
    );
    expect(session?.mfaSatisfied).toBe(false);
  });
});
