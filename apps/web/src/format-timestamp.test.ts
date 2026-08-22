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

  it('treats a bare YYYY-MM-DD as a local calendar day, never shifting it back', () => {
    // The spec parses "2026-08-01" as UTC midnight, which renders as 31.07 for
    // any runner west of UTC. A payment date has no time component, so the
    // calendar day the user typed must be the calendar day they see.
    expect(formatDateOnly('2026-08-01')).toMatch(/01/);
    expect(formatDateOnly('2026-08-01')).toMatch(/08/);
    expect(formatDateOnly('2026-01-01')).toMatch(/2026/);
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
