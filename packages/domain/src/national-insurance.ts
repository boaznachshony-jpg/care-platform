/**
 * Root 8 — the quarterly national-insurance deadline, computed in the business
 * time zone and never silently dropped.
 *
 * DOM-03. The only encoded legal deadline in the product had two defects, both
 * of them about time rather than about the rule:
 *
 *   (a) `createQuarterlyInsuranceTask(today = new Date())` defaulted to the
 *       wall clock and `localIso()` read `getFullYear/getMonth/getDate` — the
 *       HOST's local zone. On a UTC server at 00:30 Israel time on 16 April the
 *       computed "today" is still 2026-04-15, so a payment that is now legally
 *       late is reported as due today. A browser at UTC-5 makes the opposite
 *       error. Israel is UTC+2/+3, so this was a two-to-three hour window of a
 *       wrong legal status every single day, on a deadline that carries
 *       interest and penalties.
 *
 *   (b) `relevantQuarter()` returned the previous quarter only during the first
 *       month of a quarter (`month % 3 === 0`). A family that missed the Q4
 *       deadline on 15 January saw `overdue` for the rest of January — and then
 *       on 1 February the item DISAPPEARED, because the function switched to
 *       Q1, whose payment window has not opened. The one unpaid quarter is the
 *       one the product stopped showing.
 *
 * This module is the pure, deterministic core: no clock, no locale, no labels.
 * The caller passes an Israeli calendar day (`israelDateOf(clock.now())`) and
 * the set of quarters it already has a recorded payment for, and gets back
 * every quarter that is open, due or outstanding — including the ones from
 * previous years, which is the whole point of (b).
 *
 * Display strings belong to the presentation layer and deliberately do not
 * exist here.
 */

import { compareIsraelDates, daysInMonth, israelDate, type IsraelDate } from './date.js';

export type Quarter = 1 | 2 | 3 | 4;

export type QuarterlyInsuranceStatus =
  'not_open' | 'open' | 'attention' | 'due_today' | 'overdue' | 'paid';

export interface QuarterlyInsuranceSchedule {
  id: string;
  year: number;
  quarter: Quarter;
  periodStart: IsraelDate;
  periodEnd: IsraelDate;
  /** Payment opens on the 1st of the month following the quarter. */
  paymentOpenDate: IsraelDate;
  /** The statutory last day to pay: the 15th of that month. */
  deadlineDate: IsraelDate;
}

export interface QuarterlyInsuranceItem extends QuarterlyInsuranceSchedule {
  status: QuarterlyInsuranceStatus;
  /** Negative once the deadline has passed. Counted on calendar days, not hours. */
  daysUntilDeadline: number;
}

function isoDay(year: number, monthIndex: number, day: number): IsraelDate {
  return israelDate(
    `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  );
}

export function quarterlyInsuranceSchedule(
  year: number,
  quarter: Quarter,
): QuarterlyInsuranceSchedule {
  const startMonth = (quarter - 1) * 3;
  const endMonth = startMonth + 2;
  const paymentMonth = (endMonth + 1) % 12;
  const paymentYear = endMonth === 11 ? year + 1 : year;
  return {
    id: `national-insurance-${year}-q${quarter}`,
    year,
    quarter,
    periodStart: isoDay(year, startMonth, 1),
    periodEnd: isoDay(year, endMonth, daysInMonth(year, endMonth + 1)),
    paymentOpenDate: isoDay(paymentYear, paymentMonth, 1),
    deadlineDate: isoDay(paymentYear, paymentMonth, 15),
  };
}

/** The quarter a payroll month belongs to. Unchanged behaviour, typed dates. */
export function quarterlyInsuranceScheduleForPayrollMonth(
  payrollMonth: string,
): QuarterlyInsuranceSchedule | null {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(payrollMonth);
  if (!match) return null;
  const monthIndex = Number(match[2]) - 1;
  return quarterlyInsuranceSchedule(Number(match[1]), (Math.floor(monthIndex / 3) + 1) as Quarter);
}

function daysBetween(from: IsraelDate, to: IsraelDate): number {
  const day = (value: IsraelDate): number => {
    const [year, month, date] = value.split('-').map(Number);
    return Date.UTC(year!, month! - 1, date!) / 86_400_000;
  };
  return day(to) - day(from);
}

function statusFor(
  schedule: QuarterlyInsuranceSchedule,
  today: IsraelDate,
): QuarterlyInsuranceStatus {
  if (compareIsraelDates(today, schedule.paymentOpenDate) < 0) return 'not_open';
  const remaining = daysBetween(today, schedule.deadlineDate);
  if (remaining > 5) return 'open';
  if (remaining > 0) return 'attention';
  if (remaining === 0) return 'due_today';
  return 'overdue';
}

export interface QuarterlyInsuranceInput {
  /** The Israeli calendar day, from `israelDateOf(clock.now())`. Never `new Date()`. */
  today: IsraelDate;
  /** Schedule ids already settled, so a paid quarter stops being reported. */
  paidScheduleIds?: readonly string[];
  /**
   * How far back to look for unsettled quarters. Four quarters covers a full
   * year of neglect, which is well past the point the product should be
   * shouting; it is a bound on the list, not on the obligation.
   */
  lookbackQuarters?: number;
}

/**
 * Every quarter the employer currently has something to do about, oldest
 * first.
 *
 * DOM-03(b): an overdue quarter stays in this list until it is recorded as
 * paid. It cannot vanish because the calendar moved on, because the calendar is
 * not what removes it — a recorded payment is.
 */
export function outstandingQuarterlyInsurance(
  input: QuarterlyInsuranceInput,
): QuarterlyInsuranceItem[] {
  const paid = new Set(input.paidScheduleIds ?? []);
  const lookback = input.lookbackQuarters ?? 4;
  const [year, month] = input.today.split('-').map(Number);
  const currentQuarterIndex = Math.floor((month! - 1) / 3);
  const items: QuarterlyInsuranceItem[] = [];
  // Walk back from the current quarter. The current quarter itself is included
  // so a family sees the upcoming obligation, and it correctly reports
  // `not_open` until its payment window starts.
  for (let back = lookback; back >= 0; back -= 1) {
    const absolute = year! * 4 + currentQuarterIndex - back;
    const schedule = quarterlyInsuranceSchedule(
      Math.floor(absolute / 4),
      ((absolute % 4) + 1) as Quarter,
    );
    if (paid.has(schedule.id)) continue;
    const status = statusFor(schedule, input.today);
    // A future quarter whose window has not opened is noise for every quarter
    // except the current one, which the family is actively accruing.
    if (status === 'not_open' && back !== 0) continue;
    items.push({
      ...schedule,
      status,
      daysUntilDeadline: daysBetween(input.today, schedule.deadlineDate),
    });
  }
  return items;
}
