import { describe, expect, it } from 'vitest';
import {
  NATIONAL_INSURANCE_PAYMENT_URL,
  createUpcomingPayments,
  daysUntilDate,
  formatDisplayDate,
  nextNationalInsuranceDueDate,
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

describe('nextNationalInsuranceDueDate', () => {
  it('returns 15 October for a date in the middle of Q3', () => {
    expect(nextNationalInsuranceDueDate(new Date('2026-08-20T10:00:00'))).toBe('2026-10-15');
  });

  it('returns the 15th of the current month before the deadline in a due month', () => {
    expect(nextNationalInsuranceDueDate(new Date('2026-04-10T10:00:00'))).toBe('2026-04-15');
  });

  it('returns today when today is a quarterly deadline', () => {
    expect(nextNationalInsuranceDueDate(new Date('2026-07-15T10:00:00'))).toBe('2026-07-15');
  });

  it('skips to the next quarter right after a deadline passes', () => {
    expect(nextNationalInsuranceDueDate(new Date('2026-01-16T10:00:00'))).toBe('2026-04-15');
  });

  it('rolls the year to 15 January after 15 October', () => {
    expect(nextNationalInsuranceDueDate(new Date('2026-10-16T10:00:00'))).toBe('2027-01-15');
    expect(nextNationalInsuranceDueDate(new Date('2026-12-31T10:00:00'))).toBe('2027-01-15');
  });

  it('keeps 15 January when January has just started', () => {
    expect(nextNationalInsuranceDueDate(new Date('2027-01-05T10:00:00'))).toBe('2027-01-15');
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
  it('always returns both obligations with day counts and the official payment link', () => {
    const payments = createUpcomingPayments(new Date('2026-08-20T10:00:00'));
    expect(payments).toEqual([
      { id: 'salary', dueDate: '2026-09-09', daysRemaining: 20 },
      {
        id: 'nationalInsurance',
        dueDate: '2026-10-15',
        daysRemaining: 56,
        externalUrl: NATIONAL_INSURANCE_PAYMENT_URL,
      },
    ]);
  });

  it('reports zero days remaining on the due dates themselves', () => {
    const payments = createUpcomingPayments(new Date('2026-07-09T10:00:00'));
    expect(payments[0]).toMatchObject({ dueDate: '2026-07-09', daysRemaining: 0 });
    expect(payments[1]).toMatchObject({ dueDate: '2026-07-15', daysRemaining: 6 });
  });
});
