import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import { initI18n } from '@caredesk/i18n';
import { emptyMvpProfile, saveMvpProfile } from '../storage/mvp-storage.js';
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
  beforeEach(() => {
    localStorage.clear();
    history.replaceState({}, '', '/cases/new');
  });

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

  it('prefills the party details captured during client setup', () => {
    saveMvpProfile({
      ...emptyMvpProfile,
      recipientName: 'רבקה כהן',
      recipientCareLevel: 'רמה 5',
      recipientCity: 'חיפה',
      employerName: 'דנה כהן',
      employerRelationship: 'בת',
      caregiverName: 'Maria Santos',
      caregiverCountry: 'הפיליפינים',
      caregiverLanguage: 'אנגלית',
      employmentStartDate: '2026-03-01',
      onboardingCompleted: true,
    });

    renderPage();

    expect(screen.getByLabelText(/שם המטופל/)).toHaveValue('רבקה כהן');
    expect(screen.getByLabelText(/שם המעסיק/)).toHaveValue('דנה כהן');
    expect(screen.getByLabelText(/שם המטפל/)).toHaveValue('Maria Santos');
    expect(screen.getByLabelText(/תאריך תחילת העסקה/)).toHaveValue('2026-03-01');
  });

  it('leaves the form empty when there is no setup profile to reuse', () => {
    renderPage();
    expect(screen.getByLabelText(/שם המטופל/)).toHaveValue('');
  });

  it('has no detectable accessibility violations', async () => {
    const { container } = renderPage();
    expect(await axe(container)).toHaveNoViolations();
  });
});
