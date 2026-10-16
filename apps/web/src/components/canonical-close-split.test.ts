import { describe, expect, it } from 'vitest';
import { calculateMonthlyPayroll } from '../payroll-calculation.js';
import { canonicalCloseSplit } from './PayrollIntelligence.js';

/**
 * R5-10. The split the close payload sends has to reconcile against the same
 * arithmetic the server applies: `total === baseSalary + additions - deductions`
 * (`apps/api/src/routes/canonical-product-intelligence.ts`). These tests build
 * the record the way the payroll wizard does — through the domain formula —
 * so a divergence between the two is a failing test rather than a 422 that a
 * family reads as a network problem.
 */
const base = {
  baseSalary: 6_000,
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

/** A saved record, built exactly as the wizard builds one. */
function record(overrides: Partial<typeof base>) {
  const input = { ...base, ...overrides };
  return { ...input, total: calculateMonthlyPayroll(input).total };
}

function reconciles(r: ReturnType<typeof record>): boolean {
  const split = canonicalCloseSplit(r);
  return r.total === r.baseSalary + split.additions - split.deductions;
}

describe('canonicalCloseSplit', () => {
  it('counts pocket money as a deduction, as the domain formula does', () => {
    const r = record({ pocketMoney: 500 });
    const split = canonicalCloseSplit(r);
    expect(split.deductions).toBe(500);
    expect(split.additions).toBe(0);
    expect(r.total).toBe(5_500);
  });

  it('reconciles a month that pays pocket money — the regression itself', () => {
    // Before the fix this month could never be closed: the server's refine
    // failed and the screen said "check your internet connection".
    expect(reconciles(record({ pocketMoney: 500 }))).toBe(true);
  });

  it('does not understate both lines when pocket money rides alongside an addition', () => {
    // The quieter half: the errors used to cancel in the total, so the CHECK
    // constraint passed while the stored receipt was wrong on both lines.
    const r = record({ pocketMoney: 500, holidayPay: 800 });
    const split = canonicalCloseSplit(r);
    expect(r.total).toBe(6_300);
    expect(split.additions).toBe(800);
    expect(split.deductions).toBe(500);
    expect(reconciles(r)).toBe(true);
  });

  it('reconciles across every combination of components', () => {
    const cases: Array<Partial<typeof base>> = [
      {},
      { pocketMoney: 500 },
      { advances: 1_200 },
      { medicalInsuranceDeduction: 155, housingDeduction: 400 },
      { paidSaturdays: 3, saturdayRate: 440 },
      { paidSaturdays: 3, saturdayRate: 440, pocketMoney: 500, advances: 300 },
      { holidayPay: 440, vacationPay: 350, sickPay: 300, pocketMoney: 250 },
      { employerContributions: 900, pocketMoney: 500 },
      { otherAddition: 123.45, pocketMoney: 67.89 },
    ];
    for (const overrides of cases) {
      expect(reconciles(record(overrides))).toBe(true);
    }
  });

  it('refuses rather than clamps when the deductions exceed the month', () => {
    // `additions_amount >= 0` is a database constraint (migration 0026). The
    // clamp this replaces made such a month fail with a generic error; naming
    // it points the family at the advances, which is where the answer is.
    const r = record({ advances: 9_000 });
    const split = canonicalCloseSplit(r);
    expect(split.kind).toBe('unrepresentable');
    expect(split.additions).toBeLessThan(0);
  });

  it('treats the optional deduction fields as zero, never as missing', () => {
    const split = canonicalCloseSplit({
      total: 6_000,
      baseSalary: 6_000,
      pocketMoney: 0,
      advances: 0,
      agreedDeduction: 0,
    });
    expect(split).toEqual({ kind: 'ok', additions: 0, deductions: 0 });
  });
});
