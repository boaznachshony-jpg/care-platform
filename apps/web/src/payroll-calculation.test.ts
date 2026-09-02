import { describe, expect, it } from 'vitest';
import { calculateMonthlyPayroll, calculateProratedBaseSalary } from './payroll-calculation.js';

const emptyInput = {
  baseSalary: 7_000,
  paidSaturdays: 0,
  saturdayRate: 0,
  holidayPay: 0,
  vacationPay: 0,
  sickPay: 0,
  pocketMoney: 0,
  employerContributions: 0,
  otherAddition: 0,
  medicalInsuranceDeduction: 0,
  housingDeduction: 0,
  advances: 0,
  agreedDeduction: 0,
};

describe('monthly payroll calculation', () => {
  it('prorates the base salary from the selected date through the end of the month', () => {
    expect(calculateProratedBaseSalary(6_400, '2026-07', '2026-07-16')).toEqual({
      amount: 3_318.52,
      paidDays: 14,
      daysInMonth: 27,
      calendarDaysInMonth: 31,
      excludedSaturdays: 4,
      isProrated: true,
    });
  });

  it('rounds the prorated amount the way the domain (and the DB CHECK) does, not the way plain float division does', () => {
    // Root 8. The old implementation was
    // `Math.round(((fullSalary * paidDays) / daysInMonth) * 100) / 100` — a
    // second money model living outside `@caredesk/domain`. For a caregiver
    // paid ₪4,096.69/month starting March 2, 2024 (25 of 26 working days;
    // March 2024 has five Saturdays), that formula computes ₪3,939.12. The
    // true value, rounded half-away-from-zero on the exact decimal — the same
    // rule `@caredesk/domain`'s `scaleAgorot` and migration 0045's
    // `payroll_entry_total_reconciles_agorot` CHECK both apply — is ₪3,939.13.
    // The one-agora gap is `(4096.69 * 25) / 26 * 100`, which is
    // 393912.99999999994 in IEEE-754 double precision rather than the exact
    // 393913: `Math.round` on the float floors it to 393912 and the base
    // salary this screen would have recorded, saved and reported to National
    // Insurance is a single agora short of what the domain and the database
    // both agree the caregiver is owed.
    expect(calculateProratedBaseSalary(4_096.69, '2024-03', '2024-03-02')).toEqual({
      amount: 3_939.13,
      paidDays: 25,
      daysInMonth: 26,
      calendarDaysInMonth: 31,
      excludedSaturdays: 5,
      isProrated: true,
    });
  });

  it('keeps the full base salary when no partial-month date is selected', () => {
    expect(calculateProratedBaseSalary(6_400, '2026-07', '')).toEqual({
      amount: 6_400,
      paidDays: 27,
      daysInMonth: 27,
      calendarDaysInMonth: 31,
      excludedSaturdays: 4,
      isProrated: false,
    });
  });

  it('calculates flexible Saturday pay from count and rate', () => {
    expect(
      calculateMonthlyPayroll({
        ...emptyInput,
        paidSaturdays: 3,
        saturdayRate: 450,
      }),
    ).toEqual({
      saturdayPay: 1_350,
      additions: 1_350,
      deductions: 0,
      total: 8_350,
    });
  });

  it('adds optional additions and subtracts advances and deductions', () => {
    expect(
      calculateMonthlyPayroll({
        ...emptyInput,
        paidSaturdays: 2,
        saturdayRate: 500,
        holidayPay: 300,
        otherAddition: 250,
        advances: 700,
        agreedDeduction: 100,
      }),
    ).toMatchObject({
      saturdayPay: 1_000,
      additions: 1_550,
      deductions: 800,
      total: 7_750,
    });
  });

  it('treats pocket money already paid during the month as a deduction', () => {
    expect(
      calculateMonthlyPayroll({
        ...emptyInput,
        paidSaturdays: 2,
        saturdayRate: 439.98,
        pocketMoney: 100,
      }),
    ).toMatchObject({
      saturdayPay: 879.96,
      additions: 879.96,
      deductions: 100,
      total: 7_779.96,
    });
  });

  it('carries a negative net forward instead of clamping it to zero (DOM-07)', () => {
    // This test previously asserted `.toBe(0)`. The clamp erased what the
    // employee owes: ₪500 of advances against a ₪100 month is a −₪400 balance,
    // which `payroll_entry.total between -10000000 and 10000000` has always
    // permitted. The floor existed only in the browser.
    expect(
      calculateMonthlyPayroll({
        ...emptyInput,
        baseSalary: 100,
        advances: 500,
      }).total,
    ).toBe(-400);
  });
});
