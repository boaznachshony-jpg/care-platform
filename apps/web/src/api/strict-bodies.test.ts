import { describe, expect, it } from 'vitest';
import type { PayrollEntryResponse, ScenarioExpenseResponse } from './client.js';
import { payrollEntryRequest, scenarioExpenseRequest } from './strict-bodies.js';

/**
 * G. Both routes parse with `.strict()`, so a key they do not name is a 400.
 * These lists are the keys of the zod `body` objects in
 * `apps/api/src/routes/payroll-entries.ts` and
 * `apps/api/src/routes/scenario-expenses.ts`; a field added there and not here
 * is the next silent refusal.
 */
const PAYROLL_ENTRY_BODY_KEYS = [
  'additionalPayments',
  'advances',
  'agreedDeductions',
  'baseSalary',
  'deductions',
  'employerContributions',
  'holidayPay',
  'otherAbsenceDays',
  'paidHolidays',
  'paidRestDays',
  'pocketMoney',
  'restDayRate',
  'sickDays',
  'sickPay',
  'status',
  'total',
  'vacationDays',
  'vacationPay',
  'version',
  'workDays',
];
const SCENARIO_EXPENSE_BODY_KEYS = ['amount', 'endMonth', 'kind', 'label', 'startMonth', 'version'];

const savedEntry: PayrollEntryResponse = {
  id: 'entry-1',
  month: '2026-09',
  baseSalary: 6_200,
  workDays: 26,
  paidRestDays: 4,
  restDayRate: 310,
  paidHolidays: 0,
  holidayPay: 0,
  vacationDays: 0,
  vacationPay: 0,
  sickDays: 0,
  sickPay: 0,
  otherAbsenceDays: 0,
  employerContributions: 0,
  additionalPayments: [{ description: 'בונוס', amount: 100 }],
  pocketMoney: 500,
  deductions: 0,
  advances: 0,
  agreedDeductions: 0,
  total: 7_040,
  status: 'draft',
  version: 3,
  createdAt: '2026-09-30T10:00:00.000Z',
  updatedAt: '2026-09-30T10:00:00.000Z',
};

describe('payrollEntryRequest', () => {
  it('sends a saved entry back with only the keys the strict route accepts', () => {
    const body = payrollEntryRequest(savedEntry);

    expect(Object.keys(body).sort()).toEqual(PAYROLL_ENTRY_BODY_KEYS);
    expect(body).not.toHaveProperty('id');
    expect(body).not.toHaveProperty('month');
    expect(body).not.toHaveProperty('createdAt');
    expect(body).not.toHaveProperty('updatedAt');
    expect(body).toMatchObject({ baseSalary: 6_200, pocketMoney: 500, version: 3 });
  });

  it('survives JSON with exactly those keys, nested payments included', () => {
    const withExtras = {
      ...savedEntry,
      additionalPayments: [{ description: 'בונוס', amount: 100, id: 'draft-row-1' }],
    };
    const sent = JSON.parse(JSON.stringify(payrollEntryRequest(withExtras))) as Record<
      string,
      unknown
    >;

    expect(Object.keys(sent).sort()).toEqual(PAYROLL_ENTRY_BODY_KEYS);
    expect(sent.additionalPayments).toEqual([{ description: 'בונוס', amount: 100 }]);
  });

  it('leaves version out for a month that has no entry yet', () => {
    const { version: _version, ...unsaved } = savedEntry;
    void _version;

    expect(payrollEntryRequest(unsaved)).not.toHaveProperty('version');
  });
});

describe('scenarioExpenseRequest', () => {
  it('sends a loaded expense back with only the keys the strict route accepts', () => {
    const loaded: ScenarioExpenseResponse = {
      id: 'expense-1',
      label: 'ביטוח רפואי',
      amount: 250,
      kind: 'recurring',
      startMonth: '2026-10',
      endMonth: null,
      status: 'active',
      version: 2,
      createdAt: '2026-10-01T10:00:00.000Z',
      updatedAt: '2026-10-01T10:00:00.000Z',
    };

    expect(Object.keys(scenarioExpenseRequest(loaded)).sort()).toEqual(SCENARIO_EXPENSE_BODY_KEYS);
  });
});
