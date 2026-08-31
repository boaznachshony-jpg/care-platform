import { describe, expect, it } from 'vitest';
import { closeSchema, currentPayrollMonthInIsrael } from './canonical-product-intelligence.js';

// Synthetic amounts only — no real person's salary appears in fixtures.
const CLOSE = {
  payrollReference: 'Synthetic reference 2024-01',
  month: '2024-01',
  paymentDate: '2024-02-09',
  paymentMethod: 'bank_transfer' as const,
  total: 6200,
  baseSalary: 6000,
  additions: 400,
  deductions: 200,
};

describe('monthly-close schema — root 4', () => {
  it('accepts a close whose amounts reconcile', () => {
    const parsed = closeSchema.safeParse(CLOSE);
    expect(parsed.success).toBe(true);
  });

  it('rejects a payload inside the old 0.01 tolerance that the DB would reject (DOM-14)', () => {
    // The exact case from the finding. `Math.abs(1000.126 - 1000.12) < 0.01` is
    // true, so this used to pass validation, be stored as base 1000.13 vs total
    // 1000.12 after numeric(12,2) rounding, violate
    // `payroll_month_close_amount_reconciles`, and surface as a bare 500 on the
    // one operation the user cannot retry their way out of.
    expect(Math.abs(1000.126 - 1000.12) < 0.01).toBe(true);
    const parsed = closeSchema.safeParse({
      ...CLOSE,
      total: 1000.12,
      baseSalary: 1000.126,
      additions: 0,
      deductions: 0,
    });
    expect(parsed.success).toBe(false);
  });

  it('rounds each amount to agorot before comparing, so the parse output is what is stored', () => {
    const parsed = closeSchema.safeParse({
      ...CLOSE,
      total: 1000.13,
      baseSalary: 1000.126,
      additions: 0,
      deductions: 0,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.baseSalary).toBe(1000.13);
  });

  it('accepts a zero-total month, which could never be closed before (DOM-24)', () => {
    // A month in which the caregiver was absent unpaid. `z.number().positive()`
    // made it permanently un-closable, so `hasOpenMonth` nagged forever with no
    // resolution available to the user.
    const parsed = closeSchema.safeParse({
      ...CLOSE,
      total: 0,
      baseSalary: 0,
      additions: 0,
      deductions: 0,
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts a negative-total month where advances exceeded salary (DOM-24/DOM-07)', () => {
    const parsed = closeSchema.safeParse({
      ...CLOSE,
      total: -1000,
      baseSalary: 6000,
      additions: 0,
      deductions: 7000,
    });
    expect(parsed.success).toBe(true);
  });

  it('refuses to close a month that has not happened yet (DOM-24)', () => {
    const parsed = closeSchema.safeParse({ ...CLOSE, month: '2999-01' });
    expect(parsed.success).toBe(false);
    if (!parsed.success)
      expect(parsed.error.issues.some((issue) => issue.path.includes('month'))).toBe(true);
  });

  it('accepts the current month in Israel', () => {
    const parsed = closeSchema.safeParse({
      ...CLOSE,
      month: currentPayrollMonthInIsrael(),
    });
    expect(parsed.success).toBe(true);
  });
});

describe('currentPayrollMonthInIsrael', () => {
  it('reads Asia/Jerusalem, not the host clock zone (DOM-03, as DOM-24 needs it)', () => {
    // 2026-03-31T22:30:00Z is 01:30 on 1 April in Israel (UTC+3 in summer).
    // A host on UTC would still call it March.
    expect(currentPayrollMonthInIsrael(new Date('2026-03-31T22:30:00.000Z'))).toBe('2026-04');
    expect(new Date('2026-03-31T22:30:00.000Z').toISOString().slice(0, 7)).toBe('2026-03');
  });
});
