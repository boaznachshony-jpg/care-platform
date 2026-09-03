import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readLocalDocumentFileForImport: vi.fn(),
}));

// Only `readLocalDocumentFileForImport` needs mocking (its device-cache read
// is what these tests control). `DocumentTooLargeForSyncError` must stay the
// *real* class: document-mapping.ts does `throw new DocumentTooLargeForSyncError(...)`
// and this file constructs it directly (see "Defect 3" tests below) — a mock
// factory that omits it makes the import `undefined`, and `new undefined(...)`
// throws a plain TypeError before any test body runs, taking the whole suite
// down. Spreading the real module keeps the class real while still
// substituting the one function under test.
vi.mock('../storage/document-file-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../storage/document-file-store.js')>();
  return {
    ...actual,
    readLocalDocumentFileForImport: mocks.readLocalDocumentFileForImport,
  };
});

import { DocumentTooLargeForSyncError, resolveDocumentImportFile } from './document-mapping.js';

describe('resolveDocumentImportFile', () => {
  beforeEach(() => {
    mocks.readLocalDocumentFileForImport.mockReset();
  });

  it('a document with no dataUrl and no cached file resolves to undefined — metadata-only import, not a failure', async () => {
    mocks.readLocalDocumentFileForImport.mockResolvedValue(null);

    const result = await resolveDocumentImportFile({ id: 'doc-1' }, null);

    expect(result).toBeUndefined();
  });

  it('prefers the inline dataUrl when the media type is one the canonical schema accepts', async () => {
    const result = await resolveDocumentImportFile(
      { id: 'doc-1', dataUrl: 'data:application/pdf;base64,QUJD' },
      null,
    );

    expect(result).toEqual({ mediaType: 'application/pdf', content: 'QUJD' });
    // A usable inline file is enough — no need to also touch the file cache.
    expect(mocks.readLocalDocumentFileForImport).not.toHaveBeenCalled();
  });

  it('falls back to the local file cache when the dataUrl media type is not allowed', async () => {
    mocks.readLocalDocumentFileForImport.mockResolvedValue({
      mediaType: 'application/pdf',
      content: 'ZmFrZS1ieXRlcw==',
    });

    const result = await resolveDocumentImportFile(
      { id: 'doc-1', dataUrl: 'data:application/zip;base64,UEsDBA==' },
      'legacy-client-1',
    );

    expect(result).toEqual({ mediaType: 'application/pdf', content: 'ZmFrZS1ieXRlcw==' });
  });

  it('a cached file whose media type is not allowed is dropped — metadata-only, not an error', async () => {
    mocks.readLocalDocumentFileForImport.mockResolvedValue({
      mediaType: 'application/zip',
      content: 'somebytes',
    });

    const result = await resolveDocumentImportFile({ id: 'doc-1' }, 'legacy-client-1');

    expect(result).toBeUndefined();
  });

  // Defect 3: an oversized file that genuinely exists must never be treated
  // like "no file" — that was the bug (metadata imports, banner says
  // "synced", the scan itself never leaves the device). The size check
  // itself lives in document-file-store.ts's blobToImportFile (it is the
  // one holding the actual bytes); this test only proves the resulting
  // DocumentTooLargeForSyncError propagates through this function exactly
  // like the "genuine fetch failure" case just below, instead of being
  // swallowed into `undefined`.
  it('an oversized cached file is reported, not dropped — Defect 3', async () => {
    mocks.readLocalDocumentFileForImport.mockRejectedValue(
      new DocumentTooLargeForSyncError(9_000_000),
    );

    await expect(
      resolveDocumentImportFile({ id: 'doc-1' }, 'legacy-client-1'),
    ).rejects.toBeInstanceOf(DocumentTooLargeForSyncError);
  });

  it('an oversized inline dataUrl is reported, not dropped — Defect 3', async () => {
    mocks.readLocalDocumentFileForImport.mockResolvedValue(null);
    const oversizedContent = 'A'.repeat(8_000_000);

    await expect(
      resolveDocumentImportFile(
        { id: 'doc-1', dataUrl: `data:application/pdf;base64,${oversizedContent}` },
        null,
      ),
    ).rejects.toBeInstanceOf(DocumentTooLargeForSyncError);
    // A known-too-large inline file must not silently fall through to the
    // file cache and end up "resolved" some other way that hides the size
    // problem.
    expect(mocks.readLocalDocumentFileForImport).not.toHaveBeenCalled();
  });

  it('passes the legacy client id through to the file cache lookup', async () => {
    mocks.readLocalDocumentFileForImport.mockResolvedValue(null);

    await resolveDocumentImportFile({ id: 'doc-42' }, 'legacy-client-7');

    expect(mocks.readLocalDocumentFileForImport).toHaveBeenCalledWith('doc-42', 'legacy-client-7');
  });

  it('a genuine failure reading the cached file propagates rather than being swallowed as "no file"', async () => {
    mocks.readLocalDocumentFileForImport.mockRejectedValue(new Error('network down'));

    await expect(resolveDocumentImportFile({ id: 'doc-1' }, 'legacy-client-1')).rejects.toThrow(
      'network down',
    );
  });
});
