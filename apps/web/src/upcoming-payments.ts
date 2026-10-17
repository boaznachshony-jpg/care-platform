/**
 * Pure date logic for the two recurring payment obligations of a household
 * employer in Israel:
 *
 * 1. Salary — by law must be paid no later than the 9th of the month that
 *    follows the worked month.
 * 2. National Insurance (Bituach Leumi) — household employers report and pay
 *    quarterly, by the 15th of April, July, October and January (each covering
 *    the preceding quarter). That deadline is not computed here: it comes from
 *    `national-insurance-presenter.ts`, which is the domain rule plus labels.
 *    A passed deadline that is not marked paid stays the reported one, with a
 *    negative `daysRemaining` (D).
 *
 * All functions are pure so the surfaces that render these obligations
 * (dashboard, timeline, open issues, notifications) stay deterministic and
 * testable.
 */
import { daysUntil } from './date-diff.js';
import {
  quarterlyInsuranceOverview,
  type QuarterlyInsuranceContext,
} from './national-insurance-presenter.js';

/** Official Bituach Leumi report-and-pay service for household employers. */
export const NATIONAL_INSURANCE_PAYMENT_URL =
  'https://b2b.btl.gov.il/BTL.ILG.Payments/MeshekBaitInfoShort.aspx';

const SALARY_DUE_DAY = 9;

export type UpcomingPaymentId = 'salary' | 'nationalInsurance';

export interface UpcomingPayment {
  id: UpcomingPaymentId;
  /** ISO date (yyyy-mm-dd) of the due date, computed from `today`. */
  dueDate: string;
  /**
   * Whole days from `today` until the due date; 0 means due today. Negative
   * for a National Insurance deadline that has passed and is not marked paid.
   */
  daysRemaining: number;
  /** External payment service, present only for National Insurance. */
  externalUrl?: string;
  /** National Insurance only: older quarters still not marked paid. */
  earlierOutstanding?: number;
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

/**
 * Whole calendar days between today and an ISO due date.
 * Delegates to the shared date-diff module (see date-diff.ts for why naive
 * `Date` subtraction across the local/UTC boundary is wrong) - `dueIsoDate`
 * here is always a well-formed `yyyy-mm-dd` produced by this module, so the
 * `null` case of the shared function never applies.
 */
export function daysUntilDate(dueIsoDate: string, today = new Date()): number {
  return daysUntil(dueIsoDate, today) ?? 0;
}

/** Formats an ISO date (yyyy-mm-dd) as DD.MM.YYYY for display. */
export function formatDisplayDate(dueIsoDate: string): string {
  const [year, month, day] = dueIsoDate.split('-');
  return `${day}.${month}.${year}`;
}

/**
 * The two recurring payment obligations, computed from today. National
 * Insurance is left out only when every quarter on the list is marked paid.
 */
export function createUpcomingPayments(
  today = new Date(),
  nationalInsurance: QuarterlyInsuranceContext = {},
): UpcomingPayment[] {
  const salaryDueDate = nextSalaryPaymentDate(today);
  const payments: UpcomingPayment[] = [
    {
      id: 'salary',
      dueDate: salaryDueDate,
      daysRemaining: daysUntilDate(salaryDueDate, today),
    },
  ];
  const { headline, earlier } = quarterlyInsuranceOverview(today, nationalInsurance);
  if (headline) {
    payments.push({
      id: 'nationalInsurance',
      dueDate: headline.deadlineDate,
      daysRemaining: headline.daysUntilDeadline,
      externalUrl: NATIONAL_INSURANCE_PAYMENT_URL,
      earlierOutstanding: earlier.length,
    });
  }
  return payments;
}
