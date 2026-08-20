/**
 * Pure date logic for the two recurring payment obligations of a household
 * employer in Israel:
 *
 * 1. Salary — by law must be paid no later than the 9th of the month that
 *    follows the worked month.
 * 2. National Insurance (Bituach Leumi) — household employers report and pay
 *    quarterly, by the 15th of April, July, October and January (each covering
 *    the preceding quarter).
 *
 * All functions are pure so the surfaces that render these obligations
 * (dashboard, timeline, open issues, notifications) stay deterministic and
 * testable.
 */

/** Official Bituach Leumi report-and-pay service for household employers. */
export const NATIONAL_INSURANCE_PAYMENT_URL =
  'https://b2b.btl.gov.il/BTL.ILG.Payments/MeshekBaitInfoShort.aspx';

const SALARY_DUE_DAY = 9;
const NATIONAL_INSURANCE_DUE_DAY = 15;
/** Zero-based months in which a quarterly payment is due: Jan, Apr, Jul, Oct. */
const NATIONAL_INSURANCE_DUE_MONTHS = [0, 3, 6, 9] as const;

export type UpcomingPaymentId = 'salary' | 'nationalInsurance';

export interface UpcomingPayment {
  id: UpcomingPaymentId;
  /** ISO date (yyyy-mm-dd) of the next due date, computed from `today`. */
  dueDate: string;
  /** Whole days from `today` until the due date; 0 means due today. */
  daysRemaining: number;
  /** External payment service, present only for National Insurance. */
  externalUrl?: string;
}

function isoDate(year: number, monthIndex: number, day: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Next date (on or after today) by which salary must be paid. */
export function nextSalaryPaymentDate(today = new Date()): string {
  if (today.getDate() <= SALARY_DUE_DAY) {
    return isoDate(today.getFullYear(), today.getMonth(), SALARY_DUE_DAY);
  }
  const next = new Date(today.getFullYear(), today.getMonth() + 1, SALARY_DUE_DAY);
  return isoDate(next.getFullYear(), next.getMonth(), SALARY_DUE_DAY);
}

/** Next quarterly National Insurance deadline (15 Jan / Apr / Jul / Oct) on or after today. */
export function nextNationalInsuranceDueDate(today = new Date()): string {
  const month = today.getMonth();
  for (const dueMonth of NATIONAL_INSURANCE_DUE_MONTHS) {
    if (month < dueMonth || (month === dueMonth && today.getDate() <= NATIONAL_INSURANCE_DUE_DAY)) {
      return isoDate(today.getFullYear(), dueMonth, NATIONAL_INSURANCE_DUE_DAY);
    }
  }
  // Past 15 October — the next deadline is 15 January of the following year.
  return isoDate(today.getFullYear() + 1, 0, NATIONAL_INSURANCE_DUE_DAY);
}

/** Whole days between today (date-only) and an ISO due date. */
export function daysUntilDate(dueIsoDate: string, today = new Date()): number {
  const due = new Date(`${dueIsoDate}T12:00:00`);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12);
  return Math.ceil((due.getTime() - start.getTime()) / 86_400_000);
}

/** Formats an ISO date (yyyy-mm-dd) as DD.MM.YYYY for display. */
export function formatDisplayDate(dueIsoDate: string): string {
  const [year, month, day] = dueIsoDate.split('-');
  return `${day}.${month}.${year}`;
}

/** The two always-present upcoming payment obligations, computed from today. */
export function createUpcomingPayments(today = new Date()): UpcomingPayment[] {
  const salaryDueDate = nextSalaryPaymentDate(today);
  const insuranceDueDate = nextNationalInsuranceDueDate(today);
  return [
    {
      id: 'salary',
      dueDate: salaryDueDate,
      daysRemaining: daysUntilDate(salaryDueDate, today),
    },
    {
      id: 'nationalInsurance',
      dueDate: insuranceDueDate,
      daysRemaining: daysUntilDate(insuranceDueDate, today),
      externalUrl: NATIONAL_INSURANCE_PAYMENT_URL,
    },
  ];
}
