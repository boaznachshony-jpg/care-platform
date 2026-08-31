/**
 * The published version of each binding legal document, and the shape of each
 * document's section list.
 *
 * WHY THE CONSTANT LIVES HERE
 * ---------------------------
 * This file sits next to `resources/he.json` and `resources/en.json`, which
 * hold the actual text of the terms of service and the privacy policy. That
 * adjacency is the entire point.
 *
 * The defect this replaces was not "the site has no terms". It was that the
 * billing screen's consent checkbox was `useState` and nothing else: the box
 * was ticked, the subscription was created, and no record of the acceptance
 * survived the page. Fixing that means recording a version string - and a
 * recorded version string is worse than useless if it can drift from the
 * document the customer actually read. A row saying "accepted terms 2026-08-31"
 * is evidence only for as long as it is impossible for the page to have been
 * showing something else.
 *
 * So there is exactly one string. `TERMS_DOCUMENT_VERSION` is interpolated into
 * the `updated` line rendered at the top of /terms, and the same constant is
 * what the client submits to POST /legal/acceptances. Neither the page nor the
 * request can name a version the other did not. Editing the text without
 * bumping the constant is still possible - that is a human judgement about
 * whether a change is material - but showing one version and recording another
 * is not.
 *
 * `legal-documents.test.ts` holds that property in place: it fails if either
 * resource file's `updated` string stops interpolating `{{version}}`, or hard-
 * codes a date of its own, or if the two locales disagree about which sections
 * exist.
 *
 * WHY NOT `packages/domain`
 * -------------------------
 * `PRODUCT_BILLING_TERMS_VERSION` lives in `packages/domain/src/status.ts`
 * because it is a property of the subscription aggregate: the version of the
 * billing terms in force when a payment method was attached. These constants
 * are a property of a *document*, and the document is a translation resource.
 * Putting them in the domain package would put them a package away from the
 * only text they describe, which is exactly the distance a drift needs.
 *
 * The API deliberately does not import these. It validates the shape of a
 * submitted version and records what the client sent; the guarantee that the
 * recorded string matches the rendered one is a property of the client, and is
 * tested there. Importing this module into the API would pull the i18n runtime
 * into the server bundle to buy nothing.
 */

/** Documents whose acceptance is recorded in `terms_acceptance` (migration 0043). */
export const LEGAL_DOCUMENTS = ['terms', 'privacy'] as const;
export type LegalDocument = (typeof LEGAL_DOCUMENTS)[number];

/**
 * Terms of service (תקנון), published at /terms.
 *
 * Bump when a change is material to what a customer agreed to. A typo fix is
 * not material; a change to the cancellation right, the price, the liability
 * cap or the governing forum is.
 */
export const TERMS_DOCUMENT_VERSION = '2026-08-31';

/** Privacy policy (מדיניות פרטיות), published at /privacy. Same rule. */
export const PRIVACY_DOCUMENT_VERSION = '2026-08-31';

export const LEGAL_DOCUMENT_VERSIONS: Readonly<Record<LegalDocument, string>> = {
  terms: TERMS_DOCUMENT_VERSION,
  privacy: PRIVACY_DOCUMENT_VERSION,
};

/**
 * Section counts, so the pages render `section1..sectionN` from a single
 * number and a missing translation shows up as a missing section rather than as
 * a silently shorter document.
 */
export const TERMS_SECTION_COUNT = 14;
export const PRIVACY_SECTION_COUNT = 11;
