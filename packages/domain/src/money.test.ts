import { describe, expect, it } from 'vitest';
import {
  addAgorot,
  agorot,
  agorotFromShekels,
  agorotEqual,
  formatShekels,
  MoneyError,
  parseShekels,
  percentOfAgorot,
  scaleAgorot,
  shekelsOf,
  shekelsText,
  splitVatInclusive,
  subtractAgorot,
  sumAgorot,
} from './money.js';

/**
 * DOM-04. Each case below fails against the pre-root-8 code: `roundMoney` with
 * its EPSILON correction, or the float shekel arithmetic it was applied to.
 */
describe('agorotFromShekels', () => {
  it('rounds half away from zero on the DIGITS, not on the binary float', () => {
    // The finding's own reproduction: roundMoney(8.165) === 8.16 while Postgres
    // stores 8.17, because 8.165 * 100 is 816.4999999999999 in IEEE-754.
    expect(agorotFromShekels(8.165)).toBe(817);
    expect(agorotFromShekels(1.005)).toBe(101);
    expect(agorotFromShekels(1.015)).toBe(102);
    expect(agorotFromShekels(2.344)).toBe(234);
  });

  it('applies the same rule on both sides of zero', () => {
    expect(agorotFromShekels(-8.165)).toBe(-817);
    expect(agorotFromShekels(-1.004)).toBe(-100);
  });

  it('is exact for whole shekels and for two-decimal values', () => {
    expect(agorotFromShekels(7350)).toBe(735_000);
    expect(agorotFromShekels(-1000.5)).toBe(-100_050);
    expect(agorotFromShekels(0)).toBe(0);
  });

  it('refuses what cannot be money', () => {
    expect(() => agorotFromShekels(Number.NaN)).toThrow(MoneyError);
    expect(() => agorotFromShekels(Number.POSITIVE_INFINITY)).toThrow(MoneyError);
    expect(() => agorotFromShekels(10_000_001)).toThrow(MoneyError);
  });

  it('collapses sub-agora exponent-form values to zero rather than guessing', () => {
    expect(agorotFromShekels(1e-9)).toBe(0);
  });
});

describe('parseShekels', () => {
  it('accepts what a Hebrew-locale keyboard produces', () => {
    expect(parseShekels(' ₪ 1,234.50 ')).toBe(123_450);
    expect(parseShekels('6000')).toBe(600_000);
  });

  it('refuses ambiguous or empty input instead of guessing a decimal point', () => {
    expect(() => parseShekels('')).toThrow(MoneyError);
    expect(() => parseShekels('12.34.56')).toThrow(MoneyError);
    expect(() => parseShekels('abc')).toThrow(MoneyError);
  });
});

describe('integer arithmetic', () => {
  it('sums in any order to the same value', () => {
    const parts = [agorot(33), agorot(33), agorot(34)];
    expect(sumAgorot(parts)).toBe(100);
    expect(sumAgorot([...parts].reverse())).toBe(100);
  });

  it('does not drift across a year of additions the way float shekels did', () => {
    // 12 × ₪0.10 is 1.2000000000000002 in float shekels. In agorot it is 120.
    let total = agorot(0);
    for (let month = 0; month < 12; month += 1) total = addAgorot(total, agorotFromShekels(0.1));
    expect(total).toBe(120);
    expect(shekelsOf(total)).toBe(1.2);
  });

  it('compares exactly, with no tolerance window', () => {
    expect(agorotEqual(agorot(100), agorot(100))).toBe(true);
    expect(agorotEqual(agorot(100), agorot(101))).toBe(false);
  });

  it('subtracts into a legitimate negative balance', () => {
    expect(subtractAgorot(agorot(600_000), agorot(700_000))).toBe(-100_000);
  });
});

describe('scaleAgorot', () => {
  it('rounds a fractional rest-day product once, half away from zero', () => {
    // 4.5 rest days at ₪372.15 = ₪1,674.675 -> ₪1,674.68.
    expect(scaleAgorot(agorot(37_215), 4.5)).toBe(167_468);
  });

  it('rounds a negative product away from zero, unlike Math.round', () => {
    expect(scaleAgorot(agorot(-1), 0.5)).toBe(-1);
    expect(Math.round(-0.5)).toBe(-0);
  });
});

describe('percentOfAgorot / effective price arithmetic', () => {
  it('rounds an exact half away from zero', () => {
    // 90% of 5 agorot is 4.5 -> 5, not 4.
    expect(percentOfAgorot(agorot(5), 90)).toBe(5);
    expect(percentOfAgorot(agorot(5), 10)).toBe(1);
  });
});

describe('splitVatInclusive', () => {
  it('splits so the parts always sum to the whole', () => {
    const { net, vat } = splitVatInclusive(agorot(12_900), 1800);
    expect(addAgorot(net, vat)).toBe(12_900);
  });
});

describe('edges', () => {
  it('renders exact decimal text for a numeric(12,2) bind parameter', () => {
    expect(shekelsText(agorot(167_468))).toBe('1674.68');
    expect(shekelsText(agorot(-5))).toBe('-0.05');
    expect(shekelsText(agorot(0))).toBe('0.00');
  });

  it('formats for display without being usable as input', () => {
    expect(formatShekels(agorot(600_000))).toContain('6,000.00');
  });

  it('rejects a fractional agora at the type boundary', () => {
    expect(() => agorot(1.5)).toThrow(MoneyError);
  });
});
