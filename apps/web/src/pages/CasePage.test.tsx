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
    confirmAssistantChecklist: () => Promise.resolve(undefined),
  };
});

vi.mock('../storage/mvp-storage.js', () => ({
  readMvpPayroll: () => [],
  saveMvpPayroll: () => undefined,
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
