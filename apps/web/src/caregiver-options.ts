/* eslint-disable no-restricted-syntax */
export const caregiverCountries = [
  'אוזבקיסטן',
  'אוקראינה',
  'גאורגיה',
  'הודו',
  'מולדובה',
  'נפאל',
  'סרי לנקה',
  'הפיליפינים',
  'מדינה אחרת',
] as const;

export const caregiverLanguages = [
  'אוזבקית',
  'אנגלית',
  'גאורגית',
  'הינדי',
  'נפאלית',
  'רומנית',
  'רוסית',
  'טגלוג',
  'שפה אחרת',
] as const;

export function suggestedLanguage(country: string): string {
  const suggestions: Record<string, string> = {
    אוזבקיסטן: 'אוזבקית',
    אוקראינה: 'רוסית',
    גאורגיה: 'גאורגית',
    הודו: 'הינדי',
    מולדובה: 'רומנית',
    נפאל: 'נפאלית',
    'סרי לנקה': 'אנגלית',
    הפיליפינים: 'טגלוג',
  };
  return suggestions[country] ?? '';
}

export function languageAfterCountryChange(
  previousCountry: string,
  nextCountry: string,
  currentLanguage: string,
): string {
  const previousSuggestion = suggestedLanguage(previousCountry);
  const nextSuggestion = suggestedLanguage(nextCountry);
  const hasManualOverride = Boolean(currentLanguage) && currentLanguage !== previousSuggestion;
  return hasManualOverride ? currentLanguage : nextSuggestion || currentLanguage;
}
