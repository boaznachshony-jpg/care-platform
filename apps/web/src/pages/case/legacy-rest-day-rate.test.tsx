import { describe, expect, it } from 'vitest';
import { legacyRestDayRate } from './CanonicalPayrollIntelligence.js';

/**
 * R5-09. The regression these tests exist to prevent is a silent one: a legacy
 * month migrated to the canonical store with rest day pay of zero, after which
 * the screen offers to remove the browser record that held the real figure.
 * The worker in the pilot started on 01.06.2026 and is paid for rest days, so
 * June and July 2026 were both entered before `saturdayRate` existed — these
 * are not hypothetical records.
 */
describe('legacyRestDayRate', () => {
  it('uses the stored rate when the record has one', () => {
    expect(legacyRestDayRate({ saturdayRate: 440, paidSaturdays: 3, saturdayPay: 1_320 })).toEqual({
      kind: 'stored',
      rate: 440,
    });
  });

  it('recovers the rate from the product when the field predates the record', () => {
    // The regression itself: `saturdayRate ?? 0` returned 0 here, and 0 is what
    // was written to the canonical entry.
    expect(legacyRestDayRate({ paidSaturdays: 3, saturdayPay: 1_320 })).toEqual({
      kind: 'derived',
      rate: 440,
    });
  });

  it('never returns zero for a record that actually paid for rest days', () => {
    for (const paidSaturdays of [1, 2, 3, 4, 5]) {
      const result = legacyRestDayRate({ paidSaturdays, saturdayPay: 440 * paidSaturdays });
      expect(result.rate).toBeGreaterThan(0);
      expect(result.kind).not.toBe('none');
    }
  });

  it('refuses rather than rounds when the product does not divide evenly', () => {
    // 1,760 over 3 Saturdays derives 586.67, which multiplies back to 1,760.01.
    // One agora on a figure a termination settlement is reconstructed from is a
    // debt to the caregiver, so this is reported and the migration is refused.
    const result = legacyRestDayRate({ paidSaturdays: 3, saturdayPay: 1_760 });
    expect(result.kind).toBe('unrepresentable');
    if (result.kind !== 'unrepresentable') throw new Error('unreachable');
    expect(result.rate).toBe(586.67);
    expect(result.wouldBecome).toBe(1_760.01);
    expect(result.stored).toBe(1_760);
  });

  it('reports zero only when nothing was paid for rest days', () => {
    expect(legacyRestDayRate({ paidSaturdays: 0, saturdayPay: 0 })).toEqual({
      kind: 'none',
      rate: 0,
    });
    expect(legacyRestDayRate({ paidSaturdays: 4, saturdayPay: 0 })).toEqual({
      kind: 'none',
      rate: 0,
    });
  });

  it('survives a legacy record carrying a figure the money model refuses', () => {
    // DOM-04 class: a non-finite amount must not throw out of a render path.
    expect(legacyRestDayRate({ paidSaturdays: 3, saturdayPay: Number.NaN })).toEqual({
      kind: 'none',
      rate: 0,
    });
    expect(legacyRestDayRate({ paidSaturdays: Number.NaN, saturdayPay: 1_320 })).toEqual({
      kind: 'none',
      rate: 0,
    });
  });

  it('prefers the stored rate even when the product disagrees with it', () => {
    // A stored rate is a value the user typed; a derived one is an inference.
    // The typed value wins, and the discrepancy is not silently reconciled.
    expect(legacyRestDayRate({ saturdayRate: 500, paidSaturdays: 3, saturdayPay: 1_320 })).toEqual({
      kind: 'stored',
      rate: 500,
    });
  });
});
