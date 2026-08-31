import { describe, expect, it } from 'vitest';
import {
  addIsraelMonthsAnchored,
  anchorDayOf,
  BusinessDateError,
  compareIsraelDates,
  daysInMonth,
  isAfterIsraelDay,
  israelDate,
  israelDateOf,
  israelEndOfDayExclusive,
  israelOffsetMs,
  israelStartOfDay,
  toIsraelDate,
} from './date.js';

const HOUR = 3_600_000;

/**
 * DOM-03(a). Every assertion here is about an instant whose Israeli calendar
 * day differs from the UTC one — which is the whole two-to-three hour window
 * the old host-timezone code got wrong every single day.
 */
describe('israelDateOf', () => {
  it('reads the Israeli calendar day, not the UTC one', () => {
    // 22:30 UTC on 15 April is 01:30 on the 16th in Israel (UTC+3, summer).
    expect(israelDateOf('2026-04-15T22:30:00Z')).toBe('2026-04-16');
    // 21:30 UTC on 15 January is 23:30 the same day in Israel (UTC+2, winter).
    expect(israelDateOf('2026-01-15T21:30:00Z')).toBe('2026-01-15');
    // 22:30 UTC on 15 January is 00:30 on the 16th.
    expect(israelDateOf('2026-01-15T22:30:00Z')).toBe('2026-01-16');
  });

  it('is unaffected by the host time zone because it never reads local fields', () => {
    const instant = new Date('2026-04-15T22:30:00Z');
    expect(israelDateOf(instant)).toBe('2026-04-16');
  });

  it('follows the IANA database across the DST boundary rather than adding a constant', () => {
    expect(israelOffsetMs('2026-01-15T12:00:00Z')).toBe(2 * HOUR);
    expect(israelOffsetMs('2026-07-15T12:00:00Z')).toBe(3 * HOUR);
  });
});

describe('israelDate', () => {
  it('refuses a timestamp instead of silently truncating it', () => {
    // DOM-18(b): truncation is what made a rule expire on its own final valid day.
    expect(() => israelDate('2026-01-01T10:00:00Z')).toThrow(BusinessDateError);
  });

  it('refuses a date that is not on the calendar', () => {
    expect(() => israelDate('2026-02-30')).toThrow(BusinessDateError);
  });

  it('orders lexicographically because it is fixed-width and zero-padded', () => {
    expect(compareIsraelDates(israelDate('2026-01-09'), israelDate('2026-01-10'))).toBe(-1);
  });

  it('accepts either shape through toIsraelDate, making the conversion visible', () => {
    expect(toIsraelDate('2026-01-01')).toBe('2026-01-01');
    expect(toIsraelDate('2026-01-01T00:30:00Z')).toBe('2026-01-01');
  });
});

/** DOM-17. A stored calendar day is the LAST valid day. */
describe('day boundaries', () => {
  it('starts a winter day at 22:00 UTC the previous day', () => {
    expect(israelStartOfDay(israelDate('2026-01-15')).toISOString()).toBe(
      '2026-01-14T22:00:00.000Z',
    );
  });

  it('starts a summer day at 21:00 UTC the previous day', () => {
    expect(israelStartOfDay(israelDate('2026-07-15')).toISOString()).toBe(
      '2026-07-14T21:00:00.000Z',
    );
  });

  it('keeps a permit valid for the whole of its final valid day', () => {
    const expiry = israelDate('2026-09-01');
    // The instant the old code called "expired": UTC midnight on the expiry
    // date, which is 03:00 that morning in Israel.
    expect(isAfterIsraelDay('2026-09-01T00:00:00Z', expiry)).toBe(false);
    // Still valid at 23:00 Israel time.
    expect(isAfterIsraelDay('2026-09-01T20:00:00Z', expiry)).toBe(false);
    // Expired once the next Israeli day begins.
    expect(isAfterIsraelDay('2026-09-01T21:00:00Z', expiry)).toBe(true);
  });

  it('ends a day exactly where the next one starts', () => {
    expect(israelEndOfDayExclusive(israelDate('2026-09-01')).getTime()).toBe(
      israelStartOfDay(israelDate('2026-09-02')).getTime(),
    );
  });
});

/** DOM-16. The anniversary must not migrate permanently after a short month. */
describe('addIsraelMonthsAnchored', () => {
  it('clamps a short month and then returns to the anchor day', () => {
    const january = israelDate('2026-01-31');
    const february = addIsraelMonthsAnchored(january, 1, 31);
    expect(february).toBe('2026-02-28');
    // The bug: chaining from the clamped value gives 2026-03-28 forever.
    expect(addIsraelMonthsAnchored(february, 1, 31)).toBe('2026-03-31');
  });

  it('handles a leap February and the 29th/30th anchors', () => {
    expect(addIsraelMonthsAnchored(israelDate('2028-01-30'), 1, 30)).toBe('2028-02-29');
    expect(addIsraelMonthsAnchored(israelDate('2026-01-29'), 1, 29)).toBe('2026-02-28');
    expect(addIsraelMonthsAnchored(israelDate('2026-02-28'), 1, 29)).toBe('2026-03-29');
  });

  it('crosses the year boundary', () => {
    expect(addIsraelMonthsAnchored(israelDate('2026-12-31'), 1, 31)).toBe('2027-01-31');
  });

  it('reads an anchor day back off a date', () => {
    expect(anchorDayOf(israelDate('2026-01-31'))).toBe(31);
  });

  it('knows the length of every month it clamps to', () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 12)).toBe(31);
  });
});
