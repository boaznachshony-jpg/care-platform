import { describe, expect, it, vi } from 'vitest';
import type { DocumentStorage, PutObjectInput } from '@caredesk/application';
import { MirroredDocumentStorage } from './mirrored-document-storage.js';

function storage(overrides: Partial<DocumentStorage> = {}): DocumentStorage {
  return {
    putObject: vi.fn(async (_input: PutObjectInput) => ({ storageKey: 'tenant/file' })),
    getSignedUrl: vi.fn(async () => 'https://signed.example/file'),
    deleteObject: vi.fn(async () => undefined),
    ...overrides,
  };
}

const input: PutObjectInput = {
  tenantId: 'tenant',
  key: 'file',
  contentType: 'application/pdf',
  body: new Uint8Array([1, 2, 3]),
};

describe('MirroredDocumentStorage', () => {
  it('reports success only after both destinations persist the object', async () => {
    const primary = storage();
    const backup = storage();
    const mirrored = new MirroredDocumentStorage(primary, backup);

    await expect(mirrored.putObject(input)).resolves.toEqual({ storageKey: 'tenant/file' });
    expect(primary.putObject).toHaveBeenCalledWith(input);
    expect(backup.putObject).toHaveBeenCalledWith(input);
  });

  it('removes an incomplete primary write when the backup fails', async () => {
    const primary = storage();
    const backup = storage({ putObject: vi.fn(async () => Promise.reject(new Error('offline'))) });
    const mirrored = new MirroredDocumentStorage(primary, backup);

    await expect(mirrored.putObject(input)).rejects.toThrow('offline');
    expect(primary.deleteObject).toHaveBeenCalledWith('tenant/file');
  });

  it('keeps the immutable backup copy when a user deletes the primary object', async () => {
    const primary = storage();
    const backup = storage();
    const mirrored = new MirroredDocumentStorage(primary, backup);

    await mirrored.deleteObject('tenant/file');
    expect(primary.deleteObject).toHaveBeenCalledWith('tenant/file');
    expect(backup.deleteObject).not.toHaveBeenCalled();
  });
});
