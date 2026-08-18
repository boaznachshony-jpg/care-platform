import { describe, expect, it } from 'vitest';
import { getIsraeliIdValidationError, isValidIsraeliId, normalizeIsraeliId } from './israeli-id.js';

describe('Israeli ID validation', () => {
  it('accepts a valid nine-digit ID', () => {
    expect(isValidIsraeliId('123456782')).toBe(true);
  });

  it('normalizes formatting for input controls but rejects formatted raw values', () => {
    expect(isValidIsraeliId('123-456 782')).toBe(false);
    expect(getIsraeliIdValidationError('123-456 782')).toBe('characters');
    expect(normalizeIsraeliId('123-456 782')).toBe('123456782');
  });

  it('preserves an explicitly entered leading zero and requires all nine digits', () => {
    expect(normalizeIsraeliId('000000018')).toBe('000000018');
    expect(isValidIsraeliId('000000018')).toBe(true);
    expect(getIsraeliIdValidationError('18')).toBe('length');
  });

  it('strips pasted non-digits and limits input to nine digits', () => {
    expect(normalizeIsraeliId(' 123-456 782 abc 9')).toBe('123456782');
    expect(normalizeIsraeliId('038-852 562')).toBe('038852562');
    expect(isValidIsraeliId(normalizeIsraeliId('038-852 562'))).toBe(true);
  });

  it('distinguishes missing, character, length and checksum errors', () => {
    expect(getIsraeliIdValidationError('')).toBe('required');
    expect(getIsraeliIdValidationError('123-456782')).toBe('characters');
    expect(getIsraeliIdValidationError('12345678')).toBe('length');
    expect(getIsraeliIdValidationError('123456789')).toBe('checksum');
  });

  it.each(['123456789', '12345678', '1234567890', '12345A782', '', '---'])(
    'rejects invalid input: %s',
    (value) => {
      expect(isValidIsraeliId(value)).toBe(false);
    },
  );

  // ── Numeric-only enforcement edge cases ───────────────────────────────────

  it('rejects Unicode Arabic-Indic digit strings (not ASCII digits)', () => {
    // ١٢٣٤٥٦٧٨٩ are Eastern Arabic numerals — must not bypass the numeric-only rule
    expect(getIsraeliIdValidationError('١٢٣٤٥٦٧٨٩')).toBe('characters');
  });

  it('rejects inputs containing SQL-injection-style characters', () => {
    expect(isValidIsraeliId('1; DROP TABLE--')).toBe(false);
    expect(getIsraeliIdValidationError('1; DROP TABLE--')).toBe('characters');
  });

  it('rejects a 10-digit number even when leading digit is zero', () => {
    expect(getIsraeliIdValidationError('0123456782')).toBe('length');
  });

  it('treats all-zeros as passing the checksum algorithm (sum=0, divisible by 10)', () => {
    // 000000000: every product is 0, so checksum = 0 which passes.
    // Documents that this boundary is accepted — callers that need a non-trivial
    // ID must apply business-level constraints separately.
    expect(getIsraeliIdValidationError('000000000')).toBeNull();
    expect(isValidIsraeliId('000000000')).toBe(true);
  });
});
