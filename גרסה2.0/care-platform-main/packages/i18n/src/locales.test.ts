import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, directionFor, isRtlLocale } from './locales.js';

describe('locale direction', () => {
  it('defaults to Hebrew (Constitution §8: RTL-first, not post-processing)', () => {
    expect(DEFAULT_LOCALE).toBe('he');
    expect(isRtlLocale(DEFAULT_LOCALE)).toBe(true);
    expect(directionFor(DEFAULT_LOCALE)).toBe('rtl');
  });

  it('treats English as LTR', () => {
    expect(directionFor('en')).toBe('ltr');
  });
});
