import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { saveMvpDocuments } from '../storage/mvp-storage.js';
import { DocumentsPage } from './DocumentsPage.js';

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
});
