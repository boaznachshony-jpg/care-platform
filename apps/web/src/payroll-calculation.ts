import {
  agorotFromShekels,
  calculateMonthlyPayroll as calculateCanonicalPayroll,
  scaleAgorot,
  shekelsOf,
} from '@caredesk/domain';

/**
 * Root 4 (DOM-02): this file no longer contains a payroll formula.
 *
 * It used to hold the only implementation of the monthly total in the product —
 * in the browser bundle, versioned with the bundle rather than with the data,
 * while the API wrote whatever `total` it was handed. The arithmetic now lives
 * in `@caredesk/domain`, which is also what the API recomputes with and what
 * migration 0041's CHECK constraint mirrors.
 *
 * What stays here is the MVP form's field vocabulary (`paidSaturdays`,
 * `medicalInsuranceDeduction`, `housingDeduction`, `otherAddition`) and the
 * proration helper, neither of which exists on the canonical `payroll_entry`
 * shape. This module is now a translation from that vocabulary to the canonical
 * components, and nothing more.
 */
export interface MonthlyPayrollInput {
  baseSalary: number;
  paidSaturdays: number;
  saturdayRate: number;
  holidayPay: number;
  vacationPay: number;
  sickPay: number;
  pocketMoney: number;
  employerContributions: number;
  otherAddition: number;
  medicalInsuranceDeduction: number;
  housingDeduction: number;
  advances: number;
  agreedDeduction: number;
}

export interface MonthlyPayrollCalculation {
  saturdayPay: number;
  additions: number;
  deductions: number;
  total: number;
}

export interface ProratedBaseSalary {
  amount: number;
  paidDays: number;
  daysInMonth: number;
  calendarDaysInMonth: number;
  excludedSaturdays: number;
  isProrated: boolean;
}

function safeAmount(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function calculateProratedBaseSalary(
  baseSalary: number,
  month: string,
  startDate: string,
): ProratedBaseSalary {
  const fullSalary = safeAmount(baseSalary);
  const monthMatch = /^(\d{4})-(\d{2})$/.exec(month);
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startDate);

  if (!monthMatch) {
    return {
      amount: fullSalary,
      paidDays: 0,
      daysInMonth: 0,
      calendarDaysInMonth: 0,
      excludedSaturdays: 0,
      isProrated: false,
    };
  }

  const year = Number(monthMatch[1]);
  const monthNumber = Number(monthMatch[2]);
  const calendarDaysInMonth = new Date(year, monthNumber, 0).getDate();
  const countBaseDays = (firstDay: number, lastDay: number) => {
    let count = 0;
    for (let day = firstDay; day <= lastDay; day += 1) {
      if (new Date(year, monthNumber - 1, day).getDay() !== 6) count += 1;
    }
    return count;
  };
  const daysInMonth = countBaseDays(1, calendarDaysInMonth);
  const excludedSaturdays = calendarDaysInMonth - daysInMonth;
  if (
    !dateMatch ||
    Number(dateMatch[1]) !== year ||
    Number(dateMatch[2]) !== monthNumber ||
    Number(dateMatch[3]) < 1 ||
    Number(dateMatch[3]) > calendarDaysInMonth
  ) {
    return {
      amount: fullSalary,
      paidDays: daysInMonth,
      daysInMonth,
      calendarDaysInMonth,
      excludedSaturdays,
      isProrated: false,
    };
  }

  const startDay = Number(dateMatch[3]);
  const paidDays = countBaseDays(startDay, calendarDaysInMonth);
  return {
    // Root 8: this used to be
    // `Math.round(((fullSalary * paidDays) / daysInMonth) * 100) / 100`, a
    // second money model living outside `@caredesk/domain` that could disagree
    // with `payroll_entry_total_reconciles_agorot` (migration 0045) by the same
    // kind of binary-float drift DOM-04 removed everywhere else — a prorated
    // base salary computed here and re-verified by the server were not
    // guaranteed to be the same agora. `paidDays / daysInMonth` is exactly the
    // "dimensionless factor" `scaleAgorot` exists for: convert the full salary
    // to agorot once, scale, and convert back, so this prorated figure rounds
    // by the identical half-away-from-zero rule the domain and the CHECK
    // constraint already use.
    amount:
      daysInMonth === 0
        ? 0
        : shekelsOf(scaleAgorot(agorotFromShekels(fullSalary), paidDays / daysInMonth)),
    paidDays,
    daysInMonth,
    calendarDaysInMonth,
    excludedSaturdays,
    isProrated: startDay > 1,
  };
}

/**
 * Maps the MVP worksheet fields onto the canonical components.
 *
 * DOM-07, partially: the `Math.max(0, …)` clamp is gone — a month where
 * advances exceed salary nets negative, and `payroll_entry.total` has always
 * permitted that. The NaN→0 coercion is refused by the domain for every caller
 * that hands it a raw component, but `safeAmount` is deliberately kept on this
 * path: `PayrollPage`'s own `numeric()` already floors an unparseable field at
 * zero before it gets here, so removing it would change nothing except turn a
 * blank MVP text input into a thrown error. The coercion dies with the MVP
 * worksheet (root 3), not here.
 */
export function calculateMonthlyPayroll(input: MonthlyPayrollInput): MonthlyPayrollCalculation {
  const totals = calculateCanonicalPayroll({
    baseSalary: safeAmount(input.baseSalary),
    paidRestDays: safeAmount(input.paidSaturdays),
    restDayRate: safeAmount(input.saturdayRate),
    holidayPay: safeAmount(input.holidayPay),
    vacationPay: safeAmount(input.vacationPay),
    sickPay: safeAmount(input.sickPay),
    employerContributions: safeAmount(input.employerContributions),
    additionalPayments: [{ amount: safeAmount(input.otherAddition) }],
    pocketMoney: safeAmount(input.pocketMoney),
    deductions: safeAmount(input.medicalInsuranceDeduction) + safeAmount(input.housingDeduction),
    advances: safeAmount(input.advances),
    agreedDeductions: safeAmount(input.agreedDeduction),
  });
  return {
    saturdayPay: totals.restDayPay,
    additions: totals.additions,
    deductions: totals.deductions,
    total: totals.total,
  };
}
