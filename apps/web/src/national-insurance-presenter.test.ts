import { describe, expect, it } from 'vitest';
import {
  quarterlyInsuranceOverview,
  quarterlyInsuranceScheduleForPayrollMonth,
  type QuarterlyInsuranceContext,
} from './national-insurance-presenter.js';
import { createUpcomingPayments } from './upcoming-payments.js';
import type { MvpEmploymentExpense } from './storage/mvp-storage.js';

/** Midday Israel time on that calendar day. */
function on(day: string): Date {
  return new Date(`${day}T09:00:00Z`);
}

function paidExpense(overrides: Partial<MvpEmploymentExpense>): MvpEmploymentExpense {
  return {
    id: 'expense',
    category: 'ביטוח לאומי',
    frequency: 'quarterly',
    amount: 720,
    dueDate: '2026-07-15',
    status: 'paid',
    note: '',
    savedAt: '2026-07-10T12:00:00.000Z',
    ...overrides,
  };
}

const employedSinceJanuary: QuarterlyInsuranceContext = { employmentStartDate: '2026-01-15' };

function dashboardInsurance(day: string, context: QuarterlyInsuranceContext = {}) {
  return createUpcomingPayments(on(day), context).find(
    (payment) => payment.id === 'nationalInsurance',
  );
}

/**
 * D. The acceptance case from the 16.10 review. On 17.10.2026 the dashboard
 * said "15.01.2027, in 91 days" while the tasks screen said Q3 was overdue,
 * and on 01.11 the tasks screen would have dropped Q3 as well. Both now read
 * the domain rule, so the same day gives the same answer on both.
 */
describe('Q3 2026 after its 15.10 deadline', () => {
  it.each(['2026-10-17', '2026-11-01', '2026-12-30'])(
    'is overdue on the dashboard and the tasks screen on %s',
    (day) => {
      const { headline } = quarterlyInsuranceOverview(on(day), employedSinceJanuary);
      expect(headline).toMatchObject({
        id: 'national-insurance-2026-q3',
        status: 'overdue',
        statusLabel: 'באיחור',
        deadlineDate: '2026-10-15',
      });

      const dashboard = dashboardInsurance(day, employedSinceJanuary);
      expect(dashboard?.dueDate).toBe('2026-10-15');
      expect(dashboard?.daysRemaining).toBe(headline?.daysUntilDeadline);
      expect(dashboard?.daysRemaining).toBeLessThan(0);
    },
  );

  it('stays listed, overdue, on the Q4 preparation day', () => {
    const { headline, earlier } = quarterlyInsuranceOverview(
      on('2026-12-31'),
      employedSinceJanuary,
    );
    expect(headline).toMatchObject({ id: 'national-insurance-2026-q4', preparationOnly: true });
    expect(earlier.find((quarter) => quarter.id === 'national-insurance-2026-q3')?.status).toBe(
      'overdue',
    );
  });

  it('counts the days late the same way on both screens', () => {
    expect(dashboardInsurance('2026-10-17')?.daysRemaining).toBe(-2);
    expect(quarterlyInsuranceOverview(on('2026-11-01')).headline?.daysUntilDeadline).toBe(-17);
  });

  it('gives way to Q4 only when Q4 opens, and stays listed under it', () => {
    const { headline, earlier } = quarterlyInsuranceOverview(on('2027-01-02'), {
      employmentStartDate: '2026-09-01',
    });
    expect(headline).toMatchObject({ id: 'national-insurance-2026-q4', status: 'open' });
    expect(earlier.map((quarter) => [quarter.id, quarter.status])).toEqual([
      ['national-insurance-2026-q3', 'overdue'],
    ]);
    expect(dashboardInsurance('2027-01-02', { employmentStartDate: '2026-09-01' })).toMatchObject({
      dueDate: '2027-01-15',
      earlierOutstanding: 1,
    });
  });

  it('is late in Israel even when the browser clock is still on the 15th in UTC', () => {
    const { headline } = quarterlyInsuranceOverview(new Date('2026-10-15T21:30:00Z'), {
      employmentStartDate: '2026-09-01',
    });
    expect(headline).toMatchObject({ id: 'national-insurance-2026-q3', status: 'overdue' });
  });

  it('leaves both screens only when it is marked paid', () => {
    const context = {
      ...employedSinceJanuary,
      expenses: [
        paidExpense({ sourcePeriod: '2026-Q1' }),
        paidExpense({ sourcePeriod: '2026-Q2' }),
        paidExpense({ dueDate: '2026-10-15' }),
      ],
    };
    const { headline, earlier } = quarterlyInsuranceOverview(on('2026-10-17'), context);
    expect(headline).toMatchObject({ id: 'national-insurance-2026-q4', status: 'not_open' });
    expect(earlier).toEqual([]);
    expect(dashboardInsurance('2026-10-17', context)).toMatchObject({
      dueDate: '2027-01-15',
      daysRemaining: 90,
      earlierOutstanding: 0,
    });
  });
});

describe('Q2 2026, which vanished from the product on 01.08.2026', () => {
  it.each(['2026-08-01', '2026-10-17', '2026-11-01'])('is still listed on %s', (day) => {
    const { headline, earlier } = quarterlyInsuranceOverview(on(day), employedSinceJanuary);
    const q2 = [...earlier, headline].find(
      (quarter) => quarter?.id === 'national-insurance-2026-q2',
    );
    expect(q2).toMatchObject({ status: 'overdue', deadlineDate: '2026-07-15' });
  });

  it('is counted on the dashboard while Q3 is the headline', () => {
    expect(dashboardInsurance('2026-10-17', employedSinceJanuary)).toMatchObject({
      dueDate: '2026-10-15',
      earlierOutstanding: 2,
    });
  });

  it('is settled by the tracking row the payroll screen creates, once marked paid', () => {
    const { earlier } = quarterlyInsuranceOverview(on('2026-10-17'), {
      ...employedSinceJanuary,
      expenses: [
        paidExpense({
          category: 'ביטוח לאומי',
          source: 'payroll-national-insurance',
          sourcePeriod: '2026-Q2',
        }),
      ],
    });
    expect(earlier.map((quarter) => quarter.id)).toEqual(['national-insurance-2026-q1']);
  });

  it('is settled by a hand-entered payment on its deadline', () => {
    const { earlier } = quarterlyInsuranceOverview(on('2026-10-17'), {
      ...employedSinceJanuary,
      expenses: [paidExpense({ dueDate: '2026-07-15' })],
    });
    expect(earlier.map((quarter) => quarter.id)).toEqual(['national-insurance-2026-q1']);
  });

  it('is not settled by a payment that is still upcoming, or by another kind of expense', () => {
    const { earlier } = quarterlyInsuranceOverview(on('2026-10-17'), {
      ...employedSinceJanuary,
      expenses: [
        paidExpense({ sourcePeriod: '2026-Q2', status: 'upcoming' }),
        paidExpense({ category: 'ביטוח רפואי', frequency: 'annual', dueDate: '2026-07-15' }),
      ],
    });
    expect(earlier.map((quarter) => quarter.id)).toEqual([
      'national-insurance-2026-q1',
      'national-insurance-2026-q2',
    ]);
  });
});

describe('quarters before employment began', () => {
  it('are not National Insurance debts', () => {
    const { earlier } = quarterlyInsuranceOverview(on('2026-10-17'), {
      employmentStartDate: '2026-05-20',
    });
    expect(earlier.map((quarter) => quarter.id)).toEqual(['national-insurance-2026-q2']);
  });

  it('are all listed when no start date is known, up to the domain lookback', () => {
    const { earlier } = quarterlyInsuranceOverview(on('2026-10-17'));
    expect(earlier.map((quarter) => quarter.id)).toEqual([
      'national-insurance-2025-q4',
      'national-insurance-2026-q1',
      'national-insurance-2026-q2',
    ]);
  });
});

describe('labels', () => {
  it('derives the payment period from the saved payroll month, including year rollover', () => {
    expect(quarterlyInsuranceScheduleForPayrollMonth('2026-07')).toMatchObject({
      id: 'national-insurance-2026-q3',
      quarter: 3,
      year: 2026,
      periodRange: 'תקופת דיווח: 1.7–30.9',
      paymentWindow: 'ניתן לשלם בין 1.10 ל־15.10',
      paymentOpenDate: '2026-10-01',
      deadlineDate: '2026-10-15',
    });
    expect(quarterlyInsuranceScheduleForPayrollMonth('2026-12')).toMatchObject({
      quarter: 4,
      year: 2026,
      deadlineLabel: 'מועד אחרון: 15 בינואר',
      paymentOpenDate: '2027-01-01',
      deadlineDate: '2027-01-15',
    });
    expect(quarterlyInsuranceScheduleForPayrollMonth('not-a-month')).toBeNull();
  });

  it('uses the last day of the quarter for preparation only', () => {
    const { headline } = quarterlyInsuranceOverview(on('2026-09-30'), {
      employmentStartDate: '2026-07-01',
    });
    expect(headline).toMatchObject({
      title: 'הכנת נתוני ביטוח לאומי לרבעון יולי – ספטמבר 2026',
      periodRange: 'תקופת דיווח: 1.7–30.9',
      deadlineDate: '2026-10-15',
      preparationOnly: true,
      statusLabel: 'טרם נפתח לתשלום',
    });
  });

  it.each([
    ['2026-09-29', 'טרם נפתח לתשלום'],
    ['2026-10-01', 'פתוח לתשלום'],
    ['2026-10-09', 'פתוח לתשלום'],
    ['2026-10-10', 'דורש טיפול'],
    ['2026-10-14', 'דורש טיפול'],
    ['2026-10-15', 'מועד אחרון היום'],
    ['2026-10-16', 'באיחור'],
  ])('walks the status ladder for Q3 2026 on %s', (day, statusLabel) => {
    const { headline } = quarterlyInsuranceOverview(on(day), {
      employmentStartDate: '2026-07-01',
    });
    expect(headline?.id).toBe('national-insurance-2026-q3');
    expect(headline?.statusLabel).toBe(statusLabel);
  });

  it('describes the third-quarter payment without using 30 September as the payment date', () => {
    const { headline } = quarterlyInsuranceOverview(on('2026-10-01'));
    expect(headline).toMatchObject({
      title: 'תשלום ביטוח לאומי לרבעון יולי – ספטמבר 2026',
      paymentWindow: 'ניתן לשלם בין 1.10 ל־15.10',
      deadlineLabel: 'מועד אחרון: 15 באוקטובר',
    });
    expect(headline?.deadlineDate).not.toBe('2026-09-30');
  });
});
