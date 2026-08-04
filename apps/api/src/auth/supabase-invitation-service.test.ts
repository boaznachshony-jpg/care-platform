import { describe, expect, it, vi } from 'vitest';
import { SupabaseInvitationService } from './supabase-invitation-service.js';

describe('SupabaseInvitationService', () => {
  it('creates a server-side invitation with the configured return URL', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ id: 'provider-user-2' }),
    }));
    const service = new SupabaseInvitationService(
      'https://project.supabase.co',
      'service-role-secret',
      'https://app.example.test/app',
      fetchImpl,
    );

    await expect(service.invite('family@example.test')).resolves.toEqual({
      authSubject: 'provider-user-2',
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://project.supabase.co/auth/v1/invite?redirect_to=https%3A%2F%2Fapp.example.test%2Fapp',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          apikey: 'service-role-secret',
          authorization: 'Bearer service-role-secret',
        }),
        body: JSON.stringify({ email: 'family@example.test' }),
      }),
    );
  });

  it('reports provider failures without exposing the invited email address', async () => {
    const service = new SupabaseInvitationService(
      'https://project.supabase.co',
      'service-role-secret',
      'https://app.example.test/app',
      vi.fn(async () => ({
        ok: false,
        status: 429,
        json: async () => ({ message: 'rate limited' }),
      })),
    );

    let message = '';
    try {
      await service.invite('private-family@example.test');
    } catch (reason) {
      message = reason instanceof Error ? reason.message : String(reason);
    }
    expect(message).toBe('Identity invitation failed with status 429.');
    expect(message).not.toContain('private-family@example.test');
  });
});
