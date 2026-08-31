import { describe, expect, it } from 'vitest';
import { israelDate } from './date.js';
import { agorot } from './money.js';
import { prorateMonthlySalary, WEEKLY_REST_DAYS } from './proration.js';

/**
 * DOM-20. The rest day used to be `getDay() !== 6` — Saturday, hardcoded, in a
 * browser file, for a product whose users employ foreign caregivers who may
 * lawfully rest on Friday or Sunday. The divisor moves with the choice, and so
 * does the money.
 */
describe('prorateMonthlySalary', () => {
  const fullSalary = agorot(600_000); // ₪6,000
  const from = israelDate('2026-03-16');
  const to = israelDate('2026-03-31');

  it('produces a different amount for a different rest day — which is the whole point', () => {
    const saturday = prorateMonthlySalary({
      fullSalary,
      from,
      to,
      restDay: WEEKLY_REST_DAYS.saturday,
    });
    const friday = prorateMonthlySalary({ fullSalary, from, to, restDay: WEEKLY_REST_DAYS.friday });
    const sunday = prorateMonthlySalary({ fullSalary, from, to, restDay: WEEKLY_REST_DAYS.sunday });
    expect(saturday.monthDays).toBe(27);
    expect(friday.monthDays).toBe(27);
    expect(sunday.monthDays).toBe(26);
    // March 2026 starts on a Sunday, so excluding Sundays removes five days
    // rather than four — a divisor of 26 instead of 27, tens of shekels apart.
    expect(sunday.amount).not.toBe(saturday.amount);
  });

  it('records the convention it applied rather than leaving it implicit', () => {
    const result = prorateMonthlySalary({
      fullSalary,
      from,
      to,
      restDay: WEEKLY_REST_DAYS.saturday,
    });
    expect(result.convention).toBe('exclude_rest_days_from_both_terms');
    expect(result.paidDays).toBe(14);
  });

  it('rounds the prorated amount to whole agorot exactly once', () => {
    const result = prorateMonthlySalary({
      fullSalary,
      from,
      to,
      restDay: WEEKLY_REST_DAYS.saturday,
    });
    expect(Number.isInteger(result.amount)).toBe(true);
    // 600000 * 14 / 27 = 311111.11… -> 311111 agorot.
    expect(result.amount).toBe(311_111);
  });

  it('pays a full month when the range covers it', () => {
    const result = prorateMonthlySalary({
      fullSalary,
      from: israelDate('2026-03-01'),
      to: israelDate('2026-03-31'),
      restDay: WEEKLY_REST_DAYS.saturday,
    });
    expect(result.amount).toBe(600_000);
  });

  it('refuses a range that spans a month boundary instead of inventing a divisor', () => {
    expect(() =>
      prorateMonthlySalary({
        fullSalary,
        from: israelDate('2026-03-16'),
        to: israelDate('2026-04-15'),
        restDay: WEEKLY_REST_DAYS.saturday,
      }),
    ).toThrow(RangeError);
  });
});
