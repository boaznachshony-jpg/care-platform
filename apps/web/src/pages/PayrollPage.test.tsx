import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { emptyMvpProfile, saveMvpPayroll, saveMvpProfile } from '../storage/mvp-storage.js';
import { PayrollPage } from './PayrollPage.js';

describe('PayrollPage annual report', () => {
  beforeEach(() => {
    localStorage.clear();
    saveMvpProfile({
      ...emptyMvpProfile,
      baseSalary: 7_000,
      salaryEffectiveDate: '2025-01-01',
    });
    saveMvpPayroll([
      {
        id: 'pay-2026-01',
        month: '2026-01',
        baseSalary: 7_000,
        workDays: 26,
        paidSaturdays: 1,
        saturdayPay: 500,
        pocketMoney: 0,
        otherAddition: 0,
        advances: 100,
        agreedDeduction: 0,
        total: 7_400,
        savedAt: '2026-01-31T12:00:00.000Z',
      },
      {
        id: 'pay-2026-02',
        month: '2026-02',
        baseSalary: 7_000,
        workDays: 24,
        paidSaturdays: 0,
        saturdayPay: 0,
        pocketMoney: 0,
        otherAddition: 250,
        advances: 0,
        agreedDeduction: 0,
        total: 7_250,
        savedAt: '2026-02-28T12:00:00.000Z',
      },
      {
        id: 'pay-2025-12',
        month: '2025-12',
        baseSalary: 6_500,
        workDays: 26,
        paidSaturdays: 0,
        saturdayPay: 0,
        pocketMoney: 0,
        otherAddition: 0,
        advances: 0,
        agreedDeduction: 0,
        total: 6_500,
        savedAt: '2025-12-31T12:00:00.000Z',
      },
    ]);
  });

  it('shows a reconciled report and changes the monthly detail with the selected year', () => {
    render(<PayrollPage />);

    expect(screen.getByRole('heading', { name: 'סיכום שכר שנתי' })).toBeInTheDocument();
    expect(screen.getByText('סה״כ לתשלום בשנת 2026')).toBeInTheDocument();
    expect(screen.getByText(/14,650\.00/)).toBeInTheDocument();
    expect(screen.getByText('2026-01')).toBeInTheDocument();
    expect(screen.queryByText('2025-12')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('שנת הדוח'), { target: { value: '2025' } });

    expect(screen.getByText('סה״כ לתשלום בשנת 2025')).toBeInTheDocument();
    expect(screen.getByText('2025-12')).toBeInTheDocument();
    expect(screen.queryByText('2026-01')).not.toBeInTheDocument();
  });
});
