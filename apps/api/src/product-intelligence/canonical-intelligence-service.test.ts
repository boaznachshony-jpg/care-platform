import { describe, expect, it } from 'vitest';
import { closeResponse } from './canonical-intelligence-service.js';

/**
 * R5-08. `closed_by` was written on every payroll month close since the route
 * existed and was never returned, so the money receipt could say what was
 * closed and when, but not by whom — and the product backlog recorded "no
 * source carries an actor" when in fact one did.
 *
 * These tests pin the mapping rule rather than the SQL: the wire response
 * carries a **name a person can read, or nothing at all**. The second test is
 * the one that matters. A raw uuid on a screen that finalises what a caregiver
 * is paid reads as data corruption, and an unresolvable actor is a normal
 * state — a family member who has since left the household, or a close
 * recorded before this code shipped.
 *
 * Synthetic identifiers and a synthetic name only (Constitution §16).
 */
const CLOSER_ID = '00000000-0000-4000-8000-0000000000c1';

const ROW = {
  id: '00000000-0000-4000-8000-000000000001',
  payroll_reference: 'Synthetic reference 2026-07',
  payroll_month: '2026-07-01',
  payment_date: '2026-08-09',
  payment_method: 'bank_transfer' as const,
  total_amount: '7200.00',
  base_salary_amount: '7200.00',
  additions_amount: '0.00',
  deductions_amount: '0.00',
  closed_at: new Date('2026-08-09T06:10:00.000Z'),
  closed_by: CLOSER_ID,
};

describe('payroll month close — who closed it (R5-08)', () => {
  it('names the closer when the tenant can resolve the id', () => {
    const close = closeResponse(ROW, new Map([[CLOSER_ID, 'בועז בדיקה']]));
    expect(close.closedBy).toBe('בועז בדיקה');
  });

  it('returns null rather than a raw id when the name cannot be resolved', () => {
    const close = closeResponse(ROW, new Map());
    expect(close.closedBy).toBeNull();
  });

  it('returns null for a close that has no actor recorded at all', () => {
    const close = closeResponse({ ...ROW, closed_by: null }, new Map([[CLOSER_ID, 'בועז בדיקה']]));
    expect(close.closedBy).toBeNull();
  });

  it('still maps every other field, so adding the actor changed nothing else', () => {
    const close = closeResponse(ROW, new Map([[CLOSER_ID, 'בועז בדיקה']]));
    expect(close.month).toBe('2026-07');
    expect(close.paymentDate).toBe('2026-08-09');
    expect(close.total).toBe(7200);
    expect(close.closedAt).toBe('2026-08-09T06:10:00.000Z');
  });
});
