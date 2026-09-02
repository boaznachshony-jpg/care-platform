import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@caredesk/i18n';

/**
 * The reply address is the account's email, and until now it was printed in a
 * wide input at the top of the support dialog. That made every screenshot,
 * screen-share and over-the-shoulder glance of a support request also a
 * disclosure of the address. Reported against production by the account
 * holder.
 *
 * These tests fix the default - hidden - and both escapes from it, so the
 * address cannot drift back onto the screen unnoticed.
 */

const ACCOUNT_EMAIL = 'account-holder@example.com';

vi.mock('../auth/auth-context.js', () => ({
  useAuth: () => ({ user: { email: ACCOUNT_EMAIL } }),
}));

import { ContactOptions } from './ContactOptions.js';

function open() {
  render(
    <I18nextProvider i18n={initI18n()}>
      <ContactOptions />
    </I18nextProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'שליחת בקשת עזרה' }));
}

describe('ContactOptions — reply address', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 202 })),
    );
  });

  it('never prints the account address when the dialog opens', () => {
    open();

    expect(screen.queryByText(ACCOUNT_EMAIL)).not.toBeInTheDocument();
    // Not merely hidden text: there is no field carrying it either, so it
    // cannot surface through an autofill dropdown or a devtools glance.
    expect(screen.queryByLabelText('כתובת דוא״ל לקבלת תשובה')).not.toBeInTheDocument();
    expect(screen.getByText(/התשובה תישלח לכתובת הדוא״ל של החשבון/)).toBeInTheDocument();
  });

  it('shows the address only when explicitly asked, and hides it again', () => {
    open();

    fireEvent.click(screen.getByRole('button', { name: 'הצגת הכתובת' }));
    expect(screen.getByText(ACCOUNT_EMAIL)).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'הסתרת הכתובת' }));
    expect(screen.queryByText(ACCOUNT_EMAIL)).not.toBeInTheDocument();
  });

  it('forgets a reveal when the dialog is closed and reopened', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'הצגת הכתובת' }));
    expect(screen.getByText(ACCOUNT_EMAIL)).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'סגירת חלון הפנייה' }));
    fireEvent.click(screen.getByRole('button', { name: 'שליחת בקשת עזרה' }));

    expect(screen.queryByText(ACCOUNT_EMAIL)).not.toBeInTheDocument();
  });

  it('offers an empty field for a different address, without leaking the account one', () => {
    open();

    fireEvent.click(screen.getByRole('button', { name: 'שליחה לכתובת אחרת' }));

    const field = screen.getByLabelText('כתובת דוא״ל לקבלת תשובה');
    expect(field).toHaveValue('');
    expect(screen.queryByText(ACCOUNT_EMAIL)).not.toBeInTheDocument();
  });

  it('still sends to the account address when it was never shown', async () => {
    open();

    fireEvent.change(screen.getByLabelText('תוכן הפנייה'), {
      target: { value: 'הודעה ארוכה מספיק כדי להישלח.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'שליחת הפנייה' }));

    await screen.findByText('הפנייה התקבלה בהצלחה');
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/support\/requests$/),
      expect.objectContaining({ body: expect.stringContaining(ACCOUNT_EMAIL) }),
    );
  });
});
