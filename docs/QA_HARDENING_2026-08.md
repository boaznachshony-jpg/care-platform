# CareDesk QA hardening inventory and closeout

Date: 2026-08-14. Data policy: synthetic `.test` identities only; no real PII.

## Baseline and Wave 2 verification

The reviewed baseline is commit `0c458dd`, the Wave 2 closeout merge. Its first-parent history
contains the merged work for PRs #32–#38 and the Wave 2 kickoff commit `a65e533` that represents
PR #31. The closeout and Definition of Done documents are present in this baseline. No remote was
configured in the supplied checkout, so commit history and repository closeout records—not the
GitHub API—were the available sources of truth.

## Screen, route, and control inventory

| Area | Routes/screens | Forms, fields, selectors, and mutations reviewed |
| --- | --- | --- |
| Public and authentication | `/`, `/contact-us`, `/guide/direct-caregiver-employment`, `/terms/subscription`; authenticated entry and recovery states | Landing/contact CTAs; support reply email/message/honeypot; sign-in, registration, verification resend, magic link, password reset/recovery; email/password/confirmation; submit, retry, mode switch, and back navigation. |
| Employer/client list | `/app` | Client cards; add, enter, continue setup, reset, delete, family access, billing, and sign-out actions; empty and multiple-client states. |
| Onboarding | `/onboarding`, `/clients/:clientId/onboarding` | Recipient/employer/representative/caregiver names; Israeli employer ID; phones; caregiver country/language/passport; employment model radios; agreement and insurance checkboxes; employment/insurance/bureau/visa dates; base salary and rest-day rate; licensed-bureau selector and manual name, registration, address, contact, phone, and email fields; previous/continue/complete. |
| Case and dashboard | `/clients/:clientId`, `/cases/:caseId` | Setup checklist, reminder/task shortcuts, case contacts, tasks, documents, timeline, and Visa Renewal sections; case opening recipient/employer/caregiver names, relationship, care level, cities, nationality, language, and start date. |
| Tasks | `/tasks`, `/clients/:clientId/tasks`, case tasks | Title, description, due date, priority; create/edit/delete/complete/filter/retry. |
| Employee/caregiver | `/employee`, `/clients/:clientId/employee` | Caregiver name, country, language; edit/save/cancel and reload persistence. |
| Documents | `/documents`, `/clients/:clientId/documents`, case documents | Document type, issue/expiry date, note, file/media type and size; upload/download/replace/delete; blank optional expiry and rejected upload behavior. |
| Timeline and trust | `/timeline`, `/clients/:clientId/timeline`, `/trust`, `/clients/:clientId/trust` | Read-only event/audit history, filters and trust-message acknowledgement; mutation audit append behavior. |
| Payroll and national insurance | `/payroll`, `/clients/:clientId/payroll` | Salary/effective date; month range and payroll month; base salary; start date; work, leave, sick, absence, rest-day and holiday counts; rates and payments; pension, additions, dynamic extra-payment description/amount; pocket money, insurance, housing, advances and agreed deductions; expense category/frequency/amount/due date/note; report year; wizard navigation, preview/print/save/edit/delete; quarterly national-insurance creation and reporting. |
| Settings | `/settings`, `/clients/:clientId/settings` | Recipient name/ID/birth date/phone/email/health fund/address; employer name/ID/phone/email; caregiver identity/profile fields; representative details; save/cancel and persisted reload. |
| Family access | `/family` | Display name, email and manager/viewer role; invitation, role update, removal, retry and owner protection. |
| Billing | `/billing`, hosted checkout return states | Billing name/email, recurring-charge consent and terms version; begin hosted setup, return status refresh, retry and cancel subscription. Card data remains hosted and was not entered or persisted by CareDesk. |
| Contact/support | `/contact`, `/clients/:clientId/contact` and public contact dialog | Reply email, message, hidden honeypot; submit/cancel/close, keyboard focus, success and failure recovery. |
| Visa Renewal | Case Visa Renewal section | Template/current authorization/as-of date; per-step RACI assignee type and ID; contact organization/contact, channel, occurrence/follow-up datetimes, purpose/outcome, confirmation, sensitivity and visibility; renewed-document validity dates; overlap resolution; start/activity/link/review/complete actions. |
| Navigation/responsive | Desktop sidebar and mobile bottom/more navigation | RTL direction, desktop/mobile routes, menu open/close, selected state, keyboard reachability, visible labels/errors, primary-control clipping and touch-target behavior. |

Mutation endpoints inventoried: `POST /cases`; `POST /cases/:caseId/contacts`; `POST
/cases/:caseId/tasks`; `POST /cases/:caseId/tasks/:taskId/complete`; case-document upload and
download-link issuance; all six Visa Renewal start/activity/link/review/resolve/complete operations;
`PUT /workspace`; workspace-file `PUT`/`DELETE`; family invitation `POST`, role `PATCH`, removal
`DELETE`; billing setup `POST` and cancellation `DELETE`; Cardcom webhook/collection jobs; and
`POST /support/requests`.

## Validation and regression matrix

- Text: missing, empty/whitespace, trim behavior, min/max boundaries, overlong input, mixed
  Hebrew/English Unicode, punctuation, markup-like strings as inert plain data, and unknown keys.
- Identity/contact: valid synthetic Israeli IDs (`123456782`, leading-zero `038852562` and
  `000000018`), checksum/length/zero/character/punctuation failures; Israeli/local and international
  phone shapes and malformed lengths/characters; valid `.test` email plus missing/multiple `@`,
  missing/malformed domain, whitespace and 254-character boundary.
- Numbers/money: negative, zero, fractions for integer counts, oversized values, adjacent min/max,
  nonnumeric/malformed decimals, leading zeroes, scientific notation, finite-value enforcement and
  rejected-value non-persistence.
- Dates: blank optional/required behavior, ISO shape, impossible month/day, leap days, old/future
  representable dates, ordered validity ranges, follow-up ordering and reload without timezone drift.
- Workflow: required selection/consent, invalid enum/direct payload, RACI assignment boundaries,
  repeated/double submission, stale workspace version, reload/back recovery and unrelated-record
  isolation.
- Security/persistence: unauthenticated denial, actor-derived tenant authority, cross-tenant RLS,
  rejected payload non-persistence, reload survival, append-only audit records, document sensitivity,
  signed-link boundaries, and Visa Renewal completion scoped to its selected task.
- Accessibility/layout: RTL desktop and mobile projects, keyboard-accessible native controls,
  labels/error association, dialog focus, mobile navigation, control visibility and print layout.

## Findings and disposition

### Fixed

1. API schemas accepted impossible calendar strings such as `2026-02-29` because they checked only
   the `YYYY-MM-DD` shape. A shared UTC round-trip validator now protects case start, task due,
   document expiry and Visa Renewal dates while retaining valid leap days and blank optional dates.
2. Visa Renewal contact activity accepted a follow-up timestamp earlier than the activity. The
   schema now rejects reversed ordering without imposing a regulatory deadline.

### Intentionally unchanged

- No new legal expiry window, maximum historical/future date, wage rate, deduction, or National
  Insurance business rule was invented; these require product/legal authority.
- Formatted Israeli IDs are normalized at the UI boundary, while schemas that deliberately exclude
  identity-sensitive data remain unchanged. Existing checksum intent and tests are preserved.
- Phone validation permits common punctuation and 9–15 digits rather than asserting one Israeli
  carrier pattern; stricter numbering-plan rules would be a product policy change.
- Markup-like task text is retained as plain text. React escapes rendering; rejecting punctuation
  would unnecessarily weaken multilingual notes.
- Hosted Cardcom card entry, real email delivery, browser payment return, production object storage,
  and production identity-provider behavior need external sandboxes and were not exercised with
  real credentials.

## Area status

Green: public/login, clients, onboarding, dashboard/case, tasks, employee, documents, timeline,
payroll/national insurance, settings, family access, Visa Renewal, navigation/responsive, API/schema,
audit/RLS. Orange: hosted billing return, real email, production storage/identity integrations
(external environment required). Red: none.
