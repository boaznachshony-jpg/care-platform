import { describe, expect, it } from 'vitest';
import { isValidIsraeliId, normalizeIsraeliId } from './israeli-id.js';

describe('Israeli ID validation', () => {
  it('accepts a valid nine-digit ID', () => {
    expect(isValidIsraeliId('123456782')).toBe(true);
  });

  it('accepts common formatting and normalizes it', () => {
    expect(isValidIsraeliId('123-456 782')).toBe(true);
    expect(normalizeIsraeliId('123-456 782')).toBe('123456782');
  });

  it('pads a valid short ID with leading zeroes', () => {
    expect(normalizeIsraeliId('18')).toBe('000000018');
    expect(isValidIsraeliId('18')).toBe(true);
  });

  it.each(['123456789', '12345678', '1234567890', '12345A782', '', '---'])(
    'rejects invalid input: %s',
    (value) => {
      expect(isValidIsraeliId(value)).toBe(false);
    },
  );
});
