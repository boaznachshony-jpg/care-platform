# P1 Product Differentiation Completion Wave

Baseline: `b3be5ed` (merged PR #43), inspected before implementation on 2026-08-15.

## Exact initial gap analysis

| Capability | Initial classification | Evidence found | Missing at baseline |
|---|---|---|---|
| CareDesk Score | application/domain foundation plus dashboard UI | deterministic `CaseHealthProjection`, weighted factors and dashboard card | factor provenance, authenticated projection API, canonical-case wiring and focused E2E |
| Case-aware Action AI | application/domain foundation, mock provider only | whitelisted `CaseContextSnapshot`, structured response, action vocabulary and validation | authenticated API, current UI wiring, action confirmation persistence and approved production provider |
| Smart Documents | application/domain foundation plus persistence | private upload, `Document`/`DocumentVersion`, `DocumentIntakeProposal`, typed classification/date validation and `document_intake_review` | analyze/review/confirm UI and API, canonical confirmation service, production OCR provider and E2E |
| Human Escalation | rule/UI hint only | `professional_review_required`, wizard uncertainty, task/audit foundations | durable review aggregate, authenticated lifecycle API, RLS, dashboard/case UI and E2E |

No capability was classified production-usable. AI and OCR also required external privacy,
supplier and provider configuration. Foundation code was reused rather than rebuilt.

## Completion design

### CareDesk Score

The score is derived on demand from tenant-authorized case documents and tasks. Each stable
factor has status, earned points, weight, explanation, provenance, recommended action and a
deep link. It is bounded to 0–100 and is explicitly employment-file health, not legal approval.
Routine recalculation is not persisted or audited.

### Case context and Action AI governance

The server constructs an allowlisted case snapshot only after case authorization. Provider
output must pass the structured contract, action-vocabulary check and fact-reference check.
Documents contribute metadata only; file contents are neither context nor instructions.
Mutations are executed by deterministic application services after an idempotent confirmation.
Raw prompts and responses are not durable evidence and must not enter logs or analytics.

No external provider is approved in this repository. The shipped deterministic fallback is
useful for case-file checks but does not claim generative AI availability. Set no browser key.
The capability remains **ORANGE** until privacy/supplier approval and a production server-side
adapter are configured and evidenced.

### Smart Document architecture

The approved pipeline remains private upload → untrusted extraction → typed classification →
deterministic field/date/identity validation → explicit review → confirmation → canonical
metadata, timeline and audit. Ambiguous locale dates, impossible/leap-year failures, reversed
date order, low confidence and identity mismatch block silent confirmation. Extracted text is
never treated as instructions. There is no approved OCR provider, so Smart Documents remains
**ORANGE** and manual private upload remains the safe fallback.

### Human escalation lifecycle

`professional_review_request` is the durable, tenant-owned request. It preserves category and
source provenance (`case_ai`, wizard, regulation engine, score or manual), supports
`draft → open → in_review → resolved` and cancellation, and does not imply a marketplace or
assigned professional. Resolution timestamps are database-consistent. Create/status/resolve
events are audit evidence; summaries must contain only the minimum information needed.

### Privacy and data flow

Tenant authority comes exclusively from the authenticated actor. Case authorization precedes
every projection or mutation. New tables use same-tenant foreign keys, forced RLS and both
`USING`/`WITH CHECK`. Durable state is limited to confirmed actions and professional reviews;
scores, prompts, responses, raw OCR and document text are excluded.

## 15-capability honest status

| # | Capability | Status |
|---:|---|---|
| 1 | Compliance Timeline | GREEN |
| 2 | Decision Dashboard | GREEN |
| 3 | CareDesk Score | ORANGE — API/UI exists; completion E2E evidence pending |
| 4 | Smart Documents | ORANGE — provider and confirmation UI/API incomplete |
| 5 | Case-aware AI | ORANGE — external provider not approved/configured |
| 6 | Monthly Close | GREEN |
| 7 | Family Collaboration | GREEN |
| 8 | Worker Portal | GREEN |
| 9 | Event Wizards | GREEN |
| 10 | Audit / Evidence Trail | GREEN |
| 11 | Regulation Engine | GREEN |
| 12 | Future Cost | GREEN |
| 13 | WhatsApp-first | RED |
| 14 | Human Escalation | ORANGE — durable internal workflow; full UI/E2E pending |
| 15 | Emergency Binder | RED |

## Definition of Done and provider gates

This wave is GREEN only after root and package validation, live PostgreSQL cross-tenant RLS,
desktop/mobile Playwright completion flows, preview builds, architecture/secret checks, and an
approved/configured production provider for any capability described as AI extraction or AI
assistant. Until then the status table above controls and must not be inflated.
