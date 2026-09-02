import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { saveMvpDocuments, type MvpDocument } from '../storage/mvp-storage.js';
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
