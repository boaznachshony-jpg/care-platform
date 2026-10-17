import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@caredesk/i18n';
import { calculateMonthlyPayroll } from '@caredesk/domain';
import { PayrollPage, nationalInsuranceMonthRows } from './PayrollPage.js';
import { mergePayrollReportSources } from '../payroll-canonical.js';
import {
  emptyMvpProfile,
  readMvpPayroll,
  saveMvpPayroll,
  saveMvpProfile,
} from '../storage/mvp-storage.js';
import type { PayrollEntryResponse } from '../api/client.js';

const api = vi.hoisted(() => ({ list: vi.fn(), save: vi.fn() }));
vi.mock('../sync/use-case-for-legacy-client.js', () => ({
  useCaseForLegacyClient: () => ({ status: 'found', caseId: 'case-synthetic' }),
}));
vi.mock('../api/client.js', () => ({
  listPayrollEntries: (...args: unknown[]) => api.list(...args),
  savePayrollEntry: (...args: unknown[]) => api.save(...args),
  listCanonicalPayrollCloses: () => Promise.resolve([]),
  closeCanonicalPayrollMonth: () => Promise.reject(new Error('not used')),
}));

function canonical(): PayrollEntryResponse {
  return {
    id: 'f3e7d48d-7115-4198-96fd-dbc62646a3d8',
    month: '2026-09',
    baseSalary: 6000,
    workDays: 26,
    paidRestDays: 1,
    restDayRate: 440,
    paidHolidays: 0,
    holidayPay: 0,
    vacationDays: 0,
    vacationPay: 0,
    sickDays: 0,
    sickPay: 0,
    otherAbsenceDays: 0,
    employerContributions: 1000,
    additionalPayments: [],
    pocketMoney: 0,
    deductions: 150,
    advances: 1000,
    agreedDeductions: 0,
    total: 6290,
    status: 'draft',
    version: 3,
    createdAt: '2026-09-30T08:00:00Z',
    updatedAt: '2026-09-30T09:00:00Z',
    calculationContext: { schemaVersion: 1, restDay: 6 },
  };
}

beforeEach(() => {
  initI18n();
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  saveMvpProfile({ ...emptyMvpProfile, baseSalary: 1000, salaryEffectiveDate: '2026-01-01' });
  api.list.mockResolvedValue([canonical()]);
  api.save.mockImplementation((_case: string, month: string, input: PayrollEntryResponse) =>
    Promise.resolve({
      entry: {
        ...input,
        total: calculateMonthlyPayroll(input).total,
        id: canonical().id,
        month,
        version: 4,
        updatedAt: '2026-10-17T09:00:00Z',
      },
    }),
  );
});

describe('PayrollPage canonical reporting', () => {
  it('renders canonical-only annual data and uses its gross wage without a local mirror', async () => {
    render(<PayrollPage />);
    const heading = await screen.findByRole('heading', { name: 'שכר מצטבר והיסטוריה שנתית' });
    expect(heading.closest('section')?.textContent).toMatch(/7,290\.00/);
    expect(api.list).toHaveBeenCalledWith('case-synthetic');
    expect(readMvpPayroll()).toEqual([]);
    const rows = nationalInsuranceMonthRows(
      mergePayrollReportSources([], [canonical()]),
      ['2026-09'],
      1000,
      '3.6',
      {},
      '2026-10',
    );
    expect(rows[0]).toMatchObject({ wage: 6440, amount: 231.84 });
  });

  it('does not count canonical and legacy copies of the same month twice', async () => {
    saveMvpPayroll([
      {
        id: 'legacy',
        month: '2026-09',
        baseSalary: 3000,
        workDays: 26,
        paidSaturdays: 0,
        saturdayPay: 0,
        pocketMoney: 0,
        otherAddition: 0,
        advances: 0,
        agreedDeduction: 0,
        total: 3000,
        savedAt: '2026-09-20T09:00:00Z',
      },
    ]);
    render(<PayrollPage />);
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'שכר מצטבר והיסטוריה שנתית' }).closest('section')
          ?.textContent,
      ).toMatch(/7,290\.00/),
    );
    const section = screen
      .getByRole('heading', { name: 'שכר מצטבר והיסטוריה שנתית' })
      .closest('section')!;
    expect(section.querySelectorAll('.payroll-history > div')).toHaveLength(1);
    expect(readMvpPayroll()[0]?.total).toBe(3000);
  });

  it('edits an untouched aggregate deduction without mislabelling or losing it', async () => {
    render(<PayrollPage />);
    await screen.findByRole('heading', { name: 'שכר מצטבר והיסטוריה שנתית' });
    fireEvent.click(screen.getByRole('button', { name: 'עריכת החודש' }));
    for (let step = 0; step < 4; step += 1)
      fireEvent.click(screen.getByRole('button', { name: 'המשך' }));
    fireEvent.click(screen.getByRole('button', { name: 'אישור ושמירה' }));
    await waitFor(() => expect(api.save).toHaveBeenCalled());
    expect(api.save.mock.calls[0]?.[2]).toMatchObject({
      deductions: 150,
      total: 6290,
      version: 3,
      calculationContext: canonical().calculationContext,
    });
    expect(readMvpPayroll()).toEqual([]);
  });

  it('rejects raw amounts beyond cents using the existing validation surface', async () => {
    api.list.mockResolvedValue([]);
    render(<PayrollPage />);
    fireEvent.click(screen.getByRole('button', { name: 'המשך' }));
    fireEvent.change(screen.getByLabelText('שכר בסיס'), { target: { value: '6000.005' } });
    fireEvent.click(screen.getByRole('button', { name: 'המשך' }));
    expect(screen.getByRole('alert')).toHaveTextContent('שכר בסיס');
    expect(api.save).not.toHaveBeenCalled();
    expect(readMvpPayroll()).toEqual([]);
  });

  it('never writes a legacy fallback while the canonical source is unknown', () => {
    api.list.mockReturnValue(new Promise(() => {}));
    render(<PayrollPage />);
    for (let step = 0; step < 4; step += 1)
      fireEvent.click(screen.getByRole('button', { name: 'המשך' }));
    fireEvent.click(screen.getByRole('button', { name: 'אישור ושמירה' }));
    expect(screen.getByRole('alert')).toHaveTextContent('טעינת נתוני השכר הקנוניים נכשלה.');
    expect(readMvpPayroll()).toEqual([]);
    expect(api.save).not.toHaveBeenCalled();
  });
});
