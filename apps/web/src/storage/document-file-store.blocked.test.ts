import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearLocalDocumentFileCache, DocumentCacheClearError } from './document-file-store.js';

/**
 * WEB-17: `deleteDatabase(...).onblocked` used to `resolve()` — reporting
 * success while the database was still there. When a second tab holds it open
 * (the ordinary case on a phone with the app open twice), the account-switch
 * and sign-out paths therefore left the previous account's passport and ID
 * scans on disk under the NEXT account's session, and nothing anywhere could
 * detect it.
 */
type DeleteRequest = {
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  onblocked: (() => void) | null;
};

function stubIndexedDb(outcome: 'success' | 'error' | 'blocked') {
  const request: DeleteRequest = { onsuccess: null, onerror: null, onblocked: null };
  vi.stubGlobal('indexedDB', {
    deleteDatabase: () => {
      queueMicrotask(() => {
        if (outcome === 'success') request.onsuccess?.();
        if (outcome === 'error') request.onerror?.();
        if (outcome === 'blocked') request.onblocked?.();
      });
      return request;
    },
  });
}

describe('clearLocalDocumentFileCache', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves when the database really was deleted', async () => {
    stubIndexedDb('success');
    await expect(clearLocalDocumentFileCache()).resolves.toBeUndefined();
  });

  it('rejects when another tab blocks the delete, instead of reporting success', async () => {
    stubIndexedDb('blocked');
    await expect(clearLocalDocumentFileCache()).rejects.toBeInstanceOf(DocumentCacheClearError);
  });

  it('rejects on an outright delete failure', async () => {
    stubIndexedDb('error');
    await expect(clearLocalDocumentFileCache()).rejects.toBeInstanceOf(DocumentCacheClearError);
  });
});
