import { describe, expect, it } from 'vitest';
import { israelDate } from './date.js';
import { agorot, MoneyError } from './money.js';
import {
  effectivePriceAgorot,
  inferAnchorDay,
  isCollectable,
  nextChargeOn,
} from './billing-schedule.js';

/**
 * DOM-09. The displayed price and the charged price are now the same function.
 * The values below are the ones migration 0045's
 * `round(price_agorot * (100 - launch_discount_percent) / 100.0)` produces.
 */
describe('effectivePriceAgorot', () => {
  it('charges a partial discount instead of charging nothing', () => {
    // ₪129.00 at 40% off is ₪77.40 — not ₪129.00 (what the old SQL billed for
    // 0% rows) and not ₪0.00 (what a 40% row was actually charged: never).
    expect(effectivePriceAgorot(agorot(12_900), 40)).toBe(7740);
  });

  it('is the full price at 0% and zero at 100%', () => {
    expect(effectivePriceAgorot(agorot(12_900), 0)).toBe(12_900);
    expect(effectivePriceAgorot(agorot(12_900), 100)).toBe(0);
  });

  it('rounds half away from zero, matching round(numeric)', () => {
    // 5 * 90 / 100 = 4.5 -> 5. A float expression is not trusted to agree here.
    expect(effectivePriceAgorot(agorot(5), 10)).toBe(5);
    expect(effectivePriceAgorot(agorot(5), 90)).toBe(1);
    expect(effectivePriceAgorot(agorot(333), 33)).toBe(223);
  });

  it('refuses a discount that is not a whole percent in range', () => {
    expect(() => effectivePriceAgorot(agorot(12_900), 40.5)).toThrow(MoneyError);
    expect(() => effectivePriceAgorot(agorot(12_900), 101)).toThrow(MoneyError);
  });

  it('marks only a fully sponsored subscription as nothing to collect', () => {
    expect(isCollectable(agorot(12_900), 40)).toBe(true);
    expect(isCollectable(agorot(12_900), 100)).toBe(false);
  });
});

/** DOM-16. */
describe('nextChargeOn', () => {
  it('does not migrate a 31st anniversary to the 28th permanently', () => {
    const february = nextChargeOn(israelDate('2026-01-31'), 31);
    expect(february).toBe('2026-02-28');
    expect(nextChargeOn(february, 31)).toBe('2026-03-31');
  });

  it('leaves an anchor inside every month alone', () => {
    expect(nextChargeOn(israelDate('2026-01-15'), 15)).toBe('2026-02-15');
  });
});

describe('inferAnchorDay', () => {
  it('prefers the setup date over an already-clamped next charge date', () => {
    expect(inferAnchorDay('2026-01-31', '2026-02-28')).toBe(31);
  });

  it('falls back to the next charge date when there is no setup date', () => {
    expect(inferAnchorDay(null, '2026-02-28')).toBe(28);
  });

  it('defaults to the 1st when the subscription has neither', () => {
    expect(inferAnchorDay(null, null)).toBe(1);
  });
});
