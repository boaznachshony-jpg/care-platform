import { render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@caredesk/i18n';
import { ApiRequestError } from '../api/client.js';
import { CasePage } from './CasePage.js';

// Constitution §16: synthetic data only.
const DEMO_CASE_ID = 'case-demo-001';

const mockGetEmploymentCase = vi.fn();

vi.mock('../api/client.js', () => {
  class ApiRequestError extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string) {
      super(code);
      this.status = status;
      this.code = code;
    }
  }
  return {
    ApiRequestError,
    getEmploymentCase: (...args: unknown[]) => mockGetEmploymentCase(...args),
    // Sub-component APIs — return empty defaults so sections render silently
    listCaseContacts: () => Promise.resolve([]),
    listCaseTasks: () => Promise.resolve([]),
    listCaseTimeline: () => Promise.resolve([]),
    listCaseDocuments: () => Promise.resolve([]),
    listVisaRenewals: () => Promise.resolve([]),
    getCaseHealth: () => Promise.resolve({ score: 0, actionsRemaining: 0, factors: [] }),
    listProfessionalReviews: () => Promise.resolve([]),
    apiRequest: () =>
      Promise.resolve({ members: [], responsibilities: [], tasks: [], requests: [] }),
    listPayrollEntries: () => Promise.resolve([]),
    listCanonicalPayrollCloses: () => Promise.resolve([]),
    listScenarioExpenses: () => Promise.resolve([]),
    confirmAssistantChecklist: () => Promise.resolve(undefined),
  };
});

vi.mock('../storage/mvp-storage.js', () => ({
  readMvpPayroll: () => [],
  saveMvpPayroll: () => undefined,
  readMvpEmploymentExpenses: () => [],
  saveMvpEmploymentExpenses: () => undefined,
  // The payroll panel prefills a new month's base salary and rest-day rate
  // from the setup profile. This page renders that panel, so the mock has to
  // answer — an absent export throws at render and takes the whole CasePage
  // suite down with it, which is exactly what it did.
  readMvpProfile: () => ({ baseSalary: null, saturdayRate: null }),
}));

vi.mock('@caredesk/application', () => ({
  projectFutureCost: () => ({ months: [] }),
}));

const DEMO_CASE = {
  id: DEMO_CASE_ID,
  status: 'active',
  openedAt: '2026-01-15T00:00:00.000Z',
  careRecipient: { fullName: 'מטופל בדיקה', careLevel: 'full', city: 'תל אביב' },
  employer: {
    fullName: 'בועז בדיקה',
    relationshipToRecipient: 'בן',
    city: 'תל אביב',
    idNumber: '123456782',
  },
  caregiver: {
    legalName: 'Anna Petrov',
    preferredName: 'אנה',
    nationality: 'אוקראינה',
    primaryLanguage: 'אוקראינית',
  },
  startDate: '2026-01-15',
};

function renderPage(caseId = DEMO_CASE_ID) {
  return render(
    <I18nextProvider i18n={initI18n()}>
      <MemoryRouter initialEntries={[`/cases/${caseId}`]}>
        <Routes>
          <Route path="/cases/:caseId" element={<CasePage />} />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe('CasePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loaded state', () => {
    beforeEach(() => {
      mockGetEmploymentCase.mockResolvedValue(DEMO_CASE);
    });

    it('shows the case view title', async () => {
      renderPage();
      await waitFor(() =>
        expect(screen.getByRole('heading', { name: 'תיק העסקה' })).toBeInTheDocument(),
      );
    });

    it('displays the recipient name', async () => {
      renderPage();
      await waitFor(() => expect(screen.getByText('מטופל בדיקה')).toBeInTheDocument());
    });

    it('displays the employer name', async () => {
      renderPage();
      await waitFor(() => expect(screen.getByText('בועז בדיקה')).toBeInTheDocument());
    });

    it('displays the caregiver legal name', async () => {
      renderPage();
      await waitFor(() => expect(screen.getByText('Anna Petrov')).toBeInTheDocument());
    });

    it('calls getEmploymentCase with the caseId from params', async () => {
      renderPage(DEMO_CASE_ID);
      await waitFor(() => expect(mockGetEmploymentCase).toHaveBeenCalledWith(DEMO_CASE_ID));
    });
  });

  describe('status badge', () => {
    it('shows the draft label and neutral tone', async () => {
      mockGetEmploymentCase.mockResolvedValue({ ...DEMO_CASE, status: 'draft' });
      const { container } = renderPage();
      await waitFor(() => expect(screen.getByText('טיוטה')).toBeInTheDocument());
      expect(container.querySelector('.cd-status-badge--neutral')).not.toBeNull();
    });

    it('shows the active label and success tone', async () => {
      mockGetEmploymentCase.mockResolvedValue({ ...DEMO_CASE, status: 'active' });
      const { container } = renderPage();
      await waitFor(() => expect(screen.getByText('פעיל')).toBeInTheDocument());
      expect(container.querySelector('.cd-status-badge--success')).not.toBeNull();
    });

    // 'suspended'/'ended'/'cancelled'/'archived' all render with a
    // status-specific tone instead of the old binary draft/active read —
    // a suspended or ended case used to render as "active", which is a lie
    // on a screen a family reads. Asserting on the tone class (not the
    // translated label text) keeps this test stable regardless of when the
    // i18n resources for these newer keys land.
    it.each([
      ['suspended', 'warning'],
      ['ended', 'neutral'],
      ['cancelled', 'danger'],
      ['archived', 'neutral'],
    ] as const)('gives %s its own tone (%s), not the active tone', async (status, tone) => {
      mockGetEmploymentCase.mockResolvedValue({ ...DEMO_CASE, status });
      const { container } = renderPage();
      await waitFor(() =>
        expect(container.querySelector(`.cd-status-badge--${tone}`)).not.toBeNull(),
      );
      expect(container.querySelector('.cd-status-badge--success')).toBeNull();
    });

    it('falls back to a neutral tone and the raw value for an unrecognized status', async () => {
      mockGetEmploymentCase.mockResolvedValue({ ...DEMO_CASE, status: 'something_new' });
      const { container } = renderPage();
      await waitFor(() => expect(screen.getByText('something_new')).toBeInTheDocument());
      expect(container.querySelector('.cd-status-badge--neutral')).not.toBeNull();
    });
  });

  describe('not found state', () => {
    beforeEach(() => {
      mockGetEmploymentCase.mockRejectedValue(new ApiRequestError(404, 'not_found'));
    });

    it('shows not found error message', async () => {
      renderPage();
      await waitFor(() => expect(screen.getByText('התיק לא נמצא')).toBeInTheDocument());
    });
  });

  describe('generic error state', () => {
    beforeEach(() => {
      mockGetEmploymentCase.mockRejectedValue(new Error('network error'));
    });

    it('shows load failed error message', async () => {
      renderPage();
      await waitFor(() => expect(screen.getByText('טעינת התיק נכשלה')).toBeInTheDocument());
    });
  });
});
