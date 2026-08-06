import { describe, expect, it } from 'vitest';
import { getIsraeliIdValidationError, isValidIsraeliId, normalizeIsraeliId } from './israeli-id.js';

describe('Israeli ID validation', () => {
  it('accepts a valid nine-digit ID', () => {
    expect(isValidIsraeliId('123456782')).toBe(true);
  });

  it('removes common formatting without inventing a leading zero', () => {
    expect(isValidIsraeliId('123-456 782')).toBe(true);
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
    expect(isValidIsraeliId('038-852 562')).toBe(true);
  });

  it('distinguishes a missing value, a length error and a checksum error', () => {
    expect(getIsraeliIdValidationError('')).toBe('required');
    expect(getIsraeliIdValidationError('12345678')).toBe('length');
    expect(getIsraeliIdValidationError('123456789')).toBe('checksum');
  });

  it.each(['123456789', '12345678', '1234567890', '12345A782', '', '---'])(
    'rejects invalid input: %s',
    (value) => {
      expect(isValidIsraeliId(value)).toBe(false);
    },
  );
});
