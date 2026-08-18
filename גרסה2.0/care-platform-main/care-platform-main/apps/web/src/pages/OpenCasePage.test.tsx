import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import { initI18n } from '@caredesk/i18n';
import { OpenCasePage } from './OpenCasePage.js';

function renderPage() {
  return render(
    <I18nextProvider i18n={initI18n()}>
      <MemoryRouter>
        <OpenCasePage />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe('OpenCasePage', () => {
  it('renders the three party sections with labeled fields (Hebrew, from i18n)', () => {
    renderPage();
    expect(screen.getByText('פרטי המטופל')).toBeInTheDocument();
    expect(screen.getByText('פרטי המעסיק')).toBeInTheDocument();
    expect(screen.getByText('פרטי המטפל')).toBeInTheDocument();
    expect(screen.getByLabelText(/שם המטופל/)).toBeInTheDocument();
    expect(screen.getByLabelText(/תאריך תחילת העסקה/)).toBeInTheDocument();
  });

  it('keeps the caregiver legal-name input LTR inside the RTL layout', () => {
    renderPage();
    expect(screen.getByLabelText(/שם המטפל/)).toHaveAttribute('dir', 'ltr');
  });

  it('has no detectable accessibility violations', async () => {
    const { container } = renderPage();
    expect(await axe(container)).toHaveNoViolations();
  });
});
