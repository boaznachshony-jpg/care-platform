import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@caredesk/i18n';
import { readMvpDocuments } from '../storage/mvp-storage.js';

/**
 * R1-07. Saving a document awaits a file write. The submit button used to stay
 * live for the whole of that await, and every press minted its own
 * `crypto.randomUUID()` — so two presses produced two documents with two
 * different ids. That is not a duplicate anything downstream can collapse: it
 * is two separate records of the same passport in one case, and the family
 * cannot tell which of them the scan actually landed on.
 *
 * Kept in its own file, like DocumentsPage.sync.test.tsx, so that mocking
 * `../storage/document-file-store.js` and `../api/client.js` here cannot
 * affect the plain local-storage tests in DocumentsPage.test.tsx.
 */
const mocks = vi.hoisted(() => ({
  saveDocumentFile: vi.fn(),
  findCanonicalCase: vi.fn(),
  listCaseDocuments: vi.fn(),
  listEmploymentCases: vi.fn(),
  importCaseDocument: vi.fn(),
  readLocalDocumentFileForImport: vi.fn(),
}));

vi.mock('../canonical-case.js', () => ({
  findCanonicalCase: mocks.findCanonicalCase,
  LEGACY_UNSCOPED_CLIENT_ID: 'legacy:unscoped',
}));

vi.mock('../api/client.js', () => ({
  importCaseDocument: mocks.importCaseDocument,
  listCaseDocuments: mocks.listCaseDocuments,
  listEmploymentCases: mocks.listEmploymentCases,
}));

vi.mock('../storage/document-file-store.js', () => ({
  saveDocumentFile: mocks.saveDocumentFile,
  readLocalDocumentFileForImport: mocks.readLocalDocumentFileForImport,
}));

import { DocumentsPage } from './DocumentsPage.js';

function renderPage() {
  return render(
    <I18nextProvider i18n={initI18n()}>
      <DocumentsPage />
    </I18nextProvider>,
  );
}

/** A small, synthetic PDF — no real document ever appears in a fixture. */
function syntheticFile() {
  return new File([new Uint8Array([1, 2, 3])], 'passport.pdf', { type: 'application/pdf' });
}

/**
 * Both text fields are `required`, so they are filled here even though this
 * suite is about the button: a form the browser would refuse to submit would
 * make every assertion below pass for the wrong reason.
 */
function openForm() {
  fireEvent.click(screen.getByRole('button', { name: /הוספת מסמך/ }));
  fireEvent.change(screen.getByLabelText('שם המסמך'), { target: { value: 'דרכון' } });
  fireEvent.change(screen.getByLabelText('תוקף המסמך'), { target: { value: '2027-12-31' } });
}

async function openFormAndAttachFile() {
  openForm();
  fireEvent.change(screen.getByLabelText('בחירת קובץ'), {
    target: { files: [syntheticFile()] },
  });
  await waitFor(() => expect(screen.getByRole('button', { name: 'שמירת המסמך' })).toBeEnabled());
}

describe('DocumentsPage — double submit (R1-07)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mocks.findCanonicalCase.mockResolvedValue(null);
    mocks.listEmploymentCases.mockResolvedValue([]);
    mocks.listCaseDocuments.mockResolvedValue([]);
  });

  it('writes one document, not two, when the save button is pressed twice', async () => {
    // A save that does not resolve until we let it: this is the window in
    // which a second press used to get through.
    let releaseSave: () => void = () => undefined;
    mocks.saveDocumentFile.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseSave = resolve;
        }),
    );

    renderPage();
    await openFormAndAttachFile();

    const submit = screen.getByRole('button', { name: 'שמירת המסמך' });
    fireEvent.click(submit);
    // Second press inside the same await. Before the fix this produced a
    // second id and a second record.
    fireEvent.click(submit);

    releaseSave();

    await waitFor(() => expect(readMvpDocuments()).toHaveLength(1));
    expect(mocks.saveDocumentFile).toHaveBeenCalledTimes(1);
  });

  it('disables the button while saving and says so, rather than looking idle', async () => {
    let releaseSave: () => void = () => undefined;
    mocks.saveDocumentFile.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseSave = resolve;
        }),
    );

    renderPage();
    await openFormAndAttachFile();
    fireEvent.click(screen.getByRole('button', { name: 'שמירת המסמך' }));

    const busy = await screen.findByRole('button', { name: 'שומר את המסמך…' });
    expect(busy).toBeDisabled();

    releaseSave();
    await waitFor(() => expect(readMvpDocuments()).toHaveLength(1));
  });

  /**
   * The lock is released on every exit, not only the happy one. A file the
   * form rejects must leave the user able to correct it and try again — an
   * in-flight flag that is only cleared on success would strand them.
   */
  it('releases the lock when the file is rejected, so the form can be corrected', async () => {
    renderPage();
    openForm();

    // No file attached at all — one of the early returns inside the try block.
    fireEvent.click(screen.getByRole('button', { name: 'שמירת המסמך' }));
    expect(await screen.findByText('יש לבחור קובץ לפני השמירה.')).toBeInTheDocument();

    const submit = screen.getByRole('button', { name: 'שמירת המסמך' });
    expect(submit).toBeEnabled();

    mocks.saveDocumentFile.mockResolvedValue(undefined);
    fireEvent.change(screen.getByLabelText('בחירת קובץ'), {
      target: { files: [syntheticFile()] },
    });
    fireEvent.click(submit);

    await waitFor(() => expect(readMvpDocuments()).toHaveLength(1));
  });
});
