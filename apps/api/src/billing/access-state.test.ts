import { describe, expect, it } from 'vitest';
import { deriveBillingAccessState, type BillingAccessInput } from './access-state.js';

const GRACE_DAYS = 7;

function plan(overrides: Partial<BillingAccessInput> = {}): BillingAccessInput {
  return {
    launchDiscountPercent: 0,
    chargingStartsAt: '2026-08-01',
    accessGraceStartsAt: null,
    paymentMethod: null,
    ...overrides,
  };
}

const at = (iso: string) => new Date(iso);

describe('deriveBillingAccessState', () => {
  it("is 'active' whenever a payment method is on file, even long past the anchor", () => {
    const result = deriveBillingAccessState(
      plan({ paymentMethod: { last4: '4242' } }),
      GRACE_DAYS,
      at('2027-01-01T00:00:00.000Z'),
    );
    expect(result).toEqual({ accessState: 'active', graceDaysRemaining: null });
  });

  it("is 'active' when the plan is fully sponsored (launchDiscountPercent === 100)", () => {
    const result = deriveBillingAccessState(
      plan({ launchDiscountPercent: 100 }),
      GRACE_DAYS,
      at('2027-01-01T00:00:00.000Z'),
    );
    expect(result).toEqual({ accessState: 'active', graceDaysRemaining: null });
  });

  it("is 'active' when no charge-date policy applies (chargingStartsAt is null)", () => {
    const result = deriveBillingAccessState(
      plan({ chargingStartsAt: null }),
      GRACE_DAYS,
      at('2027-01-01T00:00:00.000Z'),
    );
    expect(result).toEqual({ accessState: 'active', graceDaysRemaining: null });
  });

  it("is 'active' before the charging start date arrives", () => {
    const result = deriveBillingAccessState(plan(), GRACE_DAYS, at('2026-07-31T23:59:59.000Z'));
    expect(result).toEqual({ accessState: 'active', graceDaysRemaining: null });
  });

  it("enters 'grace' on the charging start date itself with the full window remaining", () => {
    const result = deriveBillingAccessState(plan(), GRACE_DAYS, at('2026-08-01T00:00:00.000Z'));
    expect(result).toEqual({ accessState: 'grace', graceDaysRemaining: 7 });
  });

  it('counts down the remaining grace days as time passes', () => {
    const result = deriveBillingAccessState(plan(), GRACE_DAYS, at('2026-08-04T12:00:00.000Z'));
    expect(result).toEqual({ accessState: 'grace', graceDaysRemaining: 4 });
  });

  it("stays in 'grace' through the last day of the window (boundary day 6)", () => {
    const result = deriveBillingAccessState(plan(), GRACE_DAYS, at('2026-08-07T23:59:59.000Z'));
    expect(result).toEqual({ accessState: 'grace', graceDaysRemaining: 1 });
  });

  it('freezes exactly when the grace window elapses (boundary day 7)', () => {
    const result = deriveBillingAccessState(plan(), GRACE_DAYS, at('2026-08-08T00:00:00.000Z'));
    expect(result).toEqual({ accessState: 'frozen', graceDaysRemaining: null });
  });

  it("stays 'frozen' long after the window", () => {
    const result = deriveBillingAccessState(plan(), GRACE_DAYS, at('2026-12-31T00:00:00.000Z'));
    expect(result).toEqual({ accessState: 'frozen', graceDaysRemaining: null });
  });

  it('freezes immediately when the grace window is zero days', () => {
    const result = deriveBillingAccessState(plan(), 0, at('2026-08-01T00:00:00.000Z'));
    expect(result).toEqual({ accessState: 'frozen', graceDaysRemaining: null });
  });

  // ── G-3: cancelling must not be an instant lockout ────────────────────────
  //
  // chargingStartsAt is set when paid billing is switched on and never moves
  // again, so by the time anyone cancels it is months old and the window
  // measured from it is long spent. Cancellation records its own, later anchor.

  it('grants a full grace window from the cancellation date, not the historic charging date', () => {
    const result = deriveBillingAccessState(
      // Charging began five months ago; the customer cancelled today.
      plan({ chargingStartsAt: '2026-03-01', accessGraceStartsAt: '2026-08-01' }),
      GRACE_DAYS,
      at('2026-08-01T09:30:00.000Z'),
    );
    // Anchored on chargingStartsAt this was 'frozen' the second they confirmed.
    expect(result).toEqual({ accessState: 'grace', graceDaysRemaining: 7 });
  });

  it('counts the cancellation grace window down and freezes only when it elapses', () => {
    const cancelled = plan({ chargingStartsAt: '2026-03-01', accessGraceStartsAt: '2026-08-01' });
    expect(deriveBillingAccessState(cancelled, GRACE_DAYS, at('2026-08-05T00:00:00.000Z'))).toEqual(
      {
        accessState: 'grace',
        graceDaysRemaining: 3,
      },
    );
    expect(deriveBillingAccessState(cancelled, GRACE_DAYS, at('2026-08-08T00:00:00.000Z'))).toEqual(
      {
        accessState: 'frozen',
        graceDaysRemaining: null,
      },
    );
  });

  it('keeps the charging anchor when it is the later of the two', () => {
    // A stale cancellation anchor must never extend a window that has since
    // been superseded by a newly activated charging date.
    const result = deriveBillingAccessState(
      plan({ chargingStartsAt: '2026-08-01', accessGraceStartsAt: '2026-01-01' }),
      GRACE_DAYS,
      at('2026-08-09T00:00:00.000Z'),
    );
    expect(result).toEqual({ accessState: 'frozen', graceDaysRemaining: null });
  });

  it('fails open on an unparseable cancellation anchor instead of using the spent one', () => {
    const result = deriveBillingAccessState(
      plan({ chargingStartsAt: '2026-03-01', accessGraceStartsAt: 'not-a-date' }),
      GRACE_DAYS,
      at('2026-08-01T00:00:00.000Z'),
    );
    expect(result).toEqual({ accessState: 'active', graceDaysRemaining: null });
  });

  it('fails open on an unparseable charging start date — never lock on bad data', () => {
    const result = deriveBillingAccessState(
      plan({ chargingStartsAt: 'not-a-date' }),
      GRACE_DAYS,
      at('2027-01-01T00:00:00.000Z'),
    );
    expect(result).toEqual({ accessState: 'active', graceDaysRemaining: null });
  });
});
