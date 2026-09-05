import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../api/client.js';
import { readMvpDocuments, saveMvpDocuments, type MvpDocument } from '../storage/mvp-storage.js';

// The file store is the only I/O this screen awaits directly (IndexedDB or
// the workspace upload). Mocked so the failure paths can be driven without a
// real IndexedDB in jsdom; every default resolves, so the existing tests are
// untouched by it.
const fileStore = vi.hoisted(() => ({
  saveDocumentFile: vi.fn(),
  deleteDocumentFile: vi.fn(),
  readDocumentFile: vi.fn(),
}));

vi.mock('../storage/document-file-store.js', () => ({
  saveDocumentFile: fileStore.saveDocumentFile,
  deleteDocumentFile: fileStore.deleteDocumentFile,
  readDocumentFile: fileStore.readDocumentFile,
}));

import { DocumentsPage } from './DocumentsPage.js';

// Constitution §16: synthetic data only.
function documentFixture(overrides: Partial<MvpDocument>): MvpDocument {
  return {
    id: 'doc-1',
    name: 'דרכון',
    category: 'דרכון',
    dateLabel: '',
    status: 'valid',
    fileName: 'passport.pdf',
    fileType: 'application/pdf',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('DocumentsPage', () => {
  beforeEach(() => {
    localStorage.clear();
    fileStore.saveDocumentFile.mockReset().mockResolvedValue(undefined);
    fileStore.deleteDocumentFile.mockReset().mockResolvedValue(undefined);
    fileStore.readDocumentFile.mockReset().mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Opens the add form and fills every required field with a valid PDF. */
  function fillNewDocumentForm() {
    fireEvent.click(screen.getByRole('button', { name: /הוספת מסמך/ }));
    fireEvent.change(screen.getByLabelText('שם המסמך'), { target: { value: 'דרכון חדש' } });
    fireEvent.change(screen.getByLabelText('תוקף המסמך'), { target: { value: '2027-12-31' } });
    const file = new File(['%PDF-1.4'], 'passport.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText('בחירת קובץ'), { target: { files: [file] } });
    return screen.getByRole('button', { name: 'שמירת המסמך' }).closest('form')!;
  }

  /**
   * UI-WRITE-04. removeDocument used to `await deleteDocumentFile()` with no
   * catch: a failed network DELETE rejected into the void — no message, the
   * row stayed, and the family had no idea anything had been attempted.
   */
  describe('deleting', () => {
    it('reports a failed delete as an alert and keeps the document listed', async () => {
      saveMvpDocuments([documentFixture({ id: 'doc-1', name: 'דרכון' })]);
      fileStore.deleteDocumentFile.mockRejectedValue(new Error('network down'));
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      render(<DocumentsPage />);

      fireEvent.click(screen.getByRole('button', { name: 'מחיקה' }));

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('לא ניתן היה למחוק את המסמך. נסו שוב.');
      // Local state and storage are untouched: the record is still there.
      expect(screen.getByRole('heading', { name: 'דרכון' })).toBeInTheDocument();
      expect(readMvpDocuments()).toHaveLength(1);
      // And the button is live again for a retry.
      expect(screen.getByRole('button', { name: 'מחיקה' })).toBeEnabled();
    });

    it('confirms a successful delete as a polite status, not an alert', async () => {
      saveMvpDocuments([documentFixture({ id: 'doc-1', name: 'דרכון' })]);
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      render(<DocumentsPage />);

      fireEvent.click(screen.getByRole('button', { name: 'מחיקה' }));

      expect(await screen.findByRole('status')).toHaveTextContent('המסמך נמחק.');
      expect(screen.queryByRole('alert')).toBeNull();
      expect(readMvpDocuments()).toHaveLength(0);
    });
  });

  /**
   * UI-WRITE-04 / UI-STATES-06. Every save failure used to be reported as
   * "could not save on this device — leave private browsing", inside a blue
   * info box with role="status" — even when the failure was a 503 from the
   * cloud upload and the device had nothing to do with it.
   */
  describe('save failures', () => {
    it('names the cloud when the upload itself failed, as an alert', async () => {
      fileStore.saveDocumentFile.mockRejectedValue(new ApiRequestError(503, 'REQUEST_ERROR'));
      render(<DocumentsPage />);

      fireEvent.submit(fillNewDocumentForm());

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('לא ניתן היה להעלות את הקובץ לאחסון בענן');
      expect(alert).not.toHaveTextContent('מצב פרטי');
      expect(screen.queryByRole('status')).toBeNull();
      // Nothing was recorded locally for a file that never landed anywhere.
      expect(readMvpDocuments()).toHaveLength(0);
    });

    it('names the device when the local write failed, as an alert and not a status', async () => {
      fileStore.saveDocumentFile.mockRejectedValue(
        new DOMException('quota exceeded', 'QuotaExceededError'),
      );
      render(<DocumentsPage />);

      fireEvent.submit(fillNewDocumentForm());

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('לא ניתן היה לשמור את הקובץ במכשיר');
      expect(screen.queryByRole('status')).toBeNull();
    });

    it('confirms a successful save as a polite status', async () => {
      render(<DocumentsPage />);

      fireEvent.submit(fillNewDocumentForm());

      expect(await screen.findByRole('status')).toHaveTextContent('המסמך נוסף ונשמר.');
      expect(screen.queryByRole('alert')).toBeNull();
      expect(readMvpDocuments()).toHaveLength(1);
    });
  });

  it('offers a native calendar picker for the document expiry date', () => {
    render(<DocumentsPage />);

    fireEvent.click(screen.getByRole('button', { name: /הוספת מסמך/ }));

    const expiryInput = screen.getByLabelText('תוקף המסמך');
    expect(expiryInput).toHaveAttribute('type', 'date');
    expect(expiryInput).toHaveAttribute('aria-describedby', 'document-expiry-help');
    expect(screen.getByText('לחצו על סמל לוח השנה לבחירת תאריך.')).toBeVisible();
  });

  it('loads a previously saved display date into the calendar when editing', () => {
    saveMvpDocuments([
      {
        id: 'passport-1',
        name: 'דרכון',
        category: 'דרכון',
        dateLabel: 'בתוקף עד 31.12.2027',
        status: 'valid',
        fileName: 'passport.pdf',
        fileType: 'application/pdf',
        updatedAt: '2026-07-30T00:00:00.000Z',
      },
    ]);

    render(<DocumentsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'עריכה' }));

    expect(screen.getByLabelText('תוקף המסמך')).toHaveValue('2027-12-31');
  });

  /**
   * The badge is computed from the real calendar date, so these fixtures are
   * built relative to "today" (whenever the suite happens to run) rather
   * than a fixed date — otherwise the test would start failing the day the
   * fixed date fell out of whichever window it was meant to exercise.
   */
  function labelForOffsetDays(offsetDays: number): string {
    const date = new Date();
    date.setDate(date.getDate() + offsetDays);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `בתוקף עד ${day}.${month}.${date.getFullYear()}`;
  }

  describe('the validity badge is derived from the expiry date', () => {
    it('has no expiry date at all: trusts the manually chosen "תקין" status', () => {
      saveMvpDocuments([documentFixture({ dateLabel: '', status: 'valid' })]);
      render(<DocumentsPage />);
      expect(screen.getByText('תקין')).toBeInTheDocument();
    });

    it('has no expiry date at all: trusts the manually chosen "דורש טיפול" status', () => {
      saveMvpDocuments([documentFixture({ dateLabel: '', status: 'attention' })]);
      render(<DocumentsPage />);
      expect(screen.getByText('דורש טיפול')).toBeInTheDocument();
    });

    it('expired in the past: shows "פג תוקף" even though the saved status is "תקין"', () => {
      saveMvpDocuments([documentFixture({ dateLabel: labelForOffsetDays(-30), status: 'valid' })]);
      render(<DocumentsPage />);
      expect(screen.getByText('פג תוקף')).toBeInTheDocument();
      expect(screen.queryByText('תקין')).not.toBeInTheDocument();
    });

    it('expires today: treated as needing attention, not as still valid', () => {
      saveMvpDocuments([documentFixture({ dateLabel: labelForOffsetDays(0), status: 'valid' })]);
      render(<DocumentsPage />);
      expect(screen.getByText('דורש טיפול')).toBeInTheDocument();
    });

    it('expiring soon (inside the shared 14/30-day windows): overrides a "תקין" status', () => {
      saveMvpDocuments([documentFixture({ dateLabel: labelForOffsetDays(20), status: 'valid' })]);
      render(<DocumentsPage />);
      expect(screen.getByText('דורש טיפול')).toBeInTheDocument();
    });

    it('far from expiring and the manual status is "תקין": shows "תקין"', () => {
      saveMvpDocuments([documentFixture({ dateLabel: labelForOffsetDays(120), status: 'valid' })]);
      render(<DocumentsPage />);
      expect(screen.getByText('תקין')).toBeInTheDocument();
    });

    it('far from expiring but a human flagged it manually: the manual flag survives', () => {
      saveMvpDocuments([
        documentFixture({ dateLabel: labelForOffsetDays(120), status: 'attention' }),
      ]);
      render(<DocumentsPage />);
      expect(screen.getByText('דורש טיפול')).toBeInTheDocument();
      expect(screen.queryByText('תקין')).not.toBeInTheDocument();
    });
  });
});
