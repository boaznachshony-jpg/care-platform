import type { MvpPayrollRecord } from './storage/mvp-storage.js';
import {
  addAgorot,
  agorotFromShekels,
  shekelsOf,
  ZERO_AGOROT,
  type Agorot,
} from '@caredesk/domain';

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
  costDeductions: number;
  totalPaid: number;
  payableToWorker: number;
  previouslyPaid: number;
  employmentCost: number;
}

function amount(value: number | undefined): number {
  return Number.isFinite(value) ? (value ?? 0) : 0;
}

function sumMoney(...values: Array<number | undefined>): number {
  return shekelsOf(
    values.reduce<Agorot>(
      (total, value) => addAgorot(total, agorotFromShekels(amount(value))),
      ZERO_AGOROT,
    ),
  );
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
  return sumMoney(
    record.saturdayPay,
    record.holidayPay,
    record.vacationPay,
    record.sickPay,
    record.employerContributions,
    record.otherAddition,
    ...(record.additionalPayments ?? []).map((payment) => payment.amount),
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
  const canonicalDeductions =
    'canonicalDeductions' in record
      ? amount(record.canonicalDeductions as number)
      : sumMoney(record.medicalInsuranceDeduction, record.housingDeduction);
  return sumMoney(record.pocketMoney, canonicalDeductions, record.advances, record.agreedDeduction);
}

export function payrollRecordEmploymentCost(
  record: Pick<MvpPayrollRecord, 'total' | 'advances' | 'pocketMoney'>,
): number {
  return sumMoney(record.total, record.advances, record.pocketMoney);
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
      const additionalPayments = sumMoney(
        ...(record.additionalPayments ?? []).map((payment) => payment.amount),
      );
      report.baseSalary = sumMoney(report.baseSalary, record.baseSalary);
      report.saturdayPay = sumMoney(report.saturdayPay, record.saturdayPay);
      report.holidayPay = sumMoney(report.holidayPay, record.holidayPay);
      report.vacationPay = sumMoney(report.vacationPay, record.vacationPay);
      report.sickPay = sumMoney(report.sickPay, record.sickPay);
      report.employerContributions = sumMoney(
        report.employerContributions,
        record.employerContributions,
      );
      report.otherAdditions = sumMoney(
        report.otherAdditions,
        record.otherAddition,
        additionalPayments,
      );
      report.additions = sumMoney(report.additions, payrollRecordAdditions(record));
      report.deductions = sumMoney(report.deductions, payrollRecordDeductions(record));
      report.costDeductions = sumMoney(
        report.costDeductions,
        payrollRecordDeductions(record),
        -amount(record.advances),
        -amount(record.pocketMoney),
      );
      report.totalPaid = sumMoney(report.totalPaid, record.total);
      report.payableToWorker = sumMoney(
        report.payableToWorker,
        record.total,
        -amount(record.employerContributions),
      );
      report.previouslyPaid = sumMoney(report.previouslyPaid, record.advances, record.pocketMoney);
      report.employmentCost = sumMoney(report.employmentCost, payrollRecordEmploymentCost(record));
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
      costDeductions: 0,
      totalPaid: 0,
      payableToWorker: 0,
      previouslyPaid: 0,
      employmentCost: 0,
    },
  );
}
