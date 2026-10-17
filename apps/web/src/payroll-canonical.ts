import {
  addAgorot,
  agorotFromShekels,
  calculateMonthlyPayroll,
  assertPayrollMoneyPrecision,
  shekelsOf,
  subtractAgorot,
} from '@caredesk/domain';
import type {
  CanonicalPayrollClose,
  PayrollEntryResponse,
  SavePayrollEntryRequest,
} from './api/client.js';
import { newIdempotencyKey } from './api/idempotency.js';
import { payrollEntryRequest } from './api/strict-bodies.js';
import type { MvpPayrollRecord } from './storage/mvp-storage.js';

/** A projection for existing reports, never a compatibility-store write. */
export interface PayrollReportRecord extends MvpPayrollRecord {
  canonicalEntry?: PayrollEntryResponse;
  canonicalDeductions?: number;
}

export function canonicalPayrollEmploymentCost(entry: PayrollEntryResponse): number {
  return shekelsOf(
    addAgorot(
      agorotFromShekels(entry.total),
      agorotFromShekels(entry.advances ?? 0),
      agorotFromShekels(entry.pocketMoney ?? 0),
    ),
  );
}

export function canonicalPayrollCloseCost(
  close: CanonicalPayrollClose,
  entries: PayrollEntryResponse[],
): number | null {
  if (close.settlementBasis !== 'worker') return close.total;
  const entry = entries.find(
    (row) => row.id === close.payrollReference && row.month === close.month,
  );
  if (!entry || close.calculationTotal == null) return null;
  return shekelsOf(
    addAgorot(
      agorotFromShekels(close.calculationTotal),
      agorotFromShekels(entry.advances),
      agorotFromShekels(entry.pocketMoney),
    ),
  );
}

export function canonicalDeductionBreakdown(entry: PayrollEntryResponse) {
  const items = entry.calculationContext?.deductionItems ?? [];
  const sum = (category: 'medical' | 'housing') =>
    shekelsOf(
      items
        .filter((item) => item.category === category)
        .reduce(
          (total, item) => addAgorot(total, agorotFromShekels(item.amount)),
          agorotFromShekels(0),
        ),
    );
  const medical = sum('medical');
  const housing = sum('housing');
  const allocated = shekelsOf(addAgorot(agorotFromShekels(medical), agorotFromShekels(housing)));
  // Historical contexts are not assumed to reconcile with today's itemization.
  return allocated <= entry.deductions
    ? {
        medical,
        housing,
        unallocated: shekelsOf(
          subtractAgorot(agorotFromShekels(entry.deductions), agorotFromShekels(allocated)),
        ),
      }
    : { medical: 0, housing: 0, unallocated: entry.deductions };
}

export function canonicalPayrollReportRecord(entry: PayrollEntryResponse): PayrollReportRecord {
  const deduction = canonicalDeductionBreakdown(entry);
  return {
    id: entry.id,
    month: entry.month,
    baseSalary: entry.baseSalary,
    workDays: entry.workDays,
    paidSaturdays: entry.paidRestDays,
    saturdayRate: entry.restDayRate,
    saturdayPay: calculateMonthlyPayroll(entry).restDayPay,
    paidHolidays: entry.paidHolidays,
    holidayPay: entry.holidayPay,
    vacationDays: entry.vacationDays,
    vacationPay: entry.vacationPay,
    sickDays: entry.sickDays,
    sickPay: entry.sickPay,
    absenceDays: entry.otherAbsenceDays,
    employerContributions: entry.employerContributions,
    otherAddition: 0,
    additionalPayments: entry.additionalPayments.map((payment, index) => ({
      ...payment,
      id: `${entry.id}:${index}`,
    })),
    pocketMoney: entry.pocketMoney,
    // An aggregate cannot truthfully be labelled medical insurance or housing.
    medicalInsuranceDeduction: deduction.medical,
    housingDeduction: deduction.housing,
    canonicalDeductions: entry.deductions,
    advances: entry.advances,
    agreedDeduction: entry.agreedDeductions,
    total: entry.total,
    canonicalVersion: entry.version,
    savedAt: entry.updatedAt,
    canonicalEntry: entry,
  };
}

export function mergePayrollReportSources(
  legacy: MvpPayrollRecord[],
  canonical: PayrollEntryResponse[],
): PayrollReportRecord[] {
  const byMonth = new Map<string, PayrollReportRecord>();
  for (const record of [...legacy].sort((a, b) => a.savedAt.localeCompare(b.savedAt))) {
    byMonth.set(record.month, record);
  }
  for (const entry of [...canonical].sort((a, b) => a.version - b.version)) {
    byMonth.set(entry.month, canonicalPayrollReportRecord(entry));
  }
  return [...byMonth.values()].sort((a, b) => b.month.localeCompare(a.month));
}

export function legacyPayrollEntryRequest(record: MvpPayrollRecord): SavePayrollEntryRequest {
  const count = record.paidSaturdays;
  const rate = record.saturdayRate ?? (count > 0 ? record.saturdayPay / count : 0);
  const input: SavePayrollEntryRequest = {
    baseSalary: record.baseSalary,
    workDays: record.workDays,
    paidRestDays: count,
    restDayRate: rate,
    paidHolidays: record.paidHolidays ?? 0,
    holidayPay: record.holidayPay ?? 0,
    vacationDays: record.vacationDays ?? 0,
    vacationPay: record.vacationPay ?? 0,
    sickDays: record.sickDays ?? 0,
    sickPay: record.sickPay ?? 0,
    otherAbsenceDays: record.absenceDays ?? 0,
    employerContributions: record.employerContributions ?? 0,
    additionalPayments: [
      ...(record.otherAddition
        ? // eslint-disable-next-line no-restricted-syntax -- existing legacy migration description is preserved verbatim
          [{ description: 'תוספת אחרת מרישום MVP', amount: record.otherAddition }]
        : []),
      ...(record.additionalPayments ?? []).map(({ description, amount }) => ({
        description,
        amount,
      })),
    ],
    pocketMoney: record.pocketMoney,
    deductions:
      'canonicalDeductions' in record
        ? (record.canonicalDeductions as number)
        : shekelsOf(
            addAgorot(
              agorotFromShekels(record.medicalInsuranceDeduction ?? 0),
              agorotFromShekels(record.housingDeduction ?? 0),
            ),
          ),
    advances: record.advances,
    agreedDeductions: record.agreedDeduction,
    total: record.total,
    status: 'final',
  };
  assertPayrollMoneyPrecision(record);
  assertPayrollMoneyPrecision(input);
  if (calculateMonthlyPayroll(input).total !== record.total) throw new Error('PAYROLL_MISMATCH');
  return input;
}

export function canonicalWizardRequest(
  record: MvpPayrollRecord,
  original: PayrollEntryResponse,
): SavePayrollEntryRequest {
  const deduction = canonicalDeductionBreakdown(original);
  const deductions = shekelsOf(
    addAgorot(
      agorotFromShekels(deduction.unallocated),
      agorotFromShekels(record.medicalInsuranceDeduction ?? 0),
      agorotFromShekels(record.housingDeduction ?? 0),
    ),
  );
  const request = legacyPayrollEntryRequest({
    ...record,
    canonicalDeductions: deductions,
  } as PayrollReportRecord);
  const context = original.calculationContext;
  // A legacy numeric form cannot rewrite dated legal facts invisibly.
  const controlled: Array<keyof SavePayrollEntryRequest> = [
    ...(context?.salaryPeriods ? ['baseSalary' as const] : []),
    ...(context?.dayFacts
      ? (['paidRestDays', 'restDayRate', 'holidayPay', 'vacationPay', 'sickPay'] as const)
      : []),
    ...(context?.deductionItems ? (['deductions', 'agreedDeductions'] as const) : []),
    ...(context?.paymentEvents ? (['advances', 'pocketMoney'] as const) : []),
  ];
  if (controlled.some((field) => request[field] !== original[field]))
    throw new Error('PAYROLL_CONTEXT_CONFLICT');
  return {
    ...request,
    version: original.version,
    status: original.status,
    ...(context === undefined ? {} : { calculationContext: context }),
  };
}

/** The existing explicit close action is the only legacy-to-canonical write here. */
export async function finalPayrollForClose(
  caseId: string,
  record: PayrollReportRecord,
): Promise<PayrollEntryResponse> {
  const { listPayrollEntries, savePayrollEntry } = await import('./api/client.js');
  const entries = await listPayrollEntries(caseId);
  const existing = entries.find((entry) => entry.month === record.month);
  if (existing) {
    if (record.canonicalEntry) {
      if (existing.id !== record.id || existing.version !== record.canonicalEntry.version) {
        throw new Error('PAYROLL_VERSION_CONFLICT');
      }
    } else {
      const legacy = legacyPayrollEntryRequest(record);
      const current = payrollEntryRequest(existing);
      for (const key of Object.keys(legacy) as Array<keyof SavePayrollEntryRequest>) {
        if (key !== 'status' && JSON.stringify(legacy[key]) !== JSON.stringify(current[key])) {
          throw new Error('PAYROLL_MISMATCH');
        }
      }
    }
    if (existing.status === 'final') return existing;
    const response = await savePayrollEntry(
      caseId,
      record.month,
      { ...payrollEntryRequest(existing), status: 'final', version: existing.version },
      newIdempotencyKey(),
    );
    return response.entry;
  }
  if (record.canonicalEntry) throw new Error('PAYROLL_VERSION_CONFLICT');
  return (
    await savePayrollEntry(
      caseId,
      record.month,
      legacyPayrollEntryRequest(record),
      newIdempotencyKey(),
    )
  ).entry;
}
