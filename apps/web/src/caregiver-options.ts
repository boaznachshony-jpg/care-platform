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
