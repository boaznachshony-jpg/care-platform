import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@caredesk/i18n';
import type { PayrollEntryResponse } from '../api/client.js';
import { canonicalPayrollReportRecord } from '../payroll-canonical.js';
import { PayrollIntelligence } from './PayrollIntelligence.js';

const api = vi.hoisted(() => ({ list: vi.fn(), save: vi.fn(), close: vi.fn(), closes: vi.fn() }));
vi.mock('../api/client.js', () => ({
  listPayrollEntries: (...args: unknown[]) => api.list(...args),
  savePayrollEntry: (...args: unknown[]) => api.save(...args),
  closeCanonicalPayrollMonth: (...args: unknown[]) => api.close(...args),
  listCanonicalPayrollCloses: (...args: unknown[]) => api.closes(...args),
}));

function entry(): PayrollEntryResponse {
  return {
    id: 'f3e7d48d-7115-4198-96fd-dbc62646a3d8',
    month: '2026-09',
    baseSalary: 6000,
    workDays: 26,
    paidRestDays: 0,
    restDayRate: 0,
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
    deductions: 0,
    advances: 6500,
    agreedDeductions: 0,
    total: 500,
    status: 'draft',
    version: 3,
    createdAt: '2026-09-30T08:00:00Z',
    updatedAt: '2026-09-30T09:00:00Z',
  };
}

beforeEach(() => {
  initI18n();
  vi.clearAllMocks();
  api.closes.mockResolvedValue([]);
  api.close.mockResolvedValue({ replayed: false });
});

function show(source: PayrollEntryResponse) {
  api.list.mockResolvedValue([source]);
  api.save.mockResolvedValue({ entry: { ...source, status: 'final', version: 4 } });
  render(
    <PayrollIntelligence
      records={[canonicalPayrollReportRecord(source)]}
      expenses={[]}
      baseSalary={6000}
      caseLookup={{ status: 'found', caseId: 'case-synthetic' }}
    />,
  );
}

describe('worker settlement close payload', () => {
  it('finalizes with the version and closes signed worker -500 despite historical total +500', async () => {
    show(entry());
    const button = screen.getByRole('button', { name: 'אישור שהחודש מוכן וסגירה' });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    await waitFor(() => expect(api.close).toHaveBeenCalled());
    expect(api.save.mock.calls[0]?.[2]).toMatchObject({ status: 'final', version: 3, total: 500 });
    expect(api.close.mock.calls[0]?.[1]).toMatchObject({
      payrollReference: entry().id,
      payrollVersion: 4,
      month: '2026-09',
      total: -500,
      baseSalary: 6000,
      additions: 0,
      deductions: 6500,
    });
  });

  it('keeps signed opening balance separate from current wage and employer accrual', async () => {
    const source = {
      ...entry(),
      advances: 0,
      total: 7000,
      calculationContext: {
        schemaVersion: 1 as const,
        openingBalance: {
          sourceMonth: '2026-08',
          amount: -500,
          reference: 'synthetic-prior',
          sourceVersion: 2,
          ruleId: 'synthetic-carry-rule',
        },
      },
    };
    show(source);
    fireEvent.click(screen.getByRole('button', { name: 'אישור שהחודש מוכן וסגירה' }));
    await waitFor(() => expect(api.close).toHaveBeenCalled());
    expect(api.close.mock.calls[0]?.[1]).toMatchObject({
      total: 5500,
      baseSalary: 6000,
      additions: 0,
      deductions: 500,
    });
    expect(api.save.mock.calls[0]?.[2]).toMatchObject({
      total: 7000,
      calculationContext: source.calculationContext,
    });
  });
});
