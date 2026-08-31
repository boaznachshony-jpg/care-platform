import { describe, expect, it } from 'vitest';
import { agorot } from './money.js';
import {
  BLANK_PAYROLL_COMPONENTS_AGOROT,
  PayrollComponentError,
  calculateMonthlyPayroll,
  calculateMonthlyPayrollAgorot,
  payrollTotalMatches,
  roundShekels,
  type PayrollComponents,
} from './payroll.js';

// Synthetic amounts only — no real person's salary appears in fixtures.
const BLANK: PayrollComponents = {
  baseSalary: 0,
  paidRestDays: 0,
  restDayRate: 0,
  holidayPay: 0,
  vacationPay: 0,
  sickPay: 0,
  employerContributions: 0,
  additionalPayments: [],
  pocketMoney: 0,
  deductions: 0,
  advances: 0,
  agreedDeductions: 0,
};

describe('roundShekels', () => {
  it('rounds half away from zero on the decimal the value is written as', () => {
    // DOM-04/DOM-02: `Math.round(8.165 * 100) / 100` is 8.16 because
    // `8.165 * 100` is 816.4999999999999 in binary float, while Postgres reads
    // the text "8.165" and stores 8.17. The recomputed total is only worth
    // anything if it agrees with the column it is compared against.
    expect(Math.round(8.165 * 100) / 100).toBe(8.16);
    expect(roundShekels(8.165)).toBe(8.17);
    expect(roundShekels(1.005)).toBe(1.01);
    expect(roundShekels(1.015)).toBe(1.02);
    expect(roundShekels(2.344)).toBe(2.34);
  });

  it('rounds a negative amount away from zero, as numeric(12,2) does', () => {
    expect(roundShekels(-8.165)).toBe(-8.17);
    expect(roundShekels(-1.004)).toBe(-1);
  });

  it('leaves an amount already at agora precision untouched', () => {
    expect(roundShekels(7350)).toBe(7350);
    expect(roundShekels(-1000.5)).toBe(-1000.5);
  });

  it('refuses a non-finite amount instead of returning zero', () => {
    expect(() => roundShekels(Number.NaN)).toThrow(PayrollComponentError);
  });
});

describe('calculateMonthlyPayroll', () => {
  it('derives the total from base, additions and deductions', () => {
    expect(
      calculateMonthlyPayroll({
        ...BLANK,
        baseSalary: 6000,
        paidRestDays: 4,
        restDayRate: 300,
        holidayPay: 250,
        employerContributions: 500,
        additionalPayments: [{ amount: 200 }],
        pocketMoney: 100,
      }),
    ).toEqual({ restDayPay: 1200, additions: 2150, deductions: 100, total: 8050 });
  });

  it('treats pocket money as a deduction, not an addition', () => {
    // The inline copy in CanonicalPayrollIntelligence.tsx added `pocketMoney`
    // to the total while apps/web/src/payroll-calculation.ts subtracted it.
    // Two client implementations, opposite signs, same field. One formula now.
    const withPocketMoney = calculateMonthlyPayroll({
      ...BLANK,
      baseSalary: 6000,
      pocketMoney: 400,
    });
    expect(withPocketMoney.deductions).toBe(400);
    expect(withPocketMoney.total).toBe(5600);
  });

  it('lets the net go negative when advances exceed the month (DOM-07)', () => {
    // The DB has always permitted `total between -10000000 and 10000000`. The
    // browser's `Math.max(0, …)` invented a floor the data model does not have,
    // erasing the ₪1,000 the employee owes.
    expect(calculateMonthlyPayroll({ ...BLANK, baseSalary: 6000, advances: 7000 }).total).toBe(
      -1000,
    );
  });

  it('refuses a non-finite component instead of coercing it to zero (DOM-07)', () => {
    // `safeAmount(NaN) === 0` made a failed parse silently over- or under-pay.
    expect(() =>
      calculateMonthlyPayroll({ ...BLANK, baseSalary: 6000, advances: Number.NaN }),
    ).toThrow(PayrollComponentError);
    try {
      calculateMonthlyPayroll({ ...BLANK, holidayPay: Number.NaN });
    } catch (error) {
      expect(error).toMatchObject({ component: 'holidayPay', problem: 'not_finite' });
    }
  });

  it('refuses a negative component and names it', () => {
    try {
      calculateMonthlyPayroll({ ...BLANK, additionalPayments: [{ amount: 10 }, { amount: -5 }] });
      throw new Error('expected a PayrollComponentError');
    } catch (error) {
      expect(error).toMatchObject({
        component: 'additionalPayments.1.amount',
        problem: 'negative',
      });
    }
  });

  it('rounds once per aggregate so the parts still sum to the whole', () => {
    const totals = calculateMonthlyPayroll({
      ...BLANK,
      baseSalary: 6000,
      paidRestDays: 4.5,
      restDayRate: 372.15,
    });
    expect(totals.restDayPay).toBe(1674.68);
    expect(totals.additions).toBe(1674.68);
    expect(totals.total).toBe(7674.68);
    expect(roundShekels(6000 + totals.additions - totals.deductions)).toBe(totals.total);
  });
});

describe('payrollTotalMatches', () => {
  it('accepts a total that equals its components after rounding', () => {
    expect(payrollTotalMatches(8050, 8050)).toBe(true);
    expect(payrollTotalMatches(8050.004, 8050)).toBe(true);
  });

  it('rejects a total the components do not produce (DOM-02)', () => {
    // `baseSalary: 6000, advances: 5000, total: 6000` — the tampering case.
    const computed = calculateMonthlyPayroll({ ...BLANK, baseSalary: 6000, advances: 5000 }).total;
    expect(computed).toBe(1000);
    expect(payrollTotalMatches(6000, computed)).toBe(false);
  });

  it('rejects a mismatch inside the 0.01 tolerance the close route used (DOM-14)', () => {
    // 1000.126 rounds to 1000.13; the old `< 0.01` window accepted 1000.12,
    // which the DB constraint then rejected as an unhandled 500.
    expect(Math.abs(1000.126 - 1000.12) < 0.01).toBe(true);
    expect(payrollTotalMatches(1000.12, 1000.126)).toBe(false);
  });

  it('rejects a non-finite submitted total', () => {
    expect(payrollTotalMatches(Number.NaN, 0)).toBe(false);
  });
});

/**
 * Root 8 (DOM-04). The calculation is integer agorot end to end; the shekel
 * functions above are edge adapters over it.
 */
describe('calculateMonthlyPayrollAgorot', () => {
  it('produces whole agorot for every aggregate', () => {
    const totals = calculateMonthlyPayrollAgorot({
      ...BLANK_PAYROLL_COMPONENTS_AGOROT,
      baseSalary: agorot(600_000),
      paidRestDays: 4.5,
      restDayRate: agorot(37_215),
      advances: agorot(50_000),
    });
    expect(Number.isInteger(totals.restDayPay)).toBe(true);
    expect(totals.restDayPay).toBe(167_468); // 4.5 x 372.15 = 1,674.675 -> 1,674.68
    expect(totals.total).toBe(600_000 + 167_468 - 50_000);
  });

  it('agrees with the shekel adapter digit for digit', () => {
    const shekels = calculateMonthlyPayroll({
      ...BLANK,
      baseSalary: 6000,
      paidRestDays: 4.5,
      restDayRate: 372.15,
      advances: 500,
    });
    expect(shekels.total).toBe(7174.68);
  });

  it('does not drift when many small additions are summed', () => {
    // Twelve ₪0.10 additions are 1.2000000000000002 in float shekels.
    const totals = calculateMonthlyPayroll({
      ...BLANK,
      additionalPayments: Array.from({ length: 12 }, () => ({ amount: 0.1 })),
    });
    expect(totals.additions).toBe(1.2);
    expect(totals.total).toBe(1.2);
  });
});

describe('payrollTotalMatches after root 8', () => {
  it('compares whole agorot exactly, with no tolerance window', () => {
    // One agora apart is a mismatch. DOM-14's 0.01 window accepted this and
    // then hit the database constraint on the one operation a user cannot
    // retry their way out of.
    expect(payrollTotalMatches(1000.01, 1000.0)).toBe(false);
    expect(payrollTotalMatches(1000.0, 1000.0)).toBe(true);
  });

  it('refuses an amount larger than any money column can hold', () => {
    expect(payrollTotalMatches(1e12, 1e12)).toBe(false);
  });
});
