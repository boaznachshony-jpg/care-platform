import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { initI18n } from '@caredesk/i18n';
import type { EmploymentCaseResponse } from '@caredesk/schemas';

vi.mock('../api/client.js', () => ({
  listEmploymentCases: vi.fn(),
  openEmploymentCase: vi.fn(),
}));

import { listEmploymentCases, openEmploymentCase } from '../api/client.js';
import { emptyMvpProfile, saveMvpProfile } from '../storage/mvp-storage.js';
import { OpenCasePage } from './OpenCasePage.js';

function caseResponse(overrides: Partial<EmploymentCaseResponse> = {}): EmploymentCaseResponse {
  return {
    id: 'case-1',
    status: 'draft',
    startDate: '2026-03-01',
    endDate: null,
    legacyClientId: null,
    careRecipient: { id: 'r-1', fullName: 'רבקה כהן', careLevel: null, city: null },
    employer: { id: 'e-1', fullName: 'דנה כהן', relationshipToRecipient: 'בת', city: null },
    caregiver: {
      id: 'g-1',
      legalName: 'Maria Santos',
      preferredName: null,
      nationality: 'הפיליפינים',
      primaryLanguage: null,
    },
    ...overrides,
  };
}

function LocationProbe() {
  return <span data-testid="location">{useLocation().pathname}</span>;
}

function renderPage(path = '/cases/new') {
  return render(
    <I18nextProvider i18n={initI18n()}>
      <MemoryRouter initialEntries={[path]}>
        <LocationProbe />
        <Routes>
          <Route path="/cases/new" element={<OpenCasePage />} />
          <Route path="/clients/:clientId/cases/new" element={<OpenCasePage />} />
          <Route path="/cases/:caseId" element={<span>מסך התיק</span>} />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe('OpenCasePage', () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState({}, '', '/cases/new');
    vi.mocked(listEmploymentCases).mockReset();
    vi.mocked(listEmploymentCases).mockResolvedValue([]);
    vi.mocked(openEmploymentCase).mockReset();
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

  // --- WEB-11: the case this page opens belongs to a client -------------

  it('links the case it opens to the client in the path', async () => {
    saveMvpProfile({
      ...emptyMvpProfile,
      recipientName: 'רבקה כהן',
      employerName: 'דנה כהן',
      employerRelationship: 'בת',
      caregiverName: 'Maria Santos',
      caregiverCountry: 'הפיליפינים',
      employmentStartDate: '2026-03-01',
      onboardingCompleted: true,
    });
    vi.mocked(openEmploymentCase).mockResolvedValue(
      caseResponse({ id: 'case-new', legacyClientId: 'client-a' }),
    );

    renderPage('/clients/client-a/cases/new');
    fireEvent.click(screen.getByRole('button', { name: 'פתיחת תיק' }));

    await waitFor(() => expect(openEmploymentCase).toHaveBeenCalledOnce());
    expect(vi.mocked(openEmploymentCase).mock.calls[0]?.[0]).toMatchObject({
      legacyClientId: 'client-a',
    });
    // Landing on the case is what makes the canonical module reachable at all.
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/cases/case-new'),
    );
  });

  it('sends a client that already has a case to that case, not to a second one', async () => {
    vi.mocked(listEmploymentCases).mockResolvedValue([
      caseResponse({ id: 'case-existing', legacyClientId: 'client-a' }),
    ]);

    renderPage('/clients/client-a/cases/new');

    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/cases/case-existing'),
    );
    expect(openEmploymentCase).not.toHaveBeenCalled();
  });

  it('still shows the form when the case lookup fails', async () => {
    // Offline must not block case creation: the server refuses the duplicate
    // anyway (unique index, migration 0042).
    vi.mocked(listEmploymentCases).mockRejectedValue(new Error('offline'));

    renderPage('/clients/client-a/cases/new');

    await waitFor(() => expect(screen.getByLabelText(/שם המטופל/)).toBeInTheDocument());
  });

  it('has no detectable accessibility violations', async () => {
    const { container } = renderPage();
    expect(await axe(container)).toHaveNoViolations();
  });
});
