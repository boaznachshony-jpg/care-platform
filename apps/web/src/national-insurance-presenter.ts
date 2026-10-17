/* eslint-disable no-restricted-syntax -- the Hebrew labels of the quarterly deadline; localization extraction is tracked */
import {
  israelDateOf,
  outstandingQuarterlyInsurance,
  quarterlyInsuranceScheduleForPayrollMonth as domainScheduleForPayrollMonth,
  type QuarterlyInsuranceItem,
  type QuarterlyInsuranceSchedule,
  type QuarterlyInsuranceStatus,
} from '@caredesk/domain';
import type { MvpEmploymentExpense } from './storage/mvp-storage.js';

/**
 * D. The web's only view of the quarterly National Insurance deadline.
 *
 * The web used to compute this deadline twice, and the two disagreed:
 *
 *   - `upcoming-payments.ts` (`nextNationalInsuranceDueDate`) returned the next
 *     deadline "on or after today", so it could never report one that had
 *     passed. On 16.10.2026 the dashboard moved from 15.10.2026 to 15.01.2027
 *     and the unpaid Q3 payment disappeared from it.
 *   - `quarterly-national-insurance.ts` (`relevantQuarter()`) followed one
 *     quarter and switched to the next on the 1st of the second month, so the
 *     tasks screen said Q3 was overdue on the same day the dashboard said it
 *     was three months away — and on 01.11 it would have dropped Q3 too. Q2
 *     had already vanished that way on 01.08.
 *
 * Both are gone. The rule is `outstandingQuarterlyInsurance` in
 * `@caredesk/domain`: a quarter stays on the list until a payment is recorded
 * for it, never because the calendar moved on. This module adds only what the
 * domain deliberately leaves out — Hebrew labels — and the two facts the web
 * holds: which quarters the family marked as paid, and when employment began.
 */

/**
 * The expense category the payroll screen records National Insurance under,
 * and that opens its calculator there.
 */
export const NATIONAL_INSURANCE_CATEGORY = 'ביטוח לאומי';

/** Short marker for a deadline that has passed, for places with room for one word. */
export const OVERDUE_SHORT_LABEL = 'באיחור';

interface QuarterlyInsuranceLabels {
  /** "יולי – ספטמבר". */
  periodLabel: string;
  periodRange: string;
  paymentWindow: string;
  deadlineLabel: string;
}

type PresentedQuarterlySchedule = QuarterlyInsuranceSchedule & QuarterlyInsuranceLabels;

export interface PresentedQuarterlyInsurance
  extends QuarterlyInsuranceItem, QuarterlyInsuranceLabels {
  title: string;
  statusLabel: string;
  /** The quarter's last day: the data is gathered today, payment opens tomorrow. */
  preparationOnly: boolean;
}

/** What the web knows that the domain rule needs. Both parts are optional. */
export interface QuarterlyInsuranceContext {
  /** Quarterly National Insurance expenses marked "paid" settle their quarter. */
  expenses?: readonly MvpEmploymentExpense[];
  /** `yyyy-mm-dd`. A quarter that ended before employment began was never owed. */
  employmentStartDate?: string;
}

export interface QuarterlyInsuranceOverview {
  /**
   * The quarter to put in front of the family: the most recent one whose
   * payment window has opened (or whose data is gathered today) and that is
   * not marked paid; failing that, the current quarter, still accruing.
   * `null` only when every quarter on the list is already marked paid.
   */
  headline: PresentedQuarterlyInsurance | null;
  /** Older quarters that are still not marked paid, oldest first. Never hidden. */
  earlier: PresentedQuarterlyInsurance[];
}

const QUARTER_MONTHS = [
  ['ינואר', 'מרץ'],
  ['אפריל', 'יוני'],
  ['יולי', 'ספטמבר'],
  ['אוקטובר', 'דצמבר'],
] as const;

const DEADLINE_MONTHS = [
  'בינואר',
  'בפברואר',
  'במרץ',
  'באפריל',
  'במאי',
  'ביוני',
  'ביולי',
  'באוגוסט',
  'בספטמבר',
  'באוקטובר',
  'בנובמבר',
  'בדצמבר',
] as const;

const STATUS_LABELS: Record<QuarterlyInsuranceStatus, string> = {
  not_open: 'טרם נפתח לתשלום',
  open: 'פתוח לתשלום',
  attention: 'דורש טיפול',
  due_today: 'מועד אחרון היום',
  overdue: 'באיחור',
  paid: 'שולם',
};

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** "1.7" from "2026-07-01". */
function dayMonth(isoDay: string): string {
  const [, month, day] = isoDay.split('-').map(Number);
  return `${day}.${month}`;
}

function presentQuarterlySchedule(
  schedule: QuarterlyInsuranceSchedule,
): PresentedQuarterlySchedule {
  const [startMonth, endMonth] = QUARTER_MONTHS[schedule.quarter - 1]!;
  const deadlineMonthIndex = Number(schedule.deadlineDate.slice(5, 7)) - 1;
  return {
    ...schedule,
    periodLabel: `${startMonth} – ${endMonth}`,
    periodRange: `תקופת דיווח: ${dayMonth(schedule.periodStart)}–${dayMonth(schedule.periodEnd)}`,
    paymentWindow: `ניתן לשלם בין ${dayMonth(schedule.paymentOpenDate)} ל־${dayMonth(schedule.deadlineDate)}`,
    deadlineLabel: `מועד אחרון: 15 ${DEADLINE_MONTHS[deadlineMonthIndex]}`,
  };
}

/** The quarter a payroll month belongs to, labelled for the payroll screen. */
export function quarterlyInsuranceScheduleForPayrollMonth(
  payrollMonth: string,
): PresentedQuarterlySchedule | null {
  const schedule = domainScheduleForPayrollMonth(payrollMonth);
  return schedule ? presentQuarterlySchedule(schedule) : null;
}

/**
 * The schedule ids of the quarters the family has marked as paid.
 *
 * A quarter is settled by a quarterly National Insurance expense with status
 * "paid": either the tracking row the payroll screen creates (its
 * `sourcePeriod` is "2026-Q3"), or one entered by hand, recognised by its due
 * date being a quarterly deadline (15.10.2026 settles Q3 2026).
 */
function paidQuarterlyInsuranceIds(expenses: readonly MvpEmploymentExpense[] = []): string[] {
  const ids = new Set<string>();
  for (const expense of expenses) {
    if (expense.status !== 'paid' || expense.frequency !== 'quarterly') continue;
    if (
      expense.category !== NATIONAL_INSURANCE_CATEGORY &&
      expense.source !== 'payroll-national-insurance'
    ) {
      continue;
    }
    const period = /^(\d{4})-Q([1-4])$/.exec(expense.sourcePeriod ?? '');
    if (period) {
      ids.add(`national-insurance-${period[1]}-q${period[2]}`);
      continue;
    }
    const deadline = /^(\d{4})-(01|04|07|10)-15$/.exec(expense.dueDate);
    if (deadline) {
      const year = Number(deadline[1]);
      const month = Number(deadline[2]);
      ids.add(
        month === 1
          ? `national-insurance-${year - 1}-q4`
          : `national-insurance-${year}-q${(month - 1) / 3}`,
      );
    }
  }
  return [...ids];
}

function presentItem(item: QuarterlyInsuranceItem, today: string): PresentedQuarterlyInsurance {
  const labels = presentQuarterlySchedule(item);
  const preparationOnly = item.status === 'not_open' && today === item.periodEnd;
  return {
    ...item,
    ...labels,
    title: preparationOnly
      ? `הכנת נתוני ביטוח לאומי לרבעון ${labels.periodLabel} ${item.year}`
      : `תשלום ביטוח לאומי לרבעון ${labels.periodLabel} ${item.year}`,
    statusLabel: STATUS_LABELS[item.status],
    preparationOnly,
  };
}

/**
 * Every quarter the family has something to do about, oldest first, from the
 * domain rule. `today` is a browser instant; it enters the rule only as an
 * Israeli calendar day, so a browser in another time zone sees the same list.
 */
function quarterlyInsuranceItems(
  today: Date = new Date(),
  context: QuarterlyInsuranceContext = {},
): PresentedQuarterlyInsurance[] {
  const israelToday = israelDateOf(today);
  const start = ISO_DAY.test(context.employmentStartDate ?? '')
    ? context.employmentStartDate!
    : null;
  return outstandingQuarterlyInsurance({
    today: israelToday,
    paidScheduleIds: paidQuarterlyInsuranceIds(context.expenses),
  })
    .filter((item) => start === null || item.periodEnd >= start)
    .map((item) => presentItem(item, israelToday));
}

export function quarterlyInsuranceOverview(
  today: Date = new Date(),
  context: QuarterlyInsuranceContext = {},
): QuarterlyInsuranceOverview {
  const items = quarterlyInsuranceItems(today, context);
  let headlineIndex = -1;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]!;
    if (item.status !== 'not_open' || item.preparationOnly) {
      headlineIndex = index;
      break;
    }
  }
  if (headlineIndex === -1) headlineIndex = items.length - 1;
  return {
    headline: items[headlineIndex] ?? null,
    earlier: headlineIndex > 0 ? items.slice(0, headlineIndex) : [],
  };
}

/** "באיחור של 2 ימים". */
export function overdueDaysLabel(daysUntilDeadline: number): string {
  return `באיחור של ${Math.abs(daysUntilDeadline)} ימים`;
}

/** "2 רבעונים קודמים שלא סומנו כשולמו". */
export function earlierQuartersLabel(count: number): string {
  return count === 1 ? 'רבעון קודם אחד שלא סומן כשולם' : `${count} רבעונים קודמים שלא סומנו כשולמו`;
}

/** The line that keeps older unpaid quarters visible wherever only one quarter fits. */
export function earlierQuartersNote(count: number): string {
  return `ועוד ${earlierQuartersLabel(count)} — הפירוט במסך המשימות`;
}
