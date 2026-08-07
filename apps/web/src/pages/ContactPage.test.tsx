import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { initI18n } from '@caredesk/i18n';
import { SUPPORT_MESSAGE_MAX_LENGTH } from '../contact.js';
import { ContactPage } from './ContactPage.js';

function renderPage() {
  return render(
    <I18nextProvider i18n={initI18n()}>
      <MemoryRouter>
        <ContactPage />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe('ContactPage', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 202 })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens a short in-app request form and keeps the destination email hidden', () => {
    renderPage();

    expect(screen.getByRole('heading', { name: 'יצירת קשר ועזרה' })).toBeInTheDocument();
    expect(screen.getByText('בועז נחשוני')).toBeVisible();
    expect(screen.getByText(/כל הזכויות שמורות/)).toBeVisible();
    expect(screen.queryByText(/boaz\.nachshony@gmail\.com/i)).not.toBeInTheDocument();
    expect(document.querySelector('a[href^="mailto:"]')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'שליחת בקשת עזרה' }));

    expect(screen.getByRole('dialog', { name: 'במה נוכל לעזור?' })).toBeVisible();
    expect(screen.getByLabelText('תוכן הפנייה')).toHaveAttribute(
      'maxlength',
      String(SUPPORT_MESSAGE_MAX_LENGTH),
    );
    expect(screen.getByText(`נותרו ${SUPPORT_MESSAGE_MAX_LENGTH} תווים`)).toBeVisible();
  });

  it('clamps pasted or scripted messages to the public character limit', () => {
    renderPage();

    const launchButton = document.querySelector<HTMLButtonElement>(
      '.contact-option-action-primary',
    );
    expect(launchButton).not.toBeNull();
    fireEvent.click(launchButton!);

    const messageInput = document.querySelector<HTMLTextAreaElement>(
      '.contact-request-form textarea',
    );
    expect(messageInput).not.toBeNull();
    fireEvent.change(messageInput!, {
      target: { value: 'a'.repeat(SUPPORT_MESSAGE_MAX_LENGTH + 100) },
    });

    expect(messageInput).toHaveValue('a'.repeat(SUPPORT_MESSAGE_MAX_LENGTH));
    expect(document.querySelector('.contact-character-count')).toHaveTextContent('0');
  });

  it('submits the request to the API and shows a clear confirmation', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'שליחת הצעה לשיפור' }));
    fireEvent.change(screen.getByLabelText('כתובת דוא״ל לקבלת תשובה'), {
      target: { value: 'customer@example.com' },
    });
    fireEvent.change(screen.getByLabelText('תוכן הפנייה'), {
      target: { value: 'אשמח להוסיף הסבר קצר יותר ליד המשימות.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'שליחת הפנייה' }));

    await waitFor(() => expect(screen.getByText('הפנייה התקבלה בהצלחה')).toBeInTheDocument());
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/support\/requests$/),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('customer@example.com'),
      }),
    );
  });

  it('has no detectable accessibility violations', async () => {
    const { container } = renderPage();
    expect(await axe(container)).toHaveNoViolations();
  });
});
