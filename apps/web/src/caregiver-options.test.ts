import { describe, expect, it } from 'vitest';
import { languageAfterCountryChange } from './caregiver-options.js';

describe('caregiver language suggestion', () => {
  it('updates the suggested language across consecutive country changes', () => {
    const firstLanguage = languageAfterCountryChange('', 'הפיליפינים', '');
    expect(firstLanguage).toBe('טגלוג');

    const secondLanguage = languageAfterCountryChange('הפיליפינים', 'נפאל', firstLanguage);
    expect(secondLanguage).toBe('נפאלית');
  });

  it('preserves an explicit manual language override when the country changes', () => {
    expect(languageAfterCountryChange('הפיליפינים', 'נפאל', 'אנגלית')).toBe('אנגלית');
  });
});
