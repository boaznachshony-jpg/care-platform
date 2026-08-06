import { describe, expect, it } from 'vitest';
import {
  isPositiveMoney,
  isValidEmail,
  isValidIsoDate,
  isValidOrganizationName,
  isValidPersonName,
  isValidPhone,
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
});
