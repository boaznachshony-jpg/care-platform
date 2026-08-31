import { z } from 'zod';

/**
 * Recorded acceptance of the terms of service and the privacy policy
 * (migration 0043, `terms_acceptance`).
 *
 * WHY THIS EXISTS AT ALL
 * ----------------------
 * `startBillingSetupRequestSchema` already carries a `termsVersion`, and it is
 * not this. That field is a property of the subscription: which version of the
 * *billing* terms was current when a payment method was attached. It says
 * nothing about the תקנון and nothing at all about the privacy policy, which is
 * the document that matters most in a product where the account holder types in
 * a third party's passport number.
 *
 * WHY THE VERSION IS NOT A `z.literal`
 * ------------------------------------
 * `billing.ts` pins its version with `z.literal(BILLING_TERMS_VERSION)`, which
 * is right for a value the API itself owns. Here the version is the version of
 * a *document*, and the document is a translation resource: its constant lives
 * next to the text in `packages/i18n/src/legal-documents.ts`. Pinning a literal
 * here would either duplicate that constant - creating the exact second source
 * of truth the constant exists to prevent - or drag the i18n runtime into the
 * server bundle.
 *
 * So the server validates the shape and records what the client sent. The
 * guarantee that the recorded string is the string the customer saw is a
 * property of the client, where both come from one constant, and it is tested
 * there (packages/i18n/src/legal-documents.test.ts and
 * apps/web/src/pages/BillingPage.test.tsx). The date shape below is narrow
 * enough that a malformed or absent version is rejected rather than stored.
 */
export const LEGAL_DOCUMENT_NAMES = ['terms', 'privacy'] as const;
export type LegalDocumentName = (typeof LEGAL_DOCUMENT_NAMES)[number];

/** Where in the product the acceptance was collected. */
export const LEGAL_ACCEPTANCE_CONTEXTS = ['onboarding', 'billing'] as const;
export type LegalAcceptanceContext = (typeof LEGAL_ACCEPTANCE_CONTEXTS)[number];

/** A version is a publication date: `YYYY-MM-DD`, and nothing else. */
export const legalDocumentVersionSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const acceptedDocumentSchema = z
  .object({
    document: z.enum(LEGAL_DOCUMENT_NAMES),
    /**
     * Per document, not per request. The terms and the privacy policy are
     * published on their own cadence and will not stay in step: a single
     * `version` field would force one of the two rows to record a date the
     * customer was never shown the moment they diverge, which is the exact
     * failure this whole table exists to prevent.
     */
    version: legalDocumentVersionSchema,
  })
  .strict();

export const legalAcceptanceRequestSchema = z
  .object({
    /**
     * Both documents are accepted together at every point that collects them,
     * so the request takes a list. One round trip means one outcome: the
     * billing flow cannot end up having recorded the terms but not the privacy
     * policy because a second call failed.
     */
    documents: z.array(acceptedDocumentSchema).min(1).max(LEGAL_DOCUMENT_NAMES.length),
    context: z.enum(LEGAL_ACCEPTANCE_CONTEXTS),
  })
  .strict();

export type AcceptedDocument = z.infer<typeof acceptedDocumentSchema>;

export type LegalAcceptanceRequest = z.infer<typeof legalAcceptanceRequestSchema>;

export interface LegalAcceptanceRecord {
  document: LegalDocumentName;
  version: string;
  acceptedAt: string;
  context: LegalAcceptanceContext;
}

export interface LegalAcceptanceResponse {
  acceptances: LegalAcceptanceRecord[];
}
