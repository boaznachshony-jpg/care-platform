import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@caredesk/i18n';
import {
  emptyMvpProfile,
  saveMvpEmploymentExpenses,
  saveMvpProfile,
} from '../storage/mvp-storage.js';
import type { CaseLookupState } from '../sync/use-case-for-legacy-client.js';

/**
 * R5-09 stage 2 on the payroll screen: a saved National Insurance report is
 * copied to the server in the background, and a copy that fails is said on
 * screen with a way to try again (CLAUDE.md §2) - never swallowed.
 */
const mocks = vi.hoisted(() => ({
  importNationalInsuranceReport: vi.fn(),
  useCaseForLegacyClient: vi.fn<(legacyClientId: string) => CaseLookupState>(),
}));
vi.mock('../sync/use-case-for-legacy-client.js', () => ({
  useCaseForLegacyClient: (id: string) => mocks.useCaseForLegacyClient(id),
}));
vi.mock('../api/client.js', () => ({
  ApiRequestError: class ApiRequestError extends Error {
    constructor(
      readonly status: number,
      readonly code: string,
    ) {
      super(code);
    }
  },
  listCanonicalPayrollCloses: () => Promise.resolve([]),
  closeCanonicalPayrollMonth: () => Promise.reject(new Error('not used here')),
  importNationalInsuranceReport: mocks.importNationalInsuranceReport,
}));
vi.mock('../storage/workspace-sync.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../storage/workspace-sync.js')>()),
  // The account's workspace has loaded from the server in this session.
  hasHydratedWorkspaceThisSession: () => true,
}));

import { PayrollPage } from './PayrollPage.js';

// Synthetic figures only.
const SAVED_PAYMENT = {
  id: 'expense-ni-2026-q3',
  category: 'ביטוח לאומי',
  frequency: 'quarterly' as const,
  amount: 426,
  amountEntered: true,
  dueDate: '2026-10-15',
  status: 'upcoming' as const,
  note: '',
  savedAt: '2026-10-17T10:00:00.000Z',
  nationalInsuranceMonths: [
    { month: '2026-07', employed: true, wage: 6000, ratePercent: 3.55, amount: 213 },
    { month: '2026-08', employed: true, wage: 6000, ratePercent: 3.55, amount: 213 },
    { month: '2026-09', employed: false, wage: 0, ratePercent: 3.55, amount: 0 },
  ],
};

function renderPage() {
  return render(
    <I18nextProvider i18n={initI18n()}>
      <PayrollPage />
    </I18nextProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  mocks.importNationalInsuranceReport.mockReset();
  mocks.useCaseForLegacyClient.mockReturnValue({ status: 'found', caseId: 'case-ni-001' });
  saveMvpProfile({ ...emptyMvpProfile, baseSalary: 7_000, salaryEffectiveDate: '2025-01-01' });
  saveMvpEmploymentExpenses([SAVED_PAYMENT]);
});

describe('PayrollPage - National Insurance report copy', () => {
  it('copies the saved report lines to the case, and says nothing when it worked', async () => {
    mocks.importNationalInsuranceReport.mockResolvedValue({ report: {}, outcome: 'created' });
    renderPage();
    await waitFor(() => expect(mocks.importNationalInsuranceReport).toHaveBeenCalledOnce());
    expect(mocks.importNationalInsuranceReport).toHaveBeenCalledWith('case-ni-001', {
      legacyExpenseId: 'expense-ni-2026-q3',
      dueDate: '2026-10-15',
      months: SAVED_PAYMENT.nationalInsuranceMonths,
    });
    expect(screen.queryByText(/לא הועתקו לשרת/)).not.toBeInTheDocument();
  });

  it('shows a copy that failed, and tries again when asked', async () => {
    mocks.importNationalInsuranceReport
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue({ report: {}, outcome: 'created' });
    renderPage();

    const alert = await screen.findByText(/1 דוחות ביטוח לאומי עדיין לא הועתקו לשרת/);
    expect(alert).toHaveAttribute('role', 'alert');
    expect(alert).toHaveTextContent(/לא אבד דבר/);

    fireEvent.click(screen.getByRole('button', { name: 'נסו שוב' }));
    await waitFor(() => expect(mocks.importNationalInsuranceReport).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText(/לא הועתקו לשרת/)).not.toBeInTheDocument());
  });
});
