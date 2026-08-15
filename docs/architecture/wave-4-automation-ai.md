# Wave 4 — Automation & AI architecture

## Baseline and exact gap analysis

Wave 4 started from `0b96225`, the merge commit for PR #40. The baseline contains the
Compliance Timeline, Decision Dashboard attention projection, CareDesk Score, Payroll
Analytics, 12-month Future Cost, Monthly Close, Product Intelligence projections,
`payroll_month_close` RLS persistence, and desktop/mobile Playwright contracts. Wave 4
consumes those projections; it does not replace them.

The inspection found these reusable foundations: canonical `Document` and immutable
`DocumentVersion`; private opaque storage keys and authorized signed downloads; document
expiry metadata; canonical Task and append-only Timeline/Audit services; the projection
module used by Case Health and CareDesk Score; the workflow repository and completed Visa
Renewal vertical; version/status-gated rules with source records; tenant actor resolution,
authorization and idempotency repositories; and ADR-003's server-side `AIProvider` plus
deterministic `MockAIProvider`. Available context facts already include case status,
caregiver summary, employment authorization, document expiry/compliance, insurance,
payroll close, active tasks, timeline events, workflows and approved rules.

The exact gaps were: no OCR/content extractor; no typed classification/extraction/review
contract; no extraction persistence; no deterministic locale-aware date validation; no
least-privilege case-context builder or controlled assistant actions; no event catalog,
question engine or confirmed plan record; and a rules evaluator that only status-gated a
shell, without effective-date selection, standardized outputs or surfaced provenance.
No production AI provider/environment configuration is approved.

## Smart Document Intake

The provider-independent contract separates classification, extracted fields, validation
and proposal. Every field records provenance, confidence, validation and user-confirmation
state. Dates reject impossible/unreasonable/order-invalid values and preserve ambiguous
numeric locale dates for review. Identity mismatches are highlighted and never overwrite
canonical identity. Reminders exist only when an approved rule supplies rule/version/date;
otherwise the user chooses manually. Confirmation continues through the canonical document,
task, Timeline and Audit services.

`document_intake_review` stores only durable review metadata and confirmed fields. Raw bytes
remain in private document storage. Raw OCR/provider output, prompts and responses are not
persisted or emitted to logs/analytics. Artifacts are tenant/case/document/version scoped.
Review metadata follows the case retention policy; private bytes retain their existing
document-class policy. Tests use synthetic values only.

## Case-aware Action AI and governance

There is no generic chatbot. `buildCaseContext` produces an intent-bounded whitelist and
never includes raw document content or unrestricted database access. Structured responses
must cite a supplied fact path and use a controlled action vocabulary. Unsupported/fabricated
facts fail validation. Mutating actions require user confirmation and execute via deterministic
application services. AI cannot change payroll, authorization, validity, scores, rules, audit
or legal conclusions. Uncertainty and professional review are first-class outputs.

ADR-003 remains authoritative: only `MockAIProvider` is enabled. External production
connection is **pending privacy approval and server-side configuration**. No browser secret,
API key or provider credential exists. Timeout, rate-limit, malformed/schema-invalid output,
unsupported action and low confidence fall back to the manual flow without case mutation.
Operational logs may contain purpose, timing, outcome code and provider request ID, never
content or sensitive extracted values.

## Event Wizard

The reusable catalog covers all eight requested events. Definitions supply relevant required
questions and deterministic validation. Travel is the strongest slice: ordered dates,
passport/visa validity, Visa Renewal workflow and approved travel rules are inspected. Missing
facts/rules produce uncertainty and professional-review guidance rather than invented re-entry
law. Employment-ending/death events preserve facts and point to existing payroll/monthly-close,
document, task and professional review paths; they calculate no entitlement or severance.

Preview/cancel causes no case mutation. A confirmed `event_action_plan` is idempotent and
provides durable evidence; execution must reuse canonical Task/Workflow/Timeline/Audit ports.

## Regulation Engine integration

Governed rules are data-only, versioned, effective-date aware, approved-source gated and
deterministic. Safe outputs are `create_attention`, `create_task`, `suggest_reminder`,
`timeline_event`, `wizard_guidance`, `score_factor`, and
`professional_review_required`; duplicates are removed and arbitrary code is impossible.
No new Israeli deadline, amount, formula or legal conclusion was added.

## Data flow and privacy

Browser upload → authenticated API → private storage → bounded extractor/provider → server
schema/date/action validation → review UI → explicit confirmation → canonical service →
Timeline/Audit and existing Wave 3 projections. Tenant authority always derives from the actor.
The two new tables use composite same-tenant foreign keys, ENABLE/FORCE RLS and USING/WITH
CHECK policy. AI interaction bodies are ephemeral by default.
