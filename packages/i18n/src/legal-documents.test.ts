import { describe, expect, it } from 'vitest';
import en from './resources/en.json';
import he from './resources/he.json';
import {
  LEGAL_DOCUMENTS,
  LEGAL_DOCUMENT_VERSIONS,
  PRIVACY_DOCUMENT_VERSION,
  PRIVACY_SECTION_COUNT,
  TERMS_DOCUMENT_VERSION,
  TERMS_SECTION_COUNT,
} from './legal-documents.js';

/**
 * These tests exist to hold one property in place: the version string recorded
 * in `terms_acceptance` (migration 0043) cannot differ from the version string
 * the customer saw at the top of the page.
 *
 * That property survives only while the `updated` line is produced by
 * interpolating the constant rather than by someone typing a date into the
 * resource file. The moment a translator "helpfully" writes the date inline,
 * the page and the recorded row are free to drift, and nobody finds out until
 * the acceptance record is needed - which is to say, in a dispute. So a
 * hard-coded date in `updated` is a test failure, in both locales.
 */

/** The resource objects are precisely typed from JSON; loosen only for the numbered lookups. */
const asStrings = (page: object): Record<string, string | undefined> =>
  page as unknown as Record<string, string | undefined>;

const pages = {
  terms: {
    sections: TERMS_SECTION_COUNT,
    version: TERMS_DOCUMENT_VERSION,
    he: he.public.terms,
    en: en.public.terms,
  },
  privacy: {
    sections: PRIVACY_SECTION_COUNT,
    version: PRIVACY_DOCUMENT_VERSION,
    he: he.public.privacy,
    en: en.public.privacy,
  },
} as const;

describe('legal document versioning', () => {
  it('exposes a version for every recorded document', () => {
    expect([...LEGAL_DOCUMENTS]).toEqual(['terms', 'privacy']);
    expect(LEGAL_DOCUMENT_VERSIONS).toEqual({
      terms: TERMS_DOCUMENT_VERSION,
      privacy: PRIVACY_DOCUMENT_VERSION,
    });
    for (const version of Object.values(LEGAL_DOCUMENT_VERSIONS)) {
      expect(version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  for (const [name, page] of Object.entries(pages)) {
    for (const locale of ['he', 'en'] as const) {
      it(`renders the ${name} version from the constant in ${locale}`, () => {
        // The whole anti-drift device: one string, interpolated.
        expect(page[locale].updated).toContain('{{version}}');
        // ...and no date of its own to compete with it.
        expect(page[locale].updated).not.toMatch(/\d{4}-\d{2}-\d{2}/);
      });

      it(`says on the ${name} page in ${locale} that a lawyer has not yet reviewed it`, () => {
        const pending = locale === 'he' ? /עורך\/ת דין/ : /pending review by a lawyer/i;
        expect(page[locale].updated).toMatch(pending);
      });
    }
  }
});

describe('legal document resources', () => {
  for (const [name, page] of Object.entries(pages)) {
    it(`has ${page.sections} numbered sections for ${name} in both locales`, () => {
      for (const locale of ['he', 'en'] as const) {
        const text = asStrings(page[locale]);
        for (let index = 1; index <= page.sections; index += 1) {
          expect(text[`section${index}Title`], `${locale} section${index}Title`).toBeTruthy();
          expect(text[`section${index}Body`], `${locale} section${index}Body`).toBeTruthy();
        }
        // A section beyond the declared count is never rendered, so it would be
        // text nobody agreed to that nobody can see.
        expect(text[`section${page.sections + 1}Title`]).toBeUndefined();
      }
    });

    it(`keeps the ${name} key set identical in Hebrew and English`, () => {
      expect(Object.keys(page.en).sort()).toEqual(Object.keys(page.he).sort());
    });
  }

  it('carries the operator details a paid Israeli consumer service must publish', () => {
    for (const locale of ['he', 'en'] as const) {
      expect(pages.terms[locale].section1Body, locale).toContain('056543507');
      expect(pages.terms[locale].section1Body, locale).toContain('boaz.nachshony@gmail.com');
      expect(pages.privacy[locale].section1Body, locale).toContain('056543507');
      // No postal address was supplied. A marked placeholder is the honest
      // representation; an invented address would be a false statement in a
      // document whose entire value is that it is true.
      expect(pages.terms[locale].section14Body, locale).toContain('[כתובת לפניות — להשלמה]');
      expect(pages.privacy[locale].section11Body, locale).toContain('[כתובת לפניות — להשלמה]');
    }
  });

  it('names Tel Aviv-Yafo and Israeli law as the forum', () => {
    expect(pages.terms.he.section13Body).toContain('תל אביב-יפו');
    expect(pages.terms.en.section13Body).toMatch(/Tel Aviv-Yafo/);
    expect(pages.terms.en.section13Body).toMatch(/State of Israel/);
  });

  it('names every sub-processor and the storage region in the privacy policy', () => {
    for (const locale of ['he', 'en'] as const) {
      const body = pages.privacy[locale].section6Body;
      for (const processor of ['Supabase', 'Vercel', 'Cardcom', 'Resend']) {
        expect(body, `${locale}: ${processor}`).toContain(processor);
      }
      expect(body, locale).toMatch(locale === 'he' ? /פרנקפורט/ : /Frankfurt/);
    }
  });

  it('places the lawful basis for the caregiver data on the account holder', () => {
    expect(pages.privacy.he.section3Body).toContain('בסיס חוקי');
    expect(pages.privacy.en.section3Body).toMatch(/lawful basis/i);
    expect(pages.terms.he.section6Body).toContain('בסיס חוקי');
  });
});
