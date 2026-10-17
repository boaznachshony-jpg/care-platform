import { describe, expect, it } from 'vitest';
import { calculateMonthlyPayroll } from './payroll-calculation.js';
import { createAnnualPayrollReport } from './payroll-report.js';
import { payrollIntelligence } from './product-intelligence.js';
import type { MvpPayrollRecord } from './storage/mvp-storage.js';

/**
 * C1. `/clients/:id/payroll` shows each month in two places: the cost table
 * (`payrollIntelligence`) and the annual report (`createAnnualPayrollReport`).
 * The cost table summed deductions without `pocketMoney`, so the case the
 * 16.10 review measured — base 6,000 + holiday 800 + pocket money 500 — was
 * shown as `base 6,000 · additions 800 · deductions 0 · total 6,300`, a row
 * that does not add up to its own total.
 */
function month(overrides: Partial<MvpPayrollRecord>): MvpPayrollRecord {
  const input = {
    baseSalary: 6_000,
    paidSaturdays: 0,
    saturdayRate: 0,
    holidayPay: 0,
    vacationPay: 0,
    sickPay: 0,
    pocketMoney: 0,
    employerContributions: 0,
    otherAddition: 0,
    medicalInsuranceDeduction: 0,
    housingDeduction: 0,
    advances: 0,
    agreedDeduction: 0,
    ...overrides,
  };
  const calculated = calculateMonthlyPayroll({
    baseSalary: input.baseSalary,
    paidSaturdays: input.paidSaturdays,
    saturdayRate: input.saturdayRate,
    holidayPay: input.holidayPay,
    vacationPay: input.vacationPay,
    sickPay: input.sickPay,
    pocketMoney: input.pocketMoney,
    employerContributions: input.employerContributions,
    otherAddition: input.otherAddition,
    medicalInsuranceDeduction: input.medicalInsuranceDeduction,
    housingDeduction: input.housingDeduction,
    advances: input.advances,
    agreedDeduction: input.agreedDeduction,
  });
  return {
    id: `payroll-${overrides.month ?? '2026-09'}`,
    month: '2026-09',
    workDays: 26,
    saturdayPay: calculated.saturdayPay,
    savedAt: '2026-09-30T12:00:00.000Z',
    ...input,
    total: calculated.total,
  };
}

function costRow(record: MvpPayrollRecord) {
  const { analytics } = payrollIntelligence([record], [], [], '2026', '2026-01', 6_000);
  const row = analytics.trend.find((r) => r.month === record.month);
  if (!row) throw new Error(`no cost row for ${record.month}`);
  return row;
}

describe('payroll cost table (C1)', () => {
  it('counts pocket money as a deduction, so the row adds up to its own total', () => {
    const record = month({ holidayPay: 800, pocketMoney: 500 });
    expect(record.total).toBe(6_300);

    const row = costRow(record);

    expect(row.baseSalary).toBe(6_000);
    expect(row.additions).toBe(800);
    expect(row.deductions).toBe(500);
    expect(row.total).toBe(6_300);
    expect(row.baseSalary + row.additions - row.deductions).toBe(row.total);
  });

  it('shows the same additions and deductions as the annual report on the same screen', () => {
    const record = month({
      month: '2026-08',
      holidayPay: 800,
      vacationPay: 250,
      pocketMoney: 500,
      medicalInsuranceDeduction: 150,
      advances: 200,
      agreedDeduction: 50,
    });

    const row = costRow(record);
    const report = createAnnualPayrollReport([record], '2026');

    expect(row.additions).toBe(report.additions);
    expect(row.deductions).toBe(report.deductions);
    expect(row.total).toBe(report.totalPaid);
    expect(row.baseSalary + row.additions - row.deductions).toBe(row.total);
  });
});
