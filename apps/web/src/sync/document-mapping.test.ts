import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readLocalDocumentFileForImport: vi.fn(),
}));

vi.mock('../storage/document-file-store.js', () => ({
  readLocalDocumentFileForImport: mocks.readLocalDocumentFileForImport,
}));

import { resolveDocumentImportFile } from './document-mapping.js';

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

  it('an oversized cached file is dropped — metadata-only, not an error', async () => {
    mocks.readLocalDocumentFileForImport.mockResolvedValue({
      mediaType: 'application/pdf',
      // Longer than MAX_DOCUMENT_BYTES (5 MiB) once accounting for base64 inflation.
      content: 'A'.repeat(8_000_000),
    });

    const result = await resolveDocumentImportFile({ id: 'doc-1' }, 'legacy-client-1');

    expect(result).toBeUndefined();
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
