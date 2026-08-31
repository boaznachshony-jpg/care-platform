/**
 * Root 4 — the one implementation of the monthly payroll total.
 *
 * Before this file the calculation existed only in the browser bundle
 * (`apps/web/src/payroll-calculation.ts`), and a second, quietly different copy
 * lived inline in `CanonicalPayrollIntelligence.tsx`. The API accepted `total`
 * as an independent number and wrote it verbatim (DOM-02), and the table had no
 * reconciliation constraint (DB-06). So the canonical record of what a family
 * paid a caregiver was whatever the browser said, versioned with the browser
 * bundle rather than with the data.
 *
 * Everything that computes a payroll total — the API before it persists, the
 * web form as it types, and the CHECK constraint in migration 0041 — now
 * derives from the formula written here once.
 *
 * MONEY REPRESENTATION (root 8, not yet done)
 * -------------------------------------------
 * Root 8 replaces every amount below with a single integer-agorot money type.
 * That work has not landed, so this module deliberately does NOT invent a
 * competing one: amounts stay `number` shekels, matching `numeric(12,2)` in
 * Postgres and the existing API contract. What it does fix is the part that
 * cannot wait — rounding now happens exactly once per aggregate, in one
 * documented function, with the same rule Postgres uses, instead of being left
 * to whichever layer happened to round first. When root 8 lands, `roundShekels`
 * and the `number` amounts here are what it replaces; the formula itself, and
 * every caller of it, should not have to change.
 */

/** A free-form addition recorded as a row in `payroll_entry.additional_payments`. */
export interface PayrollAdditionalPayment {
  amount: number;
}

/**
 * The component inputs a payroll total is derived from. These are exactly the
 * `payroll_entry` money columns; `workDays`, `vacationDays`, `sickDays` and the
 * absence counters are recorded facts that do not enter the arithmetic.
 */
export interface PayrollComponents {
  baseSalary: number;
  paidRestDays: number;
  restDayRate: number;
  holidayPay: number;
  vacationPay: number;
  sickPay: number;
  employerContributions: number;
  additionalPayments: readonly PayrollAdditionalPayment[];
  /** Pocket money already handed over during the month — a deduction, never an addition. */
  pocketMoney: number;
  deductions: number;
  advances: number;
  agreedDeductions: number;
}

export interface PayrollTotals {
  restDayPay: number;
  additions: number;
  deductions: number;
  /**
   * Base + additions − deductions. Deliberately NOT clamped at zero (DOM-07): a
   * caregiver who drew ₪7,000 of advances against a ₪6,000 month nets −₪1,000,
   * a balance carried forward. `payroll_entry.total` has always permitted it;
   * only the browser invented a floor, which erased what the employee owed.
   */
  total: number;
}

/** Why a component was refused, for a caller that maps it onto a field error. */
export type PayrollComponentProblem = 'not_finite' | 'negative';

/**
 * DOM-07: a component that cannot be trusted stops the calculation instead of
 * becoming a silent zero. `safeAmount(NaN) === 0` meant a field that failed to
 * parse either over-paid the caregiver (a vanished `advances`) or under-paid
 * them (a vanished `holidayPay`), and nothing told anyone.
 */
export class PayrollComponentError extends Error {
  constructor(
    readonly component: string,
    readonly problem: PayrollComponentProblem,
  ) {
    super(`payroll component ${component} is ${problem}`);
    this.name = 'PayrollComponentError';
  }
}

/**
 * Round to agorot the way `numeric(12,2)` does: half away from zero, on the
 * decimal the value is written as.
 *
 * `Math.round(x * 100) / 100` is not that rule. `8.165 * 100` is
 * `816.4999999999999` in binary float, so it rounds DOWN to 8.16 — while
 * node-postgres serialises the same JS number as the text `8.165`, which
 * Postgres stores as an exact decimal and rounds UP to 8.17. Rounding on
 * `String(amount)` — the very text that reaches the database — is what makes
 * the JS result and the stored column agree, which is the whole point of
 * recomputing server-side. `Number.EPSILON` corrections (DOM-04's `roundMoney`)
 * do not help: EPSILON is ~2.2e-16 while the representation gap at shekel
 * magnitudes is ~1e-13.
 */
export function roundShekels(amount: number): number {
  if (!Number.isFinite(amount)) throw new PayrollComponentError('amount', 'not_finite');
  const text = String(amount);
  if (text.includes('e') || text.includes('E')) {
    // Exponent form only appears far below one agora (|x| < 1e-6) or far above
    // any amount this product accepts; both round to themselves under this rule.
    return Math.abs(amount) < 0.005 ? 0 : amount;
  }
  const negative = text.startsWith('-');
  const [whole = '0', fraction = ''] = (negative ? text.slice(1) : text).split('.');
  if (fraction.length <= 2) return amount;
  // Half away from zero: the discarded tail is >= half an agora exactly when
  // its first digit is 5 or more.
  const roundUp = fraction.charCodeAt(2) >= 53;
  const agorot = Math.round(Number(`${whole}.${fraction.slice(0, 2)}`) * 100) + (roundUp ? 1 : 0);
  return negative ? -(agorot / 100) : agorot / 100;
}

function component(name: string, value: number): number {
  if (!Number.isFinite(value)) throw new PayrollComponentError(name, 'not_finite');
  // Every component column is `check (… between 0 and 10000000)`. A negative
  // component is a parse failure or a tampered payload, not a credit; the
  // credit case is expressed by a negative *total*, which is allowed.
  if (value < 0) throw new PayrollComponentError(name, 'negative');
  return value;
}

/**
 * The monthly payroll total, derived from its components. Pure: no clock, no
 * IO, no locale.
 *
 * Rounding is applied once per aggregate rather than per term, so the stored
 * `additions`, `deductions` and `total` are each consistent with the columns
 * they are read back from.
 */
export function calculateMonthlyPayroll(components: PayrollComponents): PayrollTotals {
  const baseSalary = roundShekels(component('baseSalary', components.baseSalary));
  const restDayPay = roundShekels(
    component('paidRestDays', components.paidRestDays) *
      component('restDayRate', components.restDayRate),
  );
  const additionalPayments = components.additionalPayments.reduce(
    (sum, payment, index) => sum + component(`additionalPayments.${index}.amount`, payment.amount),
    0,
  );
  const additions = roundShekels(
    restDayPay +
      component('holidayPay', components.holidayPay) +
      component('vacationPay', components.vacationPay) +
      component('sickPay', components.sickPay) +
      component('employerContributions', components.employerContributions) +
      additionalPayments,
  );
  const deductions = roundShekels(
    component('pocketMoney', components.pocketMoney) +
      component('deductions', components.deductions) +
      component('advances', components.advances) +
      component('agreedDeductions', components.agreedDeductions),
  );
  return {
    restDayPay,
    additions,
    deductions,
    total: roundShekels(baseSalary + additions - deductions),
  };
}

/**
 * Whether a submitted total may be persisted as-is.
 *
 * Exact equality after rounding both sides — no tolerance window. DOM-14 is the
 * bug a tolerance produces: the monthly-close route accepted anything within
 * 0.01 while the DB constraint required exact equality on `numeric(12,2)`, so a
 * payload inside the window and outside the constraint passed validation and
 * then raised an unhandled 500 on the one operation the user cannot retry their
 * way out of. Validation and constraint have to agree by construction.
 */
export function payrollTotalMatches(submitted: number, computed: number): boolean {
  return Number.isFinite(submitted) && roundShekels(submitted) === roundShekels(computed);
}
