import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import { initI18n } from '@caredesk/i18n';
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
  it('offers prepared help and feedback email actions', () => {
    renderPage();

    expect(screen.getByRole('heading', { name: 'יצירת קשר ועזרה' })).toBeInTheDocument();
    expect(screen.getByText('boaz.nachshony@gmail.com')).toHaveAttribute(
      'href',
      'mailto:boaz.nachshony@gmail.com',
    );
    expect(screen.getByRole('link', { name: 'שליחת בקשת עזרה' })).toHaveAttribute(
      'href',
      expect.stringMatching(/^mailto:boaz\.nachshony@gmail\.com\?subject=/),
    );
    expect(screen.getByRole('link', { name: 'שליחת הצעה לשיפור' })).toHaveAttribute(
      'href',
      expect.stringMatching(/^mailto:boaz\.nachshony@gmail\.com\?subject=/),
    );
    expect(screen.getByText(/אל תשלחו בדוא״ל סיסמאות/)).toBeVisible();
  });

  it('has no detectable accessibility violations', async () => {
    const { container } = renderPage();
    expect(await axe(container)).toHaveNoViolations();
  });
});
