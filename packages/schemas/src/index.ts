/**
 * The request/response contracts shared between `apps/api` and `apps/web`.
 *
 * SCOPE DECISION (code review DOM-13) — WIDEN, NOT BOUND
 * -----------------------------------------------------
 * The review found that this package holds the eight earliest contracts, and
 * that everything added since - payroll, leave, monthly close, scenario
 * expenses, product differentiation, regulation rules, binder and evidence
 * exports, support requests, event action plans - declares its Zod schema
 * inside its own route file. The single-source-of-truth property held only for
 * the endpoints that needed it least.
 *
 * The decision is to widen this package to cover every contract the web client
 * consumes, not to narrow its stated purpose to "the case aggregate". Bounding
 * it would be cheaper and it would be wrong: the mismatch is already
 * load-bearing. `apps/web/src/payroll-calculation.ts` and `mvp-storage.ts` name
 * the same money `saturdayPay`, `otherAddition`, `medicalInsuranceDeduction`
 * and `housingDeduction`, while `apps/api/src/routes/payroll-entries.ts` calls
 * it `paidRestDays`, `restDayRate`, `pocketMoney` and `agreedDeductions`, and
 * `apps/web/src/product-intelligence.ts` exists only to translate between the
 * two by hand, in the layer that decides what a caregiver gets paid. Two
 * vocabularies for one payment is not a packaging problem that a narrower
 * charter makes go away.
 *
 * That widening is NOT done here. Moving the payroll/leave/close/expense
 * schemas and reconciling the two field vocabularies is a separate change with
 * its own tests, because renaming money fields across a running product is
 * exactly the kind of edit that must not ride along with anything else.
 * Until then: a new endpoint the web client calls declares its schema here, and
 * an existing route-local schema is moved when that route is next touched.
 */
export * from './api-error.js';
export * from './employment-case.js';
export * from './case-contacts.js';
export * from './case-tasks.js';
export * from './case-documents.js';
export * from './case-medications.js';
export * from './case-caregiver.js';
export * from './workspace.js';
export * from './family-access.js';
export * from './billing.js';
export * from './legal-acceptance.js';
export * from './visa-renewal.js';
export * from './date.js';
