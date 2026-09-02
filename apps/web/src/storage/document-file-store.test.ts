import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../api/client.js';

const mocks = vi.hoisted(() => ({
  getBrowserAuthClient: vi.fn(),
  getWorkspaceFileUrl: vi.fn(),
}));

vi.mock('../auth/client.js', () => ({
  getBrowserAuthClient: mocks.getBrowserAuthClient,
}));

vi.mock('../api/client.js', async () => {
  const actual = await vi.importActual<typeof import('../api/client.js')>('../api/client.js');
  return { ...actual, getWorkspaceFileUrl: mocks.getWorkspaceFileUrl };
});

import { readLocalDocumentFileForImport } from './document-file-store.js';

/**
 * Minimal stand-in for the one IndexedDB shape document-file-store.ts uses
 * (open -> transaction -> objectStore -> get), matching the manual-stub style
 * already used in document-file-store.blocked.test.ts — jsdom has no native
 * IndexedDB and this repo does not depend on fake-indexeddb.
 */
function stubIndexedDbGet(blob: Blob | undefined) {
  const dbStub = {
    transaction: () => ({
      objectStore: () => ({
        get: () => {
          const request: {
            result?: Blob;
            onsuccess: (() => void) | null;
            onerror: (() => void) | null;
          } = { result: blob, onsuccess: null, onerror: null };
          queueMicrotask(() => request.onsuccess?.());
          return request;
        },
      }),
    }),
    close: () => {},
  };
  vi.stubGlobal('indexedDB', {
    open: () => {
      const request: {
        result: typeof dbStub;
        onupgradeneeded: (() => void) | null;
        onsuccess: (() => void) | null;
        onerror: (() => void) | null;
      } = { result: dbStub, onupgradeneeded: null, onsuccess: null, onerror: null };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  });
}

describe('readLocalDocumentFileForImport', () => {
  beforeEach(() => {
    mocks.getBrowserAuthClient.mockReset();
    mocks.getWorkspaceFileUrl.mockReset();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('a document with no file anywhere resolves to null — normal, not an error', async () => {
    stubIndexedDbGet(undefined);
    mocks.getBrowserAuthClient.mockReturnValue(null);

    await expect(readLocalDocumentFileForImport('doc-1', null)).resolves.toBeNull();
    expect(mocks.getWorkspaceFileUrl).not.toHaveBeenCalled();
  });

  it('reads a file straight out of IndexedDB, base64-encoded, without ever calling workspace storage', async () => {
    const blob = new Blob(['%PDF-synthetic'], { type: 'application/pdf' });
    stubIndexedDbGet(blob);

    const result = await readLocalDocumentFileForImport('doc-1', 'legacy-client-1');

    expect(result).not.toBeNull();
    expect(result?.mediaType).toBe('application/pdf');
    expect(typeof result?.content).toBe('string');
    expect(result?.content.length).toBeGreaterThan(0);
    expect(mocks.getWorkspaceFileUrl).not.toHaveBeenCalled();
  });

  it('an oversized IndexedDB file degrades to "no file" rather than failing the whole import', async () => {
    // MAX_DOCUMENT_BYTES is 5 MiB; this fake blob reports itself as larger
    // without actually allocating 5 MiB of memory in the test.
    const oversized = new Blob(['x'], { type: 'application/pdf' });
    Object.defineProperty(oversized, 'size', { value: 6 * 1024 * 1024 });
    stubIndexedDbGet(oversized);

    await expect(readLocalDocumentFileForImport('doc-1', null)).resolves.toBeNull();
  });

  it('falls back to null when there is no legacy client id or the browser is signed out', async () => {
    stubIndexedDbGet(undefined);
    mocks.getBrowserAuthClient.mockReturnValue({});

    await expect(readLocalDocumentFileForImport('doc-1', null)).resolves.toBeNull();
    expect(mocks.getWorkspaceFileUrl).not.toHaveBeenCalled();
  });

  it('reads a file from server-side workspace storage when IndexedDB has nothing', async () => {
    stubIndexedDbGet(undefined);
    mocks.getBrowserAuthClient.mockReturnValue({});
    mocks.getWorkspaceFileUrl.mockResolvedValue({ url: 'https://files.example.test/signed' });
    const blob = new Blob(['image-bytes'], { type: 'image/png' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob) }),
    );

    const result = await readLocalDocumentFileForImport('doc-1', 'legacy-client-1');

    expect(result?.mediaType).toBe('image/png');
    expect(mocks.getWorkspaceFileUrl).toHaveBeenCalledWith('legacy-client-1', 'doc-1');
  });

  it('a 404 from workspace storage means "no file", not a failure', async () => {
    stubIndexedDbGet(undefined);
    mocks.getBrowserAuthClient.mockReturnValue({});
    mocks.getWorkspaceFileUrl.mockRejectedValue(new ApiRequestError(404, 'NOT_FOUND'));

    await expect(readLocalDocumentFileForImport('doc-1', 'legacy-client-1')).resolves.toBeNull();
  });

  it('a genuine failure while fetching bytes known to exist is thrown, not swallowed', async () => {
    stubIndexedDbGet(undefined);
    mocks.getBrowserAuthClient.mockReturnValue({});
    mocks.getWorkspaceFileUrl.mockRejectedValue(new ApiRequestError(500, 'INTERNAL_ERROR'));

    await expect(readLocalDocumentFileForImport('doc-1', 'legacy-client-1')).rejects.toBeInstanceOf(
      ApiRequestError,
    );
  });

  it('a network failure fetching the signed URL body is thrown, not swallowed', async () => {
    stubIndexedDbGet(undefined);
    mocks.getBrowserAuthClient.mockReturnValue({});
    mocks.getWorkspaceFileUrl.mockResolvedValue({ url: 'https://files.example.test/signed' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));

    await expect(readLocalDocumentFileForImport('doc-1', 'legacy-client-1')).rejects.toThrow();
  });
});
