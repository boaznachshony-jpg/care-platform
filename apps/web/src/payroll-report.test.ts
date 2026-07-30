import { describe, expect, it } from 'vitest';
import { createAnnualPayrollReport, getPayrollYears } from './payroll-report.js';
import type { MvpPayrollRecord } from './storage/mvp-storage.js';

function payroll(
  id: string,
  month: string,
  overrides: Partial<MvpPayrollRecord> = {},
): MvpPayrollRecord {
  return {
    id,
    month,
    baseSalary: 7_000,
    workDays: 26,
    paidSaturdays: 0,
    saturdayPay: 0,
    pocketMoney: 0,
    otherAddition: 0,
    advances: 0,
    agreedDeduction: 0,
    total: 7_000,
    savedAt: `${month}-28T12:00:00.000Z`,
    ...overrides,
  };
}

describe('annual payroll report', () => {
  it('lists available years from newest to oldest without duplicates', () => {
    expect(
      getPayrollYears([
        payroll('one', '2025-12'),
        payroll('two', '2026-01'),
        payroll('three', '2026-02'),
      ]),
    ).toEqual(['2026', '2025']);
  });

  it('sums only the selected year and reconciles the annual total to monthly totals', () => {
    const report = createAnnualPayrollReport(
      [
        payroll('jan', '2026-01', {
          saturdayPay: 500,
          employerContributions: 600,
          advances: 100,
          total: 8_000,
        }),
        payroll('feb', '2026-02', {
          holidayPay: 400,
          medicalInsuranceDeduction: 150,
          total: 7_250,
        }),
        payroll('old', '2025-12', { total: 99_999 }),
      ],
      '2026',
    );

    expect(report.records.map((record) => record.month)).toEqual(['2026-01', '2026-02']);
    expect(report.monthsReported).toBe(2);
    expect(report.baseSalary).toBe(14_000);
    expect(report.additions).toBe(1_500);
    expect(report.deductions).toBe(250);
    expect(report.employerContributions).toBe(600);
    expect(report.totalPaid).toBe(15_250);
  });

  it('treats optional legacy payroll fields as zero', () => {
    const report = createAnnualPayrollReport([payroll('legacy', '2026-03')], '2026');

    expect(report.additions).toBe(0);
    expect(report.deductions).toBe(0);
    expect(report.totalPaid).toBe(7_000);
  });
});
