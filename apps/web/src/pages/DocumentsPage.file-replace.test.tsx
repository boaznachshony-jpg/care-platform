import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@caredesk/i18n';
import { readMvpDocuments, saveMvpDocuments, type MvpDocument } from '../storage/mvp-storage.js';

/**
 * Silent saves (17.10.2026), place 2: replacing the file of a saved document.
 *
 * The file is stored under the document's id. It used to be written first,
 * and a record write refused after it left the old record — old name, old
 * type — in front of the new file. And every file failure, a refusal by the
 * server included, was reported as "check private browsing" in a status line.
 *
 * Kept in its own file, like DocumentsPage.double-submit.test.tsx, so mocking
 * the file store here cannot affect the plain local-storage tests.
 */
const mocks = vi.hoisted(() => ({
  saveDocumentFile: vi.fn(),
  deleteDocumentFile: vi.fn(),
  readDocumentFile: vi.fn(),
  readLocalDocumentFileForImport: vi.fn(),
}));

vi.mock('../storage/document-file-store.js', () => ({
  saveDocumentFile: mocks.saveDocumentFile,
  deleteDocumentFile: mocks.deleteDocumentFile,
  readDocumentFile: mocks.readDocumentFile,
  readLocalDocumentFileForImport: mocks.readLocalDocumentFileForImport,
}));

import { DocumentsPage } from './DocumentsPage.js';

const passport: MvpDocument = {
  id: 'doc-1',
  name: 'דרכון',
  category: 'דרכון',
  // The expiry field is `required`; with it empty the form would never submit.
  dateLabel: 'בתוקף עד 31.12.2027',
  status: 'valid',
  fileName: 'passport-2025.pdf',
  fileType: 'application/pdf',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const originalSetItem = Storage.prototype.setItem;

function refuseDocumentRecordWrites() {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
    this: Storage,
    key: string,
    value: string,
  ) {
    if (key.startsWith('caredesk.mvp.documents.')) {
      throw new DOMException('refused', 'QuotaExceededError');
    }
    originalSetItem.call(this, key, value);
  });
}

function renderPage() {
  return render(
    <I18nextProvider i18n={initI18n()}>
      <DocumentsPage />
    </I18nextProvider>,
  );
}

function replaceFileAndSave() {
  fireEvent.click(screen.getByRole('button', { name: 'עריכה' }));
  fireEvent.change(screen.getByLabelText('החלפת קובץ (לא חובה)'), {
    target: {
      files: [new File([new Uint8Array([1, 2, 3])], 'passport-2026.jpg', { type: 'image/jpeg' })],
    },
  });
  fireEvent.click(screen.getByRole('button', { name: 'שמירת המסמך' }));
}

beforeEach(() => {
  localStorage.clear();
  mocks.saveDocumentFile.mockReset().mockResolvedValue(undefined);
  saveMvpDocuments([passport]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DocumentsPage — replacing the file of a saved document', () => {
  it('does not touch the file when the record is refused', async () => {
    renderPage();
    refuseDocumentRecordWrites();

    replaceFileAndSave();

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/השמירה נכשלה והשינוי לא נשמר/),
    );
    expect(mocks.saveDocumentFile).not.toHaveBeenCalled();
    expect(readMvpDocuments()).toEqual([passport]);
  });

  it('puts the record back when the server refuses the file, and says why in its words', async () => {
    mocks.saveDocumentFile.mockRejectedValue(
      Object.assign(new Error('Unable to complete the request'), {
        status: 409,
        code: 'VERSION_CONFLICT',
      }),
    );
    renderPage();

    replaceFileAndSave();

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        /הקובץ החדש לא נשמר, והמסמך נשאר כפי שהיה עם הקובץ הקודם\. הנתונים השתנו מאז שהמסך נפתח/,
      ),
    );
    expect(screen.queryByText(/גלישה אינה במצב פרטי/)).not.toBeInTheDocument();
    expect(screen.queryByText('פרטי המסמך עודכנו ונשמרו.')).not.toBeInTheDocument();
    expect(readMvpDocuments()).toEqual([passport]);
  });

  it('saves the record and the file together when both land', async () => {
    renderPage();

    replaceFileAndSave();

    await waitFor(() => expect(screen.getByText('פרטי המסמך עודכנו ונשמרו.')).toBeVisible());
    expect(mocks.saveDocumentFile).toHaveBeenCalledWith('doc-1', expect.any(File));
    expect(readMvpDocuments()).toEqual([
      expect.objectContaining({
        id: 'doc-1',
        fileName: 'passport-2026.jpg',
        fileType: 'image/jpeg',
      }),
    ]);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('DocumentsPage — a new document whose file the server refuses', () => {
  it('shows the network failure as a network failure, not as private browsing', async () => {
    localStorage.clear();
    mocks.saveDocumentFile.mockRejectedValue(new TypeError('Failed to fetch'));
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /הוספת מסמך/ }));
    fireEvent.change(screen.getByLabelText('שם המסמך'), { target: { value: 'ויזה' } });
    fireEvent.change(screen.getByLabelText('תוקף המסמך'), { target: { value: '2027-12-31' } });
    fireEvent.change(screen.getByLabelText('בחירת קובץ'), {
      target: { files: [new File([new Uint8Array([1])], 'visa.pdf', { type: 'application/pdf' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'שמירת המסמך' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/לא הצלחנו להתחבר לשרת/),
    );
    expect(readMvpDocuments()).toEqual([]);
  });
});
