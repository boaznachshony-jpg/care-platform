import type { MvpPayrollRecord } from './storage/mvp-storage.js';

export interface AnnualPayrollReport {
  year: string;
  records: MvpPayrollRecord[];
  monthsReported: number;
  baseSalary: number;
  additions: number;
  deductions: number;
  totalPaid: number;
  employerContributions: number;
}

function amount(value: number | undefined): number {
  return Number.isFinite(value) ? (value ?? 0) : 0;
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
      report.baseSalary += amount(record.baseSalary);
      report.additions +=
        amount(record.saturdayPay) +
        amount(record.holidayPay) +
        amount(record.vacationPay) +
        amount(record.sickPay) +
        amount(record.employerContributions) +
        amount(record.otherAddition);
      report.deductions +=
        amount(record.pocketMoney) +
        amount(record.medicalInsuranceDeduction) +
        amount(record.housingDeduction) +
        amount(record.advances) +
        amount(record.agreedDeduction);
      report.employerContributions += amount(record.employerContributions);
      report.totalPaid += amount(record.total);
      return report;
    },
    {
      year,
      records: annualRecords,
      monthsReported: annualRecords.length,
      baseSalary: 0,
      additions: 0,
      deductions: 0,
      totalPaid: 0,
      employerContributions: 0,
    },
  );
}
