/**
 * The one implementation of the monthly payroll total.
 *
 * Root 4 brought this calculation out of the browser bundle: before it, the API
 * accepted `total` as an independent number and wrote it verbatim (DOM-02) and
 * the table had no reconciliation constraint (DB-06), so the canonical record
 * of what a family paid a caregiver was whatever the browser said.
 *
 * MONEY REPRESENTATION (root 8 — landed)
 * --------------------------------------
 * DOM-04. Root 4 left a note here saying the amounts below were still `number`
 * shekels and that root 8 would replace them. This is root 8.
 *
 * The calculation now runs entirely in integer agorot (`./money.js`). Nothing
 * in the arithmetic can hold a fraction of an agora, so:
 *
 *   - `roundShekels`-per-aggregate is gone from the core. Sums of integers are
 *     exact; only the two places where a non-integer legitimately enters — a
 *     fractional rest-day count times a daily rate, and the conversion of an
 *     incoming decimal — round, and each rounds exactly once.
 *   - `payrollTotalMatches` compares two integers with `===`. The tolerance
 *     window DOM-14 describes and the EPSILON correction DOM-04 describes both
 *     existed only because two layers computed the same amount in floating
 *     point and disagreed. There is nothing left for them to do.
 *
 * The shekel-typed functions below are retained as EDGE ADAPTERS, not as a
 * second money model: `payroll_entry` is `numeric(12,2)` and the HTTP contract
 * carries decimal shekels, so something has to convert. That something is here,
 * at the boundary, once, and it is the only code in the payroll path that ever
 * sees a fractional number.
 */

import {
  addAgorot,
  agorotFromShekels,
  MoneyError,
  scaleAgorot,
  shekelsOf,
  subtractAgorot,
  sumAgorot,
  ZERO_AGOROT,
  type Agorot,
} from './money.js';

/** A free-form addition recorded as a row in `payroll_entry.additional_payments`. */
export interface PayrollAdditionalPayment {
  amount: number;
}

/**
 * The component inputs a payroll total is derived from, in decimal shekels as
 * they arrive over HTTP and as `numeric(12,2)` stores them. These are exactly
 * the `payroll_entry` money columns; `workDays`, `vacationDays`, `sickDays` and
 * the absence counters are recorded facts that do not enter the arithmetic.
 *
 * `paidRestDays` is a COUNT, not money — it is legitimately fractional (half a
 * rest day) and is the one term that is multiplied rather than added.
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

/** The same components with every money term already in whole agorot. */
export interface PayrollComponentsAgorot {
  baseSalary: Agorot;
  /** A day count, not money. */
  paidRestDays: number;
  restDayRate: Agorot;
  holidayPay: Agorot;
  vacationPay: Agorot;
  sickPay: Agorot;
  employerContributions: Agorot;
  additionalPayments: readonly Agorot[];
  pocketMoney: Agorot;
  deductions: Agorot;
  advances: Agorot;
  agreedDeductions: Agorot;
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

export interface PayrollTotalsAgorot {
  restDayPay: Agorot;
  additions: Agorot;
  deductions: Agorot;
  total: Agorot;
}

/** Why a component was refused, for a caller that maps it onto a field error. */
export type PayrollComponentProblem = 'not_finite' | 'negative' | 'out_of_range';

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
 * Round a decimal shekel amount to whole agorot, half away from zero.
 *
 * Retained as an edge helper for the HTTP layer, but it is no longer a money
 * model of its own: it is `agorotFromShekels` followed by `shekelsOf`, so it
 * cannot disagree with the rest of root 8 the way the old hand-rolled version
 * could disagree with `roundMoney` (DOM-04).
 */
export function roundShekels(amount: number): number {
  try {
    return shekelsOf(agorotFromShekels(amount));
  } catch (error) {
    if (error instanceof MoneyError) {
      throw new PayrollComponentError(
        'amount',
        error.problem === 'out_of_range' ? 'out_of_range' : 'not_finite',
      );
    }
    throw error;
  }
}

/** Convert one incoming decimal component to agorot, naming it if it is refused. */
function toComponentAgorot(name: string, value: number): Agorot {
  let amount: Agorot;
  try {
    amount = agorotFromShekels(value);
  } catch (error) {
    if (error instanceof MoneyError) {
      throw new PayrollComponentError(
        name,
        error.problem === 'out_of_range' ? 'out_of_range' : 'not_finite',
      );
    }
    throw error;
  }
  // Every component column is `check (… between 0 and 10000000)`. A negative
  // component is a parse failure or a tampered payload, not a credit; the
  // credit case is expressed by a negative *total*, which is allowed.
  if (amount < 0) throw new PayrollComponentError(name, 'negative');
  return amount;
}

function count(name: string, value: number): number {
  if (!Number.isFinite(value)) throw new PayrollComponentError(name, 'not_finite');
  if (value < 0) throw new PayrollComponentError(name, 'negative');
  return value;
}

/**
 * The monthly payroll total, in agorot, derived from its components. Pure: no
 * clock, no IO, no locale, no floating-point money.
 *
 * This is the canonical formula. `calculateMonthlyPayroll` and the CHECK
 * constraint `payroll_entry_total_reconciles_agorot` in migration 0045 are both
 * expressions of it; nothing else may re-derive a payroll total.
 */
export function calculateMonthlyPayrollAgorot(
  components: PayrollComponentsAgorot,
): PayrollTotalsAgorot {
  // The single rounding step in the whole calculation: a fractional day count
  // times an integer daily rate. Everything downstream is integer addition.
  const restDayPay = scaleAgorot(
    components.restDayRate,
    count('paidRestDays', components.paidRestDays),
  );
  const additions = addAgorot(
    restDayPay,
    components.holidayPay,
    components.vacationPay,
    components.sickPay,
    components.employerContributions,
    sumAgorot(components.additionalPayments),
  );
  const deductions = addAgorot(
    components.pocketMoney,
    components.deductions,
    components.advances,
    components.agreedDeductions,
  );
  return {
    restDayPay,
    additions,
    deductions,
    total: subtractAgorot(addAgorot(components.baseSalary, additions), deductions),
  };
}

/** Edge adapter: decimal shekels in, agorot core, decimal shekels out. */
export function toPayrollComponentsAgorot(components: PayrollComponents): PayrollComponentsAgorot {
  return {
    baseSalary: toComponentAgorot('baseSalary', components.baseSalary),
    paidRestDays: count('paidRestDays', components.paidRestDays),
    restDayRate: toComponentAgorot('restDayRate', components.restDayRate),
    holidayPay: toComponentAgorot('holidayPay', components.holidayPay),
    vacationPay: toComponentAgorot('vacationPay', components.vacationPay),
    sickPay: toComponentAgorot('sickPay', components.sickPay),
    employerContributions: toComponentAgorot(
      'employerContributions',
      components.employerContributions,
    ),
    additionalPayments: components.additionalPayments.map((payment, index) =>
      toComponentAgorot(`additionalPayments.${index}.amount`, payment.amount),
    ),
    pocketMoney: toComponentAgorot('pocketMoney', components.pocketMoney),
    deductions: toComponentAgorot('deductions', components.deductions),
    advances: toComponentAgorot('advances', components.advances),
    agreedDeductions: toComponentAgorot('agreedDeductions', components.agreedDeductions),
  };
}

/**
 * The monthly payroll total in decimal shekels, for the HTTP contract and the
 * `numeric(12,2)` columns. A thin conversion around
 * `calculateMonthlyPayrollAgorot` — it holds no arithmetic of its own.
 */
export function calculateMonthlyPayroll(components: PayrollComponents): PayrollTotals {
  const totals = calculateMonthlyPayrollAgorot(toPayrollComponentsAgorot(components));
  return {
    restDayPay: shekelsOf(totals.restDayPay),
    additions: shekelsOf(totals.additions),
    deductions: shekelsOf(totals.deductions),
    total: shekelsOf(totals.total),
  };
}

/**
 * Whether a submitted total may be persisted as-is.
 *
 * Integer equality in agorot. There is no tolerance window and no EPSILON
 * correction, because there is no floating-point money left to correct: both
 * sides are whole agorot by the time they meet. DOM-14 is the bug a tolerance
 * produces — the monthly-close route accepted anything within 0.01 while the DB
 * constraint required exact equality, so a payload inside the window and
 * outside the constraint passed validation and then raised an unhandled 500 on
 * the one operation the user cannot retry their way out of.
 */
export function payrollTotalMatches(submitted: number, computed: number): boolean {
  if (!Number.isFinite(submitted) || !Number.isFinite(computed)) return false;
  try {
    return agorotFromShekels(submitted) === agorotFromShekels(computed);
  } catch (error) {
    if (error instanceof MoneyError) return false;
    throw error;
  }
}

/** The zero-agorot component set, useful to callers building a blank month. */
export const BLANK_PAYROLL_COMPONENTS_AGOROT: PayrollComponentsAgorot = {
  baseSalary: ZERO_AGOROT,
  paidRestDays: 0,
  restDayRate: ZERO_AGOROT,
  holidayPay: ZERO_AGOROT,
  vacationPay: ZERO_AGOROT,
  sickPay: ZERO_AGOROT,
  employerContributions: ZERO_AGOROT,
  additionalPayments: [],
  pocketMoney: ZERO_AGOROT,
  deductions: ZERO_AGOROT,
  advances: ZERO_AGOROT,
  agreedDeductions: ZERO_AGOROT,
};
