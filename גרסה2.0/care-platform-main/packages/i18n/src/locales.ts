export const SUPPORTED_LOCALES = ['he', 'en'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: SupportedLocale = 'he';

const RTL_LOCALES: ReadonlySet<SupportedLocale> = new Set(['he']);

/** Hebrew and RTL are first-class (Constitution §8) — this drives `dir` at the document root. */
export function isRtlLocale(locale: SupportedLocale): boolean {
  return RTL_LOCALES.has(locale);
}

export function directionFor(locale: SupportedLocale): 'rtl' | 'ltr' {
  return isRtlLocale(locale) ? 'rtl' : 'ltr';
}
