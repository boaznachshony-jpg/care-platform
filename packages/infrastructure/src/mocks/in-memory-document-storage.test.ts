import { describe, expect, it } from 'vitest';
import { InMemoryDocumentStorage } from './in-memory-document-storage.js';

describe('InMemoryDocumentStorage', () => {
  it('never returns a public URL — every link is signed and scoped', async () => {
    const storage = new InMemoryDocumentStorage();
    const { storageKey } = await storage.putObject({
      tenantId: 'tenant-1',
      key: 'passport.pdf',
      contentType: 'application/pdf',
      body: new Uint8Array([1, 2, 3]),
    });

    const url = await storage.getSignedUrl(storageKey, 900);
    expect(url).toMatch(/^mock:\/\/signed\//);
    expect(url).toContain('expires=');
    expect(storageKey).toBe('tenant-1/passport.pdf');
  });

  it('rejects a signed-URL request for an object that was never stored', async () => {
    const storage = new InMemoryDocumentStorage();
    await expect(storage.getSignedUrl('tenant-1/does-not-exist.pdf', 900)).rejects.toThrow();
  });
});
