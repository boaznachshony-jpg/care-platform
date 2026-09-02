import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@caredesk/i18n';
import { LEGACY_UNSCOPED_CLIENT_ID } from '../../canonical-case.js';
import { readMvpDocuments, saveMvpDocuments } from '../../storage/mvp-storage.js';

/**
 * File-carrying legacy upload coverage for CaseDocumentsSection, kept
 * separate from CaseDocumentsSection.test.tsx (which stubs `fetch` directly)
 * so that display-only suite is unaffected by mocking `../../api/client.js`
 * and `../../storage/document-file-store.js` here — same rationale as
 * TasksPage.sync.test.tsx / DocumentsPage.sync.test.tsx.
 */
const mocks = vi.hoisted(() => ({
  getEmploymentCase: vi.fn(),
  importCaseDocument: vi.fn(),
  listCaseDocuments: vi.fn(),
  getCaseDocumentDownloadUrl: vi.fn(),
  uploadCaseDocument: vi.fn(),
  readLocalDocumentFileForImport: vi.fn(),
}));

vi.mock('../../api/client.js', () => ({
  getEmploymentCase: mocks.getEmploymentCase,
  importCaseDocument: mocks.importCaseDocument,
  listCaseDocuments: mocks.listCaseDocuments,
  getCaseDocumentDownloadUrl: mocks.getCaseDocumentDownloadUrl,
  uploadCaseDocument: mocks.uploadCaseDocument,
}));

vi.mock('../../storage/document-file-store.js', () => ({
  readLocalDocumentFileForImport: mocks.readLocalDocumentFileForImport,
}));

import { CaseDocumentsSection } from './CaseDocumentsSection.js';

const CASE_ID = 'case-1';

function renderSection() {
  return render(
    <I18nextProvider i18n={initI18n()}>
      <CaseDocumentsSection caseId={CASE_ID} />
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

describe('CaseDocumentsSection legacy file upload', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.getEmploymentCase.mockReset();
    mocks.importCaseDocument.mockReset();
    mocks.listCaseDocuments.mockReset();
    mocks.getCaseDocumentDownloadUrl.mockReset();
    mocks.uploadCaseDocument.mockReset();
    mocks.readLocalDocumentFileForImport.mockReset();
    // Unscoped so the local documents seeded via saveMvpDocuments() below —
    // written under the same unscoped key — are the ones the component finds.
    mocks.getEmploymentCase.mockResolvedValue({ legacyClientId: LEGACY_UNSCOPED_CLIENT_ID });
    mocks.listCaseDocuments.mockResolvedValue([]);
  });

  it('attaches a device-cached file to the import call, exactly once', async () => {
    saveMvpDocuments([localDocumentFixture()]);
    mocks.readLocalDocumentFileForImport.mockResolvedValue({
      mediaType: 'application/pdf',
      content: 'ZmFrZS1wZGYtYnl0ZXM=',
    });
    mocks.importCaseDocument.mockResolvedValue({ id: 'server-doc-1' });

    renderSection();

    await waitFor(() => expect(mocks.importCaseDocument).toHaveBeenCalledTimes(1));
    expect(mocks.importCaseDocument).toHaveBeenCalledWith(
      CASE_ID,
      expect.objectContaining({
        legacyLocalId: 'local-doc-1',
        file: { mediaType: 'application/pdf', content: 'ZmFrZS1wZGYtYnl0ZXM=' },
      }),
    );
  });

  it('a document with no cached file imports as metadata-only and is not reported as a failure', async () => {
    saveMvpDocuments([localDocumentFixture()]);
    mocks.readLocalDocumentFileForImport.mockResolvedValue(null);
    mocks.importCaseDocument.mockResolvedValue({ id: 'server-doc-1' });

    renderSection();

    await waitFor(() => expect(mocks.importCaseDocument).toHaveBeenCalledTimes(1));
    expect(mocks.importCaseDocument).toHaveBeenCalledWith(
      CASE_ID,
      expect.objectContaining({ file: undefined }),
    );
    expect(screen.queryByText(/לא הועלו לתיק/)).not.toBeInTheDocument();
  });

  it('a genuine file-fetch failure is shown as a retryable error and never removes the local document', async () => {
    saveMvpDocuments([localDocumentFixture()]);
    mocks.readLocalDocumentFileForImport.mockRejectedValue(new Error('network error'));

    renderSection();

    await waitFor(() =>
      expect(screen.getByText((text) => text.includes('לא הועלו לתיק'))).toBeInTheDocument(),
    );
    // The data-safety rule: a failed upload never touches the local copy.
    expect(readMvpDocuments()).toHaveLength(1);
    expect(mocks.importCaseDocument).not.toHaveBeenCalled();

    mocks.readLocalDocumentFileForImport.mockResolvedValue(null);
    mocks.importCaseDocument.mockResolvedValue({ id: 'server-doc-1' });
    fireEvent.click(screen.getByRole('button', { name: 'נסו שוב' }));

    await waitFor(() => expect(mocks.importCaseDocument).toHaveBeenCalledTimes(1));
  });
});
