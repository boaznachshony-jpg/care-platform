/**
 * Root 8 — partial-month proration, with the rest day named instead of assumed.
 *
 * DOM-20. The browser prorated a partial month with
 * `fullSalary * paidDays / daysInMonth`, where both terms counted days with
 * `getDay() !== 6` — Saturday, hardcoded, with no reference to the rule it
 * implements and no effective date.
 *
 * Israeli law lets a non-Jewish employee choose their weekly rest day. This
 * product's entire user base employs foreign caregivers; a Christian
 * caregiver's rest day is typically Sunday and a Muslim's Friday, so Saturday
 * is the wrong default more often than it is right. The divisor moves with the
 * choice — a mid-month start in a 31-day month divides by 26 or 27 depending on
 * which weekday is excluded — which moves the prorated salary by tens of
 * shekels for a value nobody chose.
 *
 * Two things change here. The rest day becomes an explicit input (it belongs on
 * the employment case; migration 0045 adds the column). And the convention
 * itself is written down: excluding rest days from BOTH the numerator and the
 * denominator, which is one of several conventions used in Israeli practice and
 * the one this product has in fact been applying since it was written. Naming
 * it is not the same as ratifying it — DOM-20's reviewer left the legal
 * question to the legal reviewer, and it is still open. What is closed is that
 * the choice is now visible, per-case, and testable rather than a loop
 * condition in a browser file.
 */

import { agorot, scaleAgorot, type Agorot } from './money.js';
import { daysInMonth, israelDate, type IsraelDate } from './date.js';

/**
 * The weekly rest day, as `Date.getUTCDay()` numbers it: 0 = Sunday …
 * 6 = Saturday. Named rather than numeric at the call site so a transposed
 * digit cannot silently reprice a month.
 */
export const WEEKLY_REST_DAYS = {
  sunday: 0,
  friday: 5,
  saturday: 6,
} as const;

export type WeeklyRestDay = (typeof WEEKLY_REST_DAYS)[keyof typeof WEEKLY_REST_DAYS];

export function isWeeklyRestDay(value: number): value is WeeklyRestDay {
  return value === 0 || value === 5 || value === 6;
}

/**
 * The proration convention in force. Stated as a value so that a future change
 * is a new member with an effective date rather than an edit to a formula, and
 * so that a stored payroll row can record which convention produced it.
 */
export const PRORATION_CONVENTION = 'exclude_rest_days_from_both_terms' as const;
export type ProrationConvention = typeof PRORATION_CONVENTION;

export interface ProrationInput {
  /** The full monthly salary, in agorot. */
  fullSalary: Agorot;
  /** First paid day, inclusive. */
  from: IsraelDate;
  /** Last paid day, inclusive. */
  to: IsraelDate;
  /** The employee's chosen weekly rest day. There is no default on purpose. */
  restDay: WeeklyRestDay;
}

export interface ProrationResult {
  amount: Agorot;
  /** Paid days in the range, rest days excluded. The numerator. */
  paidDays: number;
  /** Working days in the whole calendar month, rest days excluded. The divisor. */
  monthDays: number;
  convention: ProrationConvention;
}

function weekday(date: IsraelDate): number {
  const [year, month, day] = date.split('-').map(Number);
  // Calendar arithmetic only — the weekday of a calendar day is the same in
  // every time zone, so UTC is used purely as an arithmetic frame here.
  return new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay();
}

function countWorkingDays(
  year: number,
  month: number,
  fromDay: number,
  toDay: number,
  restDay: number,
): number {
  let days = 0;
  for (let day = fromDay; day <= toDay; day += 1) {
    if (new Date(Date.UTC(year, month - 1, day)).getUTCDay() !== restDay) days += 1;
  }
  return days;
}

/**
 * Prorate a monthly salary over a partial month.
 *
 * Both endpoints must fall inside the same calendar month: a range that spans a
 * month boundary is two payroll months, and collapsing them into one divisor is
 * how a proration silently invents a rate that belongs to neither.
 */
export function prorateMonthlySalary(input: ProrationInput): ProrationResult {
  const from = israelDate(input.from);
  const to = israelDate(input.to);
  if (from.slice(0, 7) !== to.slice(0, 7)) {
    throw new RangeError('Proration range must fall inside one calendar month.');
  }
  if (from > to) throw new RangeError('Proration range ends before it starts.');
  const year = Number(from.slice(0, 4));
  const month = Number(from.slice(5, 7));
  const paidDays = countWorkingDays(
    year,
    month,
    Number(from.slice(8, 10)),
    Number(to.slice(8, 10)),
    input.restDay,
  );
  const monthDays = countWorkingDays(year, month, 1, daysInMonth(year, month), input.restDay);
  return {
    amount: monthDays === 0 ? agorot(0) : scaleAgorot(input.fullSalary, paidDays / monthDays),
    paidDays,
    monthDays,
    convention: PRORATION_CONVENTION,
  };
}

/** Exported for callers that need only the weekday, e.g. to label a calendar. */
export function isRestDay(date: IsraelDate, restDay: WeeklyRestDay): boolean {
  return weekday(date) === restDay;
}
