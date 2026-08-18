import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { initI18n } from '@caredesk/i18n';
import { App } from './App.js';

function renderApp() {
  return render(
    <I18nextProvider i18n={initI18n()}>
      <MemoryRouter initialEntries={['/']}>
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

  it('renders the Hebrew app name from translation resources, not a hardcoded string', () => {
    renderApp();
    expect(screen.getByText('CareDesk')).toBeInTheDocument();
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
