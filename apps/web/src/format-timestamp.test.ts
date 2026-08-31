import { describe, expect, it } from 'vitest';
import { formatDateOnly, formatDateTime, toIsoAttribute } from './format-timestamp';

describe('formatDateTime', () => {
  it('renders an ISO timestamp as an Israeli date with a 24-hour clock', () => {
    const formatted = formatDateTime('2026-08-21T11:32:00.000Z');
    expect(formatted).toBeTruthy();
    // Locale data can differ between environments, so assert on the parts we
    // control rather than on an exact separator string.
    expect(formatted).toMatch(/21/);
    expect(formatted).toMatch(/08/);
    expect(formatted).toMatch(/2026/);
    expect(formatted).toMatch(/\d{2}:\d{2}/);
    expect(formatted).not.toMatch(/AM|PM/i);
  });

  it('renders Israel time regardless of the reader’s own time zone', () => {
    // 11:32 UTC on 21 August is 14:32 in Israel (IDT, UTC+3). Two people
    // looking at the same payroll close - one in Tel Aviv, one abroad - must
    // read the same wall clock, because the stamp exists to settle
    // disagreements about when the action was taken.
    expect(formatDateTime('2026-08-21T11:32:00.000Z')).toMatch(/14:32/);
    // And across the date line, where an unpinned formatter would roll the day.
    expect(formatDateTime('2026-08-21T22:00:00.000Z')).toMatch(/22\.08|22\/08/);
  });

  it('accepts Date objects and epoch numbers', () => {
    expect(formatDateTime(new Date('2026-01-05T08:00:00Z'))).toMatch(/2026/);
    expect(formatDateTime(Date.parse('2026-01-05T08:00:00Z'))).toMatch(/2026/);
  });

  it('returns null for missing or unparseable values so callers can omit the row', () => {
    expect(formatDateTime(null)).toBeNull();
    expect(formatDateTime(undefined)).toBeNull();
    expect(formatDateTime('')).toBeNull();
    expect(formatDateTime('not-a-date')).toBeNull();
  });
});

describe('formatDateOnly', () => {
  it('omits the time for date-only fields', () => {
    const formatted = formatDateOnly('2026-08-21T12:00:00.000Z');
    expect(formatted).toMatch(/21/);
    expect(formatted).toMatch(/2026/);
    expect(formatted).not.toMatch(/\d{2}:\d{2}/);
  });

  it('keeps a bare YYYY-MM-DD on the day the user typed, in either direction', () => {
    // Both naive readings shift the day for someone: UTC midnight renders as
    // 31.07 west of UTC, and local midnight renders as 31.07 once converted to
    // Israel time from far enough east. Midday UTC clears both boundaries.
    expect(formatDateOnly('2026-08-01')).toMatch(/01\.08|01\/08/);
    expect(formatDateOnly('2026-01-01')).toMatch(/2026/);
    // New Year's Day is the strictest case: a shift here changes the year too.
    expect(formatDateOnly('2026-01-01')).toMatch(/01\.01|01\/01/);
    expect(formatDateOnly('2026-12-31')).toMatch(/31\.12|31\/12/);
  });

  it('returns null for invalid input', () => {
    expect(formatDateOnly('nope')).toBeNull();
  });
});

describe('toIsoAttribute', () => {
  it('keeps full precision for the datetime attribute', () => {
    expect(toIsoAttribute('2026-08-21T11:32:00.000Z')).toBe('2026-08-21T11:32:00.000Z');
  });

  it('returns null for invalid input', () => {
    expect(toIsoAttribute('nope')).toBeNull();
  });
});
