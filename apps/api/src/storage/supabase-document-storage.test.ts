import { describe, expect, it, vi } from 'vitest';
import { SupabaseDocumentStorage } from './supabase-document-storage.js';

describe('SupabaseDocumentStorage', () => {
  it('uses a tenant-prefixed private key and never returns a public URL', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    const storage = new SupabaseDocumentStorage(
      'https://project.supabase.co',
      'server-only-key',
      'private-documents',
      fetchImpl,
    );
    const result = await storage.putObject({
      tenantId: 'tenant-1',
      key: 'workspaces/client/document/version',
      contentType: 'application/pdf',
      body: new Uint8Array([1, 2, 3]),
    });
    expect(result.storageKey).toBe('tenant-1/workspaces/client/document/version');
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('/storage/v1/object/private-documents/tenant-1/workspaces/'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('creates only a short-lived signed URL for reads', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ signedURL: '/object/sign/private-documents/file?token=x' }), {
          status: 200,
        }),
    );
    const storage = new SupabaseDocumentStorage(
      'https://project.supabase.co',
      'server-only-key',
      'private-documents',
      fetchImpl,
    );
    const url = await storage.getSignedUrl('tenant-1/file', 900);
    expect(url).toContain('token=x');
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('/storage/v1/object/sign/'),
      expect.objectContaining({ body: JSON.stringify({ expiresIn: 900 }) }),
    );
  });

  it('does not duplicate the storage API prefix returned by Supabase', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ signedURL: '/storage/v1/object/sign/private-documents/file?token=x' }),
          { status: 200 },
        ),
    );
    const storage = new SupabaseDocumentStorage(
      'https://project.supabase.co',
      'server-only-key',
      'private-documents',
      fetchImpl,
    );

    await expect(storage.getSignedUrl('tenant-1/file', 900)).resolves.toBe(
      'https://project.supabase.co/storage/v1/object/sign/private-documents/file?token=x',
    );
  });

  it('deletes a private object with server-only credentials', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const storage = new SupabaseDocumentStorage(
      'https://project.supabase.co',
      'server-only-key',
      'private-documents',
      fetchImpl,
    );

    await storage.deleteObject('tenant-1/file');

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://project.supabase.co/storage/v1/object/private-documents/tenant-1/file',
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({ authorization: 'Bearer server-only-key' }),
      }),
    );
  });
});
