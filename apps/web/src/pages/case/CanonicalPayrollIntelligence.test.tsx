import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CanonicalPayrollIntelligence } from './CanonicalPayrollIntelligence.js';

// Constitution §16: synthetic data only.
const DEMO_CASE_ID = 'case-demo-001';
const CURRENT_MONTH = new Date().toISOString().slice(0, 7);

const LEGACY_RECORD = {
  id: 'legacy-payroll-001',
  month: CURRENT_MONTH,
  baseSalary: 5000,
  workDays: 22,
  paidSaturdays: 4,
  saturdayPay: 800,
  saturdayRate: 200,
  pocketMoney: 500,
  otherAddition: 0,
  advances: 0,
  agreedDeduction: 0,
  total: 6300,
  savedAt: '2026-08-01T10:00:00.000Z',
};

const mockListPayrollEntries = vi.fn();
const mockListCanonicalPayrollCloses = vi.fn();
const mockSavePayrollEntry = vi.fn();
const mockReadMvpPayroll = vi.fn();
const mockSaveMvpPayroll = vi.fn();

vi.mock('../../api/client.js', () => {
  class ApiRequestError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }
  return {
    ApiRequestError,
    listPayrollEntries: (...args: unknown[]) => mockListPayrollEntries(...args),
    listCanonicalPayrollCloses: (...args: unknown[]) => mockListCanonicalPayrollCloses(...args),
    savePayrollEntry: (...args: unknown[]) => mockSavePayrollEntry(...args),
  };
});

vi.mock('../../storage/mvp-storage.js', () => ({
  readMvpPayroll: (...args: unknown[]) => mockReadMvpPayroll(...args),
  saveMvpPayroll: (...args: unknown[]) => mockSaveMvpPayroll(...args),
}));

vi.mock('@caredesk/application', () => ({
  projectFutureCost: () => ({ months: [] }),
}));

beforeEach(() => {
  mockListPayrollEntries.mockResolvedValue([]);
  mockListCanonicalPayrollCloses.mockResolvedValue([]);
  mockSavePayrollEntry.mockResolvedValue({ entry: {}, replayed: false });
  mockReadMvpPayroll.mockReturnValue([]);
  mockSaveMvpPayroll.mockReturnValue(undefined);
});

function renderPanel(caseId = DEMO_CASE_ID) {
  return render(<CanonicalPayrollIntelligence caseId={caseId} />);
}

describe('CanonicalPayrollIntelligence — reconciliation', () => {
  it('renders the canonical payroll section', async () => {
    renderPanel();
    await waitFor(() =>
      expect(screen.getByRole('region', { name: /רישום שכר חודשי/ })).toBeInTheDocument(),
    );
  });

  it('shows no migration notice when there is no legacy record', async () => {
    mockReadMvpPayroll.mockReturnValue([]);
    renderPanel();
    await waitFor(() => screen.getByRole('region', { name: /רישום שכר חודשי/ }));
    expect(screen.queryByText(/התאמת רישום MVP קיים/)).not.toBeInTheDocument();
  });

  it('shows migration notice when a legacy record exists for the selected month', async () => {
    mockReadMvpPayroll.mockReturnValue([LEGACY_RECORD]);
    renderPanel();
    await waitFor(() => expect(screen.getByText(/התאמת רישום MVP קיים/)).toBeInTheDocument());
  });

  it('prepare button is disabled until migration checkbox is checked', async () => {
    mockReadMvpPayroll.mockReturnValue([LEGACY_RECORD]);
    renderPanel();
    await waitFor(() => screen.getByText(/התאמת רישום MVP קיים/));
    expect(screen.getByRole('button', { name: /הכנת נתונים להעברה/ })).toBeDisabled();
  });

  it('prepare button enables after checkbox is checked', async () => {
    mockReadMvpPayroll.mockReturnValue([LEGACY_RECORD]);
    renderPanel();
    await waitFor(() => screen.getByText(/התאמת רישום MVP קיים/));
    fireEvent.click(screen.getByRole('checkbox', { name: /בדקתי שהרישום שייך לתיק זה/ }));
    expect(screen.getByRole('button', { name: /הכנת נתונים להעברה/ })).not.toBeDisabled();
  });

  it('cleanup button appears after successful canonical save of a migration', async () => {
    mockReadMvpPayroll.mockReturnValue([LEGACY_RECORD]);
    renderPanel();
    await waitFor(() => screen.getByText(/התאמת רישום MVP קיים/));

    fireEvent.click(screen.getByRole('checkbox', { name: /בדקתי שהרישום שייך לתיק זה/ }));
    fireEvent.click(screen.getByRole('button', { name: /הכנת נתונים להעברה/ }));
    fireEvent.click(screen.getByRole('button', { name: /יצירת רשומה/ }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /הסרת הרישום הישן מהדפדפן/ })).toBeInTheDocument(),
    );
  });

  it('cleanup button does NOT appear after a non-migration save', async () => {
    mockReadMvpPayroll.mockReturnValue([]); // no legacy record
    renderPanel();
    await waitFor(() => screen.getByRole('region', { name: /רישום שכר חודשי/ }));

    fireEvent.click(screen.getByRole('button', { name: /יצירת רשומה/ }));

    await waitFor(() => expect(mockSavePayrollEntry).toHaveBeenCalledOnce());
    expect(
      screen.queryByRole('button', { name: /הסרת הרישום הישן מהדפדפן/ }),
    ).not.toBeInTheDocument();
  });

  it('purge calls saveMvpPayroll filtering out the migrated month', async () => {
    mockReadMvpPayroll.mockReturnValue([LEGACY_RECORD]);
    renderPanel();
    await waitFor(() => screen.getByText(/התאמת רישום MVP קיים/));

    fireEvent.click(screen.getByRole('checkbox', { name: /בדקתי שהרישום שייך לתיק זה/ }));
    fireEvent.click(screen.getByRole('button', { name: /הכנת נתונים להעברה/ }));
    fireEvent.click(screen.getByRole('button', { name: /יצירת רשומה/ }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /הסרת הרישום הישן מהדפדפן/ })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: /הסרת הרישום הישן מהדפדפן/ }));

    expect(mockSaveMvpPayroll).toHaveBeenCalledOnce();
    const [savedRecords] = mockSaveMvpPayroll.mock.calls[0] as [(typeof LEGACY_RECORD)[]];
    expect(savedRecords.some((r) => r.month === CURRENT_MONTH)).toBe(false);
  });

  it('shows success message after purge and hides the cleanup button', async () => {
    mockReadMvpPayroll.mockReturnValue([LEGACY_RECORD]);
    renderPanel();
    await waitFor(() => screen.getByText(/התאמת רישום MVP קיים/));

    fireEvent.click(screen.getByRole('checkbox', { name: /בדקתי שהרישום שייך לתיק זה/ }));
    fireEvent.click(screen.getByRole('button', { name: /הכנת נתונים להעברה/ }));
    fireEvent.click(screen.getByRole('button', { name: /יצירת רשומה/ }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /הסרת הרישום הישן מהדפדפן/ })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: /הסרת הרישום הישן מהדפדפן/ }));

    await waitFor(() => expect(screen.getByText(/הרישום הישן הוסר/)).toBeInTheDocument());
    expect(
      screen.queryByRole('button', { name: /הסרת הרישום הישן מהדפדפן/ }),
    ).not.toBeInTheDocument();
  });

  it('rollback evidence: legacy record is preserved until purge is explicitly triggered', async () => {
    mockReadMvpPayroll.mockReturnValue([LEGACY_RECORD]);
    renderPanel();
    await waitFor(() => screen.getByText(/התאמת רישום MVP קיים/));

    fireEvent.click(screen.getByRole('checkbox', { name: /בדקתי שהרישום שייך לתיק זה/ }));
    fireEvent.click(screen.getByRole('button', { name: /הכנת נתונים להעברה/ }));
    fireEvent.click(screen.getByRole('button', { name: /יצירת רשומה/ }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /הסרת הרישום הישן מהדפדפן/ })).toBeInTheDocument(),
    );

    // saveMvpPayroll was NOT called — legacy record is still intact
    expect(mockSaveMvpPayroll).not.toHaveBeenCalled();
  });
});
