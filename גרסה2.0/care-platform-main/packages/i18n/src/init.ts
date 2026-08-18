import i18next, { type i18n } from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './resources/en.json';
import he from './resources/he.json';
import { DEFAULT_LOCALE } from './locales.js';

let initialized: i18n | null = null;

/** Idempotent — safe to call from both app entry points and from tests. */
export function initI18n(): i18n {
  if (initialized) {
    return initialized;
  }

  const instance = i18next.createInstance();
  void instance.use(initReactI18next).init({
    resources: {
      he: { translation: he },
      en: { translation: en },
    },
    lng: DEFAULT_LOCALE,
    fallbackLng: DEFAULT_LOCALE,
    interpolation: { escapeValue: false },
  });

  initialized = instance;
  return instance;
}
