import { describe, expect, it } from 'vitest';
import {
  NATIONAL_INSURANCE_PAYMENT_URL,
  createUpcomingPayments,
  daysUntilDate,
  formatDisplayDate,
  nextSalaryPaymentDate,
} from './upcoming-payments.js';

describe('nextSalaryPaymentDate', () => {
  it('returns the 9th of the current month before the 9th', () => {
    expect(nextSalaryPaymentDate(new Date('2026-08-02T10:00:00'))).toBe('2026-08-09');
  });

  it('returns today when today is the 9th', () => {
    expect(nextSalaryPaymentDate(new Date('2026-08-09T10:00:00'))).toBe('2026-08-09');
  });

  it('rolls to the 9th of the next month after the 9th', () => {
    expect(nextSalaryPaymentDate(new Date('2026-08-20T10:00:00'))).toBe('2026-09-09');
  });

  it('rolls the year from December to January', () => {
    expect(nextSalaryPaymentDate(new Date('2026-12-15T10:00:00'))).toBe('2027-01-09');
  });
});

describe('daysUntilDate and formatDisplayDate', () => {
  it('counts whole days regardless of the time of day', () => {
    expect(daysUntilDate('2026-10-15', new Date('2026-08-20T23:30:00'))).toBe(56);
    expect(daysUntilDate('2026-08-20', new Date('2026-08-20T01:00:00'))).toBe(0);
  });

  it('formats ISO dates as DD.MM.YYYY', () => {
    expect(formatDisplayDate('2026-10-15')).toBe('15.10.2026');
  });
});

describe('createUpcomingPayments', () => {
  it('returns both obligations with day counts and the official payment link', () => {
    const payments = createUpcomingPayments(new Date('2026-08-20T10:00:00'), {
      employmentStartDate: '2026-07-01',
    });
    expect(payments).toEqual([
      { id: 'salary', dueDate: '2026-09-09', daysRemaining: 20 },
      {
        id: 'nationalInsurance',
        dueDate: '2026-10-15',
        daysRemaining: 56,
        externalUrl: NATIONAL_INSURANCE_PAYMENT_URL,
        earlierOutstanding: 0,
      },
    ]);
  });

  /**
   * D. `nextNationalInsuranceDueDate` returned the next deadline "on or after
   * today", so on 16.10.2026 the dashboard moved to 15.01.2027 and the unpaid
   * Q3 payment was gone. The deadline that passed unpaid is the one reported.
   */
  it('keeps reporting a passed National Insurance deadline that is not marked paid', () => {
    const payments = createUpcomingPayments(new Date('2026-10-16T10:00:00'), {
      employmentStartDate: '2026-07-01',
    });
    expect(payments[1]).toMatchObject({ dueDate: '2026-10-15', daysRemaining: -1 });
  });

  it('reports zero days remaining on the due dates themselves', () => {
    const payments = createUpcomingPayments(new Date('2026-07-09T10:00:00'));
    expect(payments[0]).toMatchObject({ dueDate: '2026-07-09', daysRemaining: 0 });
    expect(payments[1]).toMatchObject({ dueDate: '2026-07-15', daysRemaining: 6 });
  });
});
