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

export interface PeriodPayrollReport {
  startMonth: string;
  endMonth: string;
  records: MvpPayrollRecord[];
  monthsReported: number;
  baseSalary: number;
  saturdayPay: number;
  holidayPay: number;
  vacationPay: number;
  sickPay: number;
  employerContributions: number;
  otherAddition: number;
  additionalPayments: number;
  additions: number;
  pocketMoney: number;
  medicalInsuranceDeduction: number;
  housingDeduction: number;
  advances: number;
  agreedDeduction: number;
  deductions: number;
  calculatedFinalTotal: number;
  vacationDays: number;
  sickDays: number;
  paidHolidays: number;
  recordsWithMissingOptionalFields: number;
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
      report.additions +=
        amount(record.saturdayPay) +
        amount(record.holidayPay) +
        amount(record.vacationPay) +
        amount(record.sickPay) +
        amount(record.employerContributions) +
        amount(record.otherAddition) +
        additionalPayments;
      report.deductions +=
        amount(record.pocketMoney) +
        amount(record.medicalInsuranceDeduction) +
        amount(record.housingDeduction) +
        amount(record.advances) +
        amount(record.agreedDeduction);
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

export function createPeriodPayrollReport(
  records: MvpPayrollRecord[],
  startMonth: string,
  endMonth: string,
): PeriodPayrollReport {
  const periodRecords = records
    .filter((record) => record.month >= startMonth && record.month <= endMonth)
    .sort((first, second) => first.month.localeCompare(second.month));
  const optionalFields: Array<keyof MvpPayrollRecord> = [
    'vacationDays',
    'sickDays',
    'paidHolidays',
    'holidayPay',
    'vacationPay',
    'sickPay',
    'employerContributions',
    'medicalInsuranceDeduction',
    'housingDeduction',
    'additionalPayments',
  ];

  const report = periodRecords.reduce<PeriodPayrollReport>(
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
      report.otherAddition += amount(record.otherAddition);
      report.additionalPayments += additionalPayments;
      report.pocketMoney += amount(record.pocketMoney);
      report.medicalInsuranceDeduction += amount(record.medicalInsuranceDeduction);
      report.housingDeduction += amount(record.housingDeduction);
      report.advances += amount(record.advances);
      report.agreedDeduction += amount(record.agreedDeduction);
      report.vacationDays += amount(record.vacationDays);
      report.sickDays += amount(record.sickDays);
      report.paidHolidays += amount(record.paidHolidays);
      report.calculatedFinalTotal += amount(record.total);
      if (optionalFields.some((field) => record[field] === undefined)) {
        report.recordsWithMissingOptionalFields += 1;
      }
      return report;
    },
    {
      startMonth,
      endMonth,
      records: periodRecords,
      monthsReported: periodRecords.length,
      baseSalary: 0,
      saturdayPay: 0,
      holidayPay: 0,
      vacationPay: 0,
      sickPay: 0,
      employerContributions: 0,
      otherAddition: 0,
      additionalPayments: 0,
      additions: 0,
      pocketMoney: 0,
      medicalInsuranceDeduction: 0,
      housingDeduction: 0,
      advances: 0,
      agreedDeduction: 0,
      deductions: 0,
      calculatedFinalTotal: 0,
      vacationDays: 0,
      sickDays: 0,
      paidHolidays: 0,
      recordsWithMissingOptionalFields: 0,
    },
  );
  report.additions =
    report.saturdayPay +
    report.holidayPay +
    report.vacationPay +
    report.sickPay +
    report.employerContributions +
    report.otherAddition +
    report.additionalPayments;
  report.deductions =
    report.pocketMoney +
    report.medicalInsuranceDeduction +
    report.housingDeduction +
    report.advances +
    report.agreedDeduction;
  return report;
}
