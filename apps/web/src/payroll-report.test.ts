import { describe, expect, it } from 'vitest';
import {
  createAnnualPayrollReport,
  createPeriodPayrollReport,
  getPayrollYears,
} from './payroll-report.js';
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
          vacationPay: 250,
          sickPay: 100,
          employerContributions: 600,
          otherAddition: 50,
          additionalPayments: [{ id: 'bonus', description: 'Bonus', amount: 75 }],
          pocketMoney: 100,
          advances: 100,
          total: 8_375,
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
    expect(report.saturdayPay).toBe(500);
    expect(report.holidayPay).toBe(400);
    expect(report.vacationPay).toBe(250);
    expect(report.sickPay).toBe(100);
    expect(report.employerContributions).toBe(600);
    expect(report.otherAdditions).toBe(125);
    expect(report.additions).toBe(1_975);
    expect(report.deductions).toBe(350);
    expect(report.totalPaid).toBe(15_625);
  });

  it('treats optional legacy payroll fields as zero', () => {
    const report = createAnnualPayrollReport([payroll('legacy', '2026-03')], '2026');

    expect(report.additions).toBe(0);
    expect(report.deductions).toBe(0);
    expect(report.totalPaid).toBe(7_000);
  });
});

describe('period payroll report', () => {
  it('sums every supported component, recorded day and deduction inside the range', () => {
    const report = createPeriodPayrollReport(
      [
        payroll('jan', '2026-01', {
          saturdayPay: 500,
          holidayPay: 200,
          vacationPay: 300,
          sickPay: 100,
          employerContributions: 700,
          otherAddition: 50,
          additionalPayments: [{ id: 'bonus', description: 'bonus', amount: 150 }],
          vacationDays: 2,
          sickDays: 1,
          paidHolidays: 1,
          pocketMoney: 100,
          medicalInsuranceDeduction: 50,
          housingDeduction: 75,
          advances: 400,
          agreedDeduction: 25,
          total: 8_350,
        }),
        payroll('feb', '2026-02', { vacationDays: 1, advances: 200, total: 6_800 }),
        payroll('outside', '2026-03', { total: 99_999 }),
      ],
      '2026-01',
      '2026-02',
    );

    expect(report.monthsReported).toBe(2);
    expect(report.baseSalary).toBe(14_000);
    expect(report.additionalPayments).toBe(150);
    expect(report.additions).toBe(2_000);
    expect(report.deductions).toBe(850);
    expect(report.calculatedFinalTotal).toBe(15_150);
    expect(report.vacationDays).toBe(3);
    expect(report.sickDays).toBe(1);
    expect(report.paidHolidays).toBe(1);
    expect(report.advances).toBe(600);
  });

  it('treats missing legacy fields as zero and reports that limitation', () => {
    const report = createPeriodPayrollReport([payroll('legacy', '2026-01')], '2026-01', '2026-01');
    expect(report.recordsWithMissingOptionalFields).toBe(1);
    expect(report.vacationDays).toBe(0);
    expect(report.additionalPayments).toBe(0);
  });
});
