import { describe, expect, it } from 'vitest';
import { israelDate, israelDateOf } from './date.js';
import {
  outstandingQuarterlyInsurance,
  quarterlyInsuranceSchedule,
  quarterlyInsuranceScheduleForPayrollMonth,
} from './national-insurance.js';

describe('quarterlyInsuranceSchedule', () => {
  it('opens on the 1st and falls due on the 15th of the month after the quarter', () => {
    const q1 = quarterlyInsuranceSchedule(2026, 1);
    expect(q1.periodStart).toBe('2026-01-01');
    expect(q1.periodEnd).toBe('2026-03-31');
    expect(q1.paymentOpenDate).toBe('2026-04-01');
    expect(q1.deadlineDate).toBe('2026-04-15');
  });

  it('rolls Q4 into the following January', () => {
    const q4 = quarterlyInsuranceSchedule(2025, 4);
    expect(q4.periodEnd).toBe('2025-12-31');
    expect(q4.deadlineDate).toBe('2026-01-15');
  });

  it('maps a payroll month onto its quarter', () => {
    expect(quarterlyInsuranceScheduleForPayrollMonth('2026-05')?.quarter).toBe(2);
    expect(quarterlyInsuranceScheduleForPayrollMonth('nonsense')).toBeNull();
  });
});

/**
 * DOM-03(b). The one unpaid quarter used to be the one the product stopped
 * showing: `relevantQuarter()` switched to the current quarter on the 1st of
 * the second month, so a missed Q4 deadline vanished from the screen on
 * 1 February.
 */
describe('outstandingQuarterlyInsurance', () => {
  it('keeps an overdue quarter visible after the calendar has moved on', () => {
    const items = outstandingQuarterlyInsurance({ today: israelDate('2026-02-01') });
    const q4 = items.find((item) => item.id === 'national-insurance-2025-q4');
    expect(q4).toBeDefined();
    expect(q4?.status).toBe('overdue');
    expect(q4?.daysUntilDeadline).toBe(-17);
  });

  it('stops reporting a quarter once a payment is recorded — and only then', () => {
    const items = outstandingQuarterlyInsurance({
      today: israelDate('2026-02-01'),
      paidScheduleIds: ['national-insurance-2025-q4'],
    });
    expect(items.some((item) => item.id === 'national-insurance-2025-q4')).toBe(false);
  });

  it('reports the current quarter as not yet open for payment', () => {
    const items = outstandingQuarterlyInsurance({ today: israelDate('2026-02-01') });
    const q1 = items.find((item) => item.id === 'national-insurance-2026-q1');
    expect(q1?.status).toBe('not_open');
  });

  it('walks the status ladder to the deadline', () => {
    const statusOn = (day: string): string | undefined =>
      outstandingQuarterlyInsurance({ today: israelDate(day) }).find(
        (item) => item.id === 'national-insurance-2026-q1',
      )?.status;
    expect(statusOn('2026-04-01')).toBe('open');
    expect(statusOn('2026-04-09')).toBe('open');
    expect(statusOn('2026-04-14')).toBe('attention');
    expect(statusOn('2026-04-15')).toBe('due_today');
    expect(statusOn('2026-04-16')).toBe('overdue');
  });

  /**
   * DOM-03(a). At 00:30 Israel time on 16 April the old code computed
   * `2026-04-15` on a UTC host and reported a legally late payment as due
   * today. The clock now enters only through `israelDateOf`.
   */
  it('is late in Israel even when it is still yesterday in UTC', () => {
    const instant = '2026-04-15T21:30:00Z'; // 00:30 on the 16th, Israel time.
    const items = outstandingQuarterlyInsurance({ today: israelDateOf(instant) });
    expect(items.find((item) => item.id === 'national-insurance-2026-q1')?.status).toBe('overdue');
  });
});
