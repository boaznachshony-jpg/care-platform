import { describe, expect, it } from 'vitest';
import {
  classifyExpiry,
  daysUntil,
  expirySeverity,
  extractIsoDateFromLabel,
  localNoonFromDateValue,
} from './date-diff.js';

describe('daysUntil', () => {
  it('counts whole calendar days regardless of the time of day on either side', () => {
    expect(daysUntil('2026-10-15', new Date('2026-08-20T23:30:00'))).toBe(56);
    expect(daysUntil('2026-08-20', new Date('2026-08-20T01:00:00'))).toBe(0);
  });

  it('returns 0 on the due date itself', () => {
    expect(daysUntil('2026-09-02', new Date('2026-09-02T18:45:00'))).toBe(0);
  });

  it('returns a negative count for a date in the past', () => {
    expect(daysUntil('2026-08-01', new Date('2026-08-10T09:00:00'))).toBe(-9);
  });

  it('returns null for a value that does not parse as a date', () => {
    expect(daysUntil('not-a-date', new Date('2026-08-10T09:00:00'))).toBeNull();
    expect(daysUntil('', new Date('2026-08-10T09:00:00'))).toBeNull();
  });

  /**
   * This is the exact bug defect 2 describes: a naive
   * `new Date(isoDate).getTime() - Date.now()` mixes a UTC-midnight parse of
   * the ISO date with a local "now", so the same calendar date can read as
   * "today" on one screen and "tomorrow" on another depending only on the
   * local clock. Israel is UTC+3 in summer (IDT): at 00:30 local time on
   * 2026-08-15, `new Date('2026-08-15')` (00:00 UTC = 03:00 local) is still
   * two and a half hours in the *future*, so the naive subtraction reports
   * "1 day away" even though the local wall calendar already reads
   * 2026-08-15 — the expiry date itself. Anchoring both sides to local noon
   * removes the timezone from the arithmetic entirely. The TZ is forced for
   * this one test so the assertion doesn't depend on wherever CI happens to
   * run — the whole point is that this must hold in Israel regardless of
   * the runner's own default zone.
   */
  it('treats an expiry date as "today" from local midnight onward, unlike naive UTC-vs-local subtraction', () => {
    const originalTz = process.env.TZ;
    process.env.TZ = 'Asia/Jerusalem';
    try {
      const justAfterLocalMidnight = new Date(2026, 7, 15, 0, 30); // 2026-08-15T00:30 Israel time
      expect(daysUntil('2026-08-15', justAfterLocalMidnight)).toBe(0);

      // The naive approach this replaces would get this wrong: it is still
      // "in the future" by UTC-midnight-vs-local-clock arithmetic even
      // though the Israeli wall calendar already reads the expiry date.
      const naiveDays = Math.ceil(
        (new Date('2026-08-15').getTime() - justAfterLocalMidnight.getTime()) / 86_400_000,
      );
      expect(naiveDays).not.toBe(0);
    } finally {
      process.env.TZ = originalTz;
    }
  });

  it('accepts a full ISO timestamp (not just a plain yyyy-mm-dd) by resolving its local calendar day', () => {
    const today = new Date('2026-08-10T12:00:00');
    const fiveDaysOut = new Date(today.getTime() + 5 * 86_400_000).toISOString();
    expect(daysUntil(fiveDaysOut, today)).toBe(5);
  });
});

describe('localNoonFromDateValue', () => {
  it('reads a plain yyyy-mm-dd string as that literal local calendar day', () => {
    const noon = localNoonFromDateValue('2026-08-15');
    expect(noon?.getFullYear()).toBe(2026);
    expect(noon?.getMonth()).toBe(7);
    expect(noon?.getDate()).toBe(15);
    expect(noon?.getHours()).toBe(12);
  });

  it('returns null for malformed input', () => {
    expect(localNoonFromDateValue('2026-13-40')).toBeNull();
    expect(localNoonFromDateValue('hello')).toBeNull();
  });
});

describe('expirySeverity', () => {
  it('is urgent inside the 14-day window, soon inside the 30-day window, ok beyond it', () => {
    expect(expirySeverity(-1)).toBe('urgent');
    expect(expirySeverity(0)).toBe('urgent');
    expect(expirySeverity(13)).toBe('urgent');
    expect(expirySeverity(14)).toBe('soon');
    expect(expirySeverity(29)).toBe('soon');
    expect(expirySeverity(30)).toBe('ok');
  });
});

describe('classifyExpiry', () => {
  const today = new Date('2026-08-10T09:00:00');

  it('classifies a missing date as no-date, not ok or expired', () => {
    expect(classifyExpiry(undefined, today)).toBe('no-date');
    expect(classifyExpiry(null, today)).toBe('no-date');
    expect(classifyExpiry('', today)).toBe('no-date');
  });

  it('classifies today as urgent', () => {
    expect(classifyExpiry('2026-08-10', today)).toBe('urgent');
  });

  it('classifies a past date as expired', () => {
    expect(classifyExpiry('2026-08-01', today)).toBe('expired');
  });

  it('classifies inside 14 days as urgent, inside 30 as soon, beyond as ok', () => {
    expect(classifyExpiry('2026-08-20', today)).toBe('urgent'); // 10 days
    expect(classifyExpiry('2026-09-05', today)).toBe('soon'); // 26 days
    expect(classifyExpiry('2026-09-20', today)).toBe('ok'); // 41 days
  });
});

describe('extractIsoDateFromLabel', () => {
  it('reads a DD.MM.YYYY display label', () => {
    expect(extractIsoDateFromLabel('בתוקף עד 31.12.2027')).toBe('2027-12-31');
  });

  it('reads an embedded ISO date', () => {
    expect(extractIsoDateFromLabel('valid until 2027-12-31')).toBe('2027-12-31');
  });

  it('returns null when there is no date in the label', () => {
    expect(extractIsoDateFromLabel('ללא תאריך תפוגה')).toBeNull();
  });
});
