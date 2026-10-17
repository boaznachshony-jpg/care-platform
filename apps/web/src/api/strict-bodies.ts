import type { SavePayrollEntryRequest, SaveScenarioExpenseRequest } from './client.js';

/**
 * G. Exactly the body `PUT /cases/:id/payroll-entries/:month` accepts.
 *
 * That route parses with `.strict()` (`apps/api/src/routes/payroll-entries.ts`),
 * so any key it does not name is a 400. The canonical payroll screen seeded its
 * draft by spreading the saved entry it had loaded, which carries `id`,
 * `month`, `createdAt` and `updatedAt`, and sent the draft back the same
 * way: re-saving a month that already had an entry was refused, and the family
 * was told the save had failed. A TypeScript type cannot stop that, because a
 * response object is assignable to the request type. Building the body field
 * by field can: whatever the caller holds, only what the route takes is sent.
 */
export function payrollEntryRequest(source: SavePayrollEntryRequest): SavePayrollEntryRequest {
  return {
    baseSalary: source.baseSalary,
    workDays: source.workDays,
    paidRestDays: source.paidRestDays,
    restDayRate: source.restDayRate,
    paidHolidays: source.paidHolidays,
    holidayPay: source.holidayPay,
    vacationDays: source.vacationDays,
    vacationPay: source.vacationPay,
    sickDays: source.sickDays,
    sickPay: source.sickPay,
    otherAbsenceDays: source.otherAbsenceDays,
    employerContributions: source.employerContributions,
    additionalPayments: source.additionalPayments.map(({ description, amount }) => ({
      description,
      amount,
    })),
    pocketMoney: source.pocketMoney,
    deductions: source.deductions,
    advances: source.advances,
    agreedDeductions: source.agreedDeductions,
    total: source.total,
    status: source.status,
    ...(source.version === undefined ? {} : { version: source.version }),
  };
}

/** G. The scenario-expense routes are `.strict()` too; see `payrollEntryRequest`. */
export function scenarioExpenseRequest(
  source: SaveScenarioExpenseRequest,
): SaveScenarioExpenseRequest {
  return {
    label: source.label,
    amount: source.amount,
    kind: source.kind,
    startMonth: source.startMonth,
    endMonth: source.endMonth,
    ...(source.version === undefined ? {} : { version: source.version }),
  };
}
