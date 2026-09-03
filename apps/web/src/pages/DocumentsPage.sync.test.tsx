import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@caredesk/i18n';
import { readMvpDocuments, saveMvpDocuments } from '../storage/mvp-storage.js';

/**
 * Sync-specific coverage for DocumentsPage's file-carrying legacy upload,
 * kept separate from DocumentsPage.test.tsx for the same reason as
 * TasksPage.sync.test.tsx — the plain local-storage behaviour tests there
 * must never be affected by mocking `../api/client.js`,
 * `../canonical-case.js` and `../storage/document-file-store.js` here.
 */
const mocks = vi.hoisted(() => ({
  findCanonicalCase: vi.fn(),
  importCaseDocument: vi.fn(),
  listCaseDocuments: vi.fn(),
  readLocalDocumentFileForImport: vi.fn(),
  listEmploymentCases: vi.fn(),
}));

vi.mock('../canonical-case.js', () => ({
  findCanonicalCase: mocks.findCanonicalCase,
  LEGACY_UNSCOPED_CLIENT_ID: 'legacy:unscoped',
}));

vi.mock('../api/client.js', () => ({
  importCaseDocument: mocks.importCaseDocument,
  listCaseDocuments: mocks.listCaseDocuments,
  // Defect 4: see the matching comment in TasksPage.sync.test.tsx.
  listEmploymentCases: mocks.listEmploymentCases,
}));

// This is what actually reads bytes out of IndexedDB / workspace storage —
// mocked here so these tests exercise the wiring (DocumentsPage ->
// resolveDocumentImportFile -> readLocalDocumentFileForImport ->
// importCaseDocument) without needing a real IndexedDB in jsdom.
vi.mock('../storage/document-file-store.js', () => ({
  readLocalDocumentFileForImport: mocks.readLocalDocumentFileForImport,
}));

import { DocumentsPage } from './DocumentsPage.js';

const DEMO_CASE = { id: 'case-demo-001' };

function renderPage() {
  return render(
    <I18nextProvider i18n={initI18n()}>
      <DocumentsPage />
    </I18nextProvider>,
  );
}

function localDocumentFixture() {
  return {
    id: 'local-doc-1',
    name: 'דרכון',
    category: 'דרכון',
    dateLabel: '',
    status: 'valid' as const,
    fileName: 'passport.pdf',
    fileType: 'application/pdf',
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
}

function serverDocumentFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'server-doc-1',
    documentType: 'passport',
    sensitivity: 'identity_sensitive',
    complianceStatus: 'valid',
    expiresAt: null,
    status: 'active',
    currentVersionNumber: 1,
    verificationStatus: 'uploaded',
    mediaType: 'application/pdf',
    sizeBytes: 2048,
    uploadedAt: '2026-08-01T00:00:00.000Z',
    legacyLocalId: 'local-doc-1',
    ...overrides,
  };
}

describe('DocumentsPage file sync', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.findCanonicalCase.mockReset();
    mocks.importCaseDocument.mockReset();
    mocks.listCaseDocuments.mockReset();
    mocks.readLocalDocumentFileForImport.mockReset();
    mocks.listEmploymentCases.mockReset();
    mocks.findCanonicalCase.mockResolvedValue(DEMO_CASE);
    mocks.listCaseDocuments.mockResolvedValue([]);
    mocks.listEmploymentCases.mockResolvedValue([DEMO_CASE]);
  });

  it('sends a device-cached file (IndexedDB/workspace storage) alongside the metadata, exactly once', async () => {
    saveMvpDocuments([localDocumentFixture()]);
    mocks.readLocalDocumentFileForImport.mockResolvedValue({
      mediaType: 'application/pdf',
      content: 'ZmFrZS1wZGYtYnl0ZXM=',
    });
    mocks.importCaseDocument.mockResolvedValue(serverDocumentFixture());

    const { rerender } = renderPage();

    await waitFor(() => expect(mocks.importCaseDocument).toHaveBeenCalledTimes(1));
    expect(mocks.importCaseDocument).toHaveBeenCalledWith(
      'case-demo-001',
      expect.objectContaining({
        legacyLocalId: 'local-doc-1',
        file: { mediaType: 'application/pdf', content: 'ZmFrZS1wZGYtYnl0ZXM=' },
      }),
    );

    rerender(
      <I18nextProvider i18n={initI18n()}>
        <DocumentsPage />
      </I18nextProvider>,
    );
    await waitFor(() => expect(mocks.listCaseDocuments).toHaveBeenCalled());
    // Idempotent client-side tracking (sync/legacy-upload.ts): a second
    // mount/render must not re-send the same document or its file.
    expect(mocks.importCaseDocument).toHaveBeenCalledTimes(1);
  });

  it('a document with no cached file anywhere imports as metadata-only — not treated as a failure', async () => {
    saveMvpDocuments([localDocumentFixture()]);
    mocks.readLocalDocumentFileForImport.mockResolvedValue(null);
    mocks.importCaseDocument.mockResolvedValue(
      serverDocumentFixture({ currentVersionNumber: null, mediaType: null, sizeBytes: null }),
    );

    renderPage();

    await waitFor(() => expect(mocks.importCaseDocument).toHaveBeenCalledTimes(1));
    expect(mocks.importCaseDocument).toHaveBeenCalledWith(
      'case-demo-001',
      expect.objectContaining({ file: undefined }),
    );
    // No failure banner — a missing file is normal, not an error.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('a failed file fetch is visible and retryable, and the local record/file are never touched', async () => {
    saveMvpDocuments([localDocumentFixture()]);
    // Simulates readLocalDocumentFileForImport finding a workspace URL but
    // failing to fetch its bytes — a genuine failure, not "no file" (see
    // document-file-store.ts), so it must fail the whole import visibly.
    mocks.readLocalDocumentFileForImport.mockRejectedValue(new Error('network error'));

    renderPage();

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    // Constitution §13 / the data-safety rule: a failed upload never deletes
    // or hides the user's own local input.
    expect(readMvpDocuments()).toHaveLength(1);
    expect(readMvpDocuments()[0]?.id).toBe('local-doc-1');

    mocks.readLocalDocumentFileForImport.mockResolvedValue(null);
    mocks.importCaseDocument.mockResolvedValue(serverDocumentFixture());
    fireEvent.click(screen.getByRole('button', { name: /נסו שוב|נסה שוב/ }));

    await waitFor(() => expect(mocks.importCaseDocument).toHaveBeenCalledTimes(1));
  });

  // Defect 1 & 2: a category with no canonical twin ("אישור בנק" folds into
  // the server's generic `other` documentType — see CATEGORY_TO_DOCUMENT_TYPE
  // in sync/document-mapping.ts) must keep the customer's own label after a
  // sync round-trip, not come back as the generic "מסמך אחר".
  it("preserves the customer's own category label through a sync round-trip, even when the canonical type is generic 'other'", async () => {
    saveMvpDocuments([{ ...localDocumentFixture(), category: 'אישור בנק', name: 'אישור בנק' }]);
    mocks.readLocalDocumentFileForImport.mockResolvedValue(null);
    mocks.importCaseDocument.mockResolvedValue(
      serverDocumentFixture({ documentType: 'other', currentVersionNumber: null }),
    );
    mocks.listCaseDocuments.mockResolvedValue([
      serverDocumentFixture({ documentType: 'other', currentVersionNumber: null }),
    ]);

    renderPage();

    await waitFor(() => expect(mocks.importCaseDocument).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.listCaseDocuments).toHaveBeenCalled());
    // Never replaced with the server's generic label for `other`.
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'אישור בנק' })).toBeInTheDocument(),
    );
    expect(screen.queryByText('מסמך אחר')).not.toBeInTheDocument();
    expect(readMvpDocuments()[0]?.category).toBe('אישור בנק');
  });

  // Defect 3: a file this browser already knows exists locally, but that is
  // larger than the server accepts, must be reported as a failure — never
  // silently dropped while the metadata "succeeds" and the banner says synced.
  it('reports an oversized locally-cached file as a failure instead of silently dropping it', async () => {
    saveMvpDocuments([localDocumentFixture()]);
    mocks.readLocalDocumentFileForImport.mockRejectedValue(
      new Error('local file is larger than the server accepts'),
    );

    renderPage();

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    // The metadata import must never have been attempted with a dropped
    // file standing in for a real one — resolveDocumentImportFile throws
    // before importCaseDocument is even called.
    expect(mocks.importCaseDocument).not.toHaveBeenCalled();
    // The local record (and its file reference) are untouched.
    expect(readMvpDocuments()).toHaveLength(1);
  });
});
