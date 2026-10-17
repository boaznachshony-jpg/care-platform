import type { MvpPayrollRecord } from './storage/mvp-storage.js';

export interface AnnualPayrollReport {
  year: string;
  records: MvpPayrollRecord[];
  monthsReported: number;
  baseSalary: number;
  saturdayPay: number;
  holidayPay: number;
  vacationPay: number;
  sickPay: number;
  employerContributions: number;
  otherAdditions: number;
  additions: number;
  deductions: number;
  totalPaid: number;
}

function amount(value: number | undefined): number {
  return Number.isFinite(value) ? (value ?? 0) : 0;
}

/**
 * C1. The one definition of a month's additions and deductions on the web.
 *
 * `/clients/:id/payroll` shows the same month twice: in the annual report built
 * here, and in the cost table `payrollIntelligence` builds. The cost table kept
 * its own copy of the sum and left `pocketMoney` out of the deductions, so a
 * month of base 6,000 + holiday 800 + pocket money 500 was shown there as
 * deductions 0 and total 6,300 — a row that does not add up, next to a report
 * that says deductions 500. `pocketMoney` is a deduction
 * (`packages/domain/src/payroll.ts`), so every screen sums it through here.
 */
export function payrollRecordAdditions(
  record: Pick<
    MvpPayrollRecord,
    | 'saturdayPay'
    | 'holidayPay'
    | 'vacationPay'
    | 'sickPay'
    | 'employerContributions'
    | 'otherAddition'
    | 'additionalPayments'
  >,
): number {
  return (
    amount(record.saturdayPay) +
    amount(record.holidayPay) +
    amount(record.vacationPay) +
    amount(record.sickPay) +
    amount(record.employerContributions) +
    amount(record.otherAddition) +
    (record.additionalPayments ?? []).reduce((total, payment) => total + amount(payment.amount), 0)
  );
}

export function payrollRecordDeductions(
  record: Pick<
    MvpPayrollRecord,
    | 'pocketMoney'
    | 'medicalInsuranceDeduction'
    | 'housingDeduction'
    | 'advances'
    | 'agreedDeduction'
  >,
): number {
  return (
    amount(record.pocketMoney) +
    amount(record.medicalInsuranceDeduction) +
    amount(record.housingDeduction) +
    amount(record.advances) +
    amount(record.agreedDeduction)
  );
}

export function getPayrollYears(records: MvpPayrollRecord[]): string[] {
  return [...new Set(records.map((record) => record.month.slice(0, 4)).filter(Boolean))].sort(
    (first, second) => second.localeCompare(first),
  );
}

export function createAnnualPayrollReport(
  records: MvpPayrollRecord[],
  year: string,
): AnnualPayrollReport {
  const annualRecords = records
    .filter((record) => record.month.startsWith(`${year}-`))
    .sort((first, second) => first.month.localeCompare(second.month));

  return annualRecords.reduce<AnnualPayrollReport>(
    (report, record) => {
      const additionalPayments = (record.additionalPayments ?? []).reduce(
        (total, payment) => total + amount(payment.amount),
        0,
      );
      report.baseSalary += amount(record.baseSalary);
      report.saturdayPay += amount(record.saturdayPay);
      report.holidayPay += amount(record.holidayPay);
      report.vacationPay += amount(record.vacationPay);
      report.sickPay += amount(record.sickPay);
      report.employerContributions += amount(record.employerContributions);
      report.otherAdditions += amount(record.otherAddition) + additionalPayments;
      report.additions += payrollRecordAdditions(record);
      report.deductions += payrollRecordDeductions(record);
      report.totalPaid += amount(record.total);
      return report;
    },
    {
      year,
      records: annualRecords,
      monthsReported: annualRecords.length,
      baseSalary: 0,
      saturdayPay: 0,
      holidayPay: 0,
      vacationPay: 0,
      sickPay: 0,
      employerContributions: 0,
      otherAdditions: 0,
      additions: 0,
      deductions: 0,
      totalPaid: 0,
    },
  );
}
