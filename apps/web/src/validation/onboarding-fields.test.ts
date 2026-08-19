import { describe, expect, it } from 'vitest';
import {
  isPositiveMoney,
  isValidEmail,
  isValidIsoDate,
  isValidOrganizationName,
  isValidPassportNumber,
  isValidPersonName,
  isValidPhone,
  normalizePassportNumber,
} from './onboarding-fields.js';

describe('onboarding field validation', () => {
  it.each(['דור כהן', 'שרה-לי', "O'Connor", 'María José', 'Nguyễn Thị'])(
    'accepts an international person name: %s',
    (value) => expect(isValidPersonName(value)).toBe(true),
  );

  it.each(['123456', 'A12', '-', ''])('rejects a non-name value: %s', (value) => {
    expect(isValidPersonName(value)).toBe(false);
  });

  it('allows meaningful alphanumeric organization names', () => {
    expect(isValidOrganizationName('Care 24 בע״מ')).toBe(true);
    expect(isValidOrganizationName('Care 24 Ltd.')).toBe(true);
    expect(isValidOrganizationName('123456')).toBe(false);
  });

  it('accepts common local and international phone formatting', () => {
    expect(isValidPhone('052-123-4567')).toBe(true);
    expect(isValidPhone('+998 (90) 123-45-67')).toBe(true);
    expect(isValidPhone('12345')).toBe(false);
    expect(isValidPhone('052-ABC-4567')).toBe(false);
  });

  it('validates email, real calendar dates and positive monetary values', () => {
    expect(isValidEmail('person@example.com')).toBe(true);
    expect(isValidEmail('person@invalid')).toBe(false);
    expect(isValidIsoDate('2026-02-28')).toBe(true);
    expect(isValidIsoDate('2026-02-30')).toBe(false);
    expect(isPositiveMoney(0.01)).toBe(true);
    expect(isPositiveMoney(0)).toBe(false);
    expect(isPositiveMoney(Number.NaN)).toBe(false);
  });

  it('accepts only alphanumeric caregiver passport numbers', () => {
    expect(normalizePassportNumber(' ab-12 34! ')).toBe('AB1234');
    expect(isValidPassportNumber('AB1234567')).toBe(true);
    expect(isValidPassportNumber('123456789')).toBe(true);
    expect(isValidPassportNumber('AB-1234')).toBe(false);
    expect(isValidPassportNumber('1234')).toBe(false);
    expect(isValidPassportNumber('אב12345')).toBe(false);
  });

  // ── Visa / passport boundary lengths ─────────────────────────────────────
  it.each([
    ['5 chars (minimum)', 'A1234'],
    ['20 chars (maximum)', 'ABCDEFGH123456789012'.slice(0, 20)],
    ['all-numeric 9 chars', '123456789'],
    ['all-alpha uppercase', 'ABCDEFGHIJ'],
  ])('accepts valid foreign-worker visa/passport value: %s', (_label, value) => {
    expect(isValidPassportNumber(value)).toBe(true);
  });

  it.each([
    ['4 chars — below minimum', 'AB12'],
    ['21 chars — above maximum', 'ABCDEFGHIJ12345678901'],
    ['Hebrew letters', 'א123456'],
    ['hyphen inside', 'AB-12345'],
    ['empty string', ''],
  ])('rejects invalid visa/passport value: %s', (_label, value) => {
    expect(isValidPassportNumber(value)).toBe(false);
  });

  // ── Calendar edge cases for isValidIsoDate ────────────────────────────────
  it.each([
    ['Feb 29 in non-leap year', '2025-02-29'],
    ['Feb 29 in century non-leap year', '1900-02-29'],
    ['Apr 31 (April has 30 days)', '2026-04-31'],
    ['Jun 31 (June has 30 days)', '2026-06-31'],
    ['Sep 31 (September has 30 days)', '2026-09-31'],
    ['Nov 31 (November has 30 days)', '2026-11-31'],
    ['month 00', '2026-00-01'],
    ['month 13', '2026-13-01'],
    ['day 00', '2026-01-00'],
    ['day 32', '2026-01-32'],
    ['slash separator', '2026/02/28'],
    ['reversed DD-MM-YYYY', '28-02-2026'],
  ])('rejects impossible date — %s', (_label, value) => {
    expect(isValidIsoDate(value)).toBe(false);
  });

  it.each([
    ['2024-02-29', 'Feb 29 in standard leap year'],
    ['2000-02-29', 'Feb 29 in century divisible by 400'],
    ['2026-01-31', 'Jan 31'],
    ['2026-03-31', 'Mar 31'],
    ['2026-12-31', 'Dec 31'],
  ])('accepts real calendar boundary date %s (%s)', (value) => {
    expect(isValidIsoDate(value)).toBe(true);
  });
});
