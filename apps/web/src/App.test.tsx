import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { initI18n } from '@caredesk/i18n';
import { App } from './App.js';

function renderApp(path = '/') {
  return render(
    <I18nextProvider i18n={initI18n()}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe('App', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true } as Response));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the public Hebrew landing page before the private workspace', () => {
    renderApp();
    expect(
      screen.getByRole('heading', { name: 'העסקה ישירה של מטפל סיעודי, בראש שקט' }),
    ).toBeInTheDocument();
    expect(screen.getByText('רישום נתוני שכר, מעקב תשלומים ותזכורות')).toBeInTheDocument();
    expect(screen.queryByText('חישובי שכר, סיכומים ותזכורות')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'כניסה לחשבון' })).toHaveAttribute('href', '/app');
    expect(screen.getByRole('heading', { name: 'יצירת קשר ועזרה' })).toBeInTheDocument();
    expect(screen.queryByText('boaz.nachshony@gmail.com')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'שליחת בקשת עזרה' })).toBeVisible();
    for (const link of screen.getAllByRole('link', { name: 'יצירת קשר' })) {
      expect(link).toHaveAttribute('href', '/contact-us');
    }
  });

  it('renders a public contact page with initiative and copyright details', () => {
    renderApp('/contact-us');
    expect(screen.getByRole('heading', { name: 'יצירת קשר ועזרה' })).toBeVisible();
    expect(screen.getByText('בועז נחשוני')).toBeVisible();
    expect(screen.getByText(/כל הזכויות שמורות/)).toBeVisible();
    expect(screen.queryByText('boaz.nachshony@gmail.com')).not.toBeInTheDocument();
  });

  it('renders exactly one main landmark', () => {
    renderApp();
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });

  it('has no detectable accessibility violations', async () => {
    const { container } = renderApp();
    expect(await axe(container)).toHaveNoViolations();
  });
});
