# CareDesk verified product gap analysis and next delivery wave

Status: **PROPOSED — not implemented**  
Analysis timestamp: **2026-08-16 08:00 Asia/Jerusalem (UTC+03:00)**

## A. Verified baseline

- Remote `main`: `81ef69289d1bc9af7bea1136cc79055b40e87373`.
- PR #45 is merged at that SHA (merged 2026-08-16 04:48:31 UTC).
- GitHub required quality jobs are complete/success: migration and architecture guardrails; build
  and typecheck; unit, integration and accessibility tests; format and lint; secret scan; live
  PostgreSQL RLS integration; Playwright; and the aggregate quality gate.
- Both CodeQL jobs (`actions` and `javascript-typescript`) are complete/success.
- Vercel Web and API production deployment statuses are success.
- This review therefore has no post-merge check blocker. These statuses describe the baseline
  commit, not this documentation branch.

The classification below is deliberately stricter than the historical GREEN/ORANGE shorthand.
`COMPLETE` requires a verifiable canonical, authorized end-to-end path and appropriate automated
evidence. A local-storage screen, database table, projection, mock/deterministic fallback, or unit
test cannot establish completion by itself.

## B. Fifteen-capability status matrix

| # | Capability | Classification | Verified layers | Exact missing layers / completion evidence |
|---:|---|---|---|---|
| 1 | Compliance Timeline | **PARTIAL** | Deterministic application projection; local UI; canonical case Timeline persistence/service, forced RLS and API paths exist; projection and UI tests plus general Playwright navigation | The visible compliance projection reads transitional MVP storage rather than the canonical tenant case API. No Playwright flow proves a canonical change synchronizes the compliance view, Timeline and Audit. |
| 2 | Decision Dashboard | **PARTIAL** | Attention/health projections, dashboard cards and unit/component coverage; authenticated case-health API exists | Dashboard still calculates from MVP profile/storage and is not wired to the authenticated health API. Ownership grouping is incomplete and there is no canonical API-to-dashboard E2E. |
| 3 | CareDesk Score | **PARTIAL** | Bounded deterministic model with factor provenance; authorized/rate-limited API; dashboard UI; validation and route/unit tests | UI uses the separate local projection, not the API. Routine recalculation is neither evidence-bearing nor audited, and focused canonical Playwright coverage is absent. It is file health, not legal approval. |
| 4 | Smart Document AI | **PARTIAL** | Private canonical upload/version model, tenant RLS, extraction contracts, deterministic validation, review persistence and analyze/review UI/API tests | No approved production OCR/AI adapter; the extraction path is not production-capable. Canonical confirmation/E2E evidence and full Timeline/Audit synchronization are not proven across the browser path. |
| 5 | Case-aware Action AI | **PARTIAL** | Allowlisted case context, response/action validation, authorized/rate-limited assistant API, UI panel, idempotency requirement and route tests | Only a deterministic fallback is connected; no approved external provider. Checklist idempotency is process memory rather than durable, the UI/canonical mutation flow lacks Playwright evidence, and approved rule context is empty. |
| 6 | Monthly Close | **PARTIAL** | Deterministic close validation; append-only tenant table with forced RLS and evidence references; application tests; local payroll close UI | The browser writes `mvp-storage`, not `payroll_month_close`; no authenticated close API connects UI to canonical receipt/Timeline/Audit. No canonical Playwright close/replay test. Worker acknowledgement remains separate/incomplete. |
| 7 | Family Collaboration | **PARTIAL** | Tenant memberships and invitations, authenticated family-access API/UI, manager authorization, responsibility persistence, RLS and unit/route/component tests | Employer responsibility/task-assignment UI is incomplete, material changes do not have complete human Timeline coverage, and no Playwright collaboration/invitation/revocation flow proves the whole path. |
| 8 | Worker Portal | **PARTIAL** | Hashed expiring invitation, server-derived worker access, tenant-scoped projection/request/payment acknowledgement APIs, distinct mobile UI, validation/idempotency and tests | Signed worker document download, preference writes, governed leave balance, durable payment amount, employer handling UI and complete notification/Timeline wiring are missing. There is no worker Playwright journey. |
| 9 | Event Wizards | **PARTIAL** | Eight-event typed catalog, deterministic plan generation/validation, persisted `event_action_plan` with forced RLS, and case UI/unit tests | Plans are not fully committed through canonical task/workflow/Timeline/Audit adapters. Idempotent authenticated execution and a Playwright event-to-evidence path are absent. |
| 10 | Audit / Evidence Trail | **PARTIAL** | Append-only `audit_event`, minimal metadata contract, forced tenant RLS, least-privilege inserts, denial auditing, durable PostgreSQL adapter, RLS/integration/unit coverage | Coverage is not complete for Wave 3–6 product mutations (notably local storage, worker/collaboration and binder export). There is no unified evidence receipt/export demonstrating cross-capability synchronization. |
| 11 | Regulation Engine | **PARTIAL** | Versioned deterministic evaluation contracts and persistence, approved-rule boundary, RLS, application tests and wizard integration | Authoritative reviewed content is narrow; assistant API supplies no approved rule facts. Missing broader rule lifecycle/admin delivery and canonical UI/API/E2E evidence for evaluation-to-task/Timeline/Audit effects. |
| 12 | Future Cost | **PARTIAL** | Deterministic validated 12-month model, actual/forecast/unknown provenance, component detail, three-month/annual totals, reserve guidance and unit/UI tests | UI inputs and close facts come from transitional MVP storage; no canonical tenant API/persistence path or Playwright scenario proves closed-payroll replacement and isolation. Scenario assumptions are intentionally transient. |
| 13 | WhatsApp-first Engagement | **FOUNDATION ONLY** | Channel/consent/preference/intents/attempt models, forced-RLS tables, idempotent orchestration and disabled-adapter tests | No approved WhatsApp provider, webhook verification, delivery/retry reconciliation, preference UI/API, production credentials or E2E. The product correctly reports the channel disabled. |
| 14 | Human Escalation | **PARTIAL** | Durable tenant-owned request, forced RLS, authorized/rate-limited create/list API, idempotency key and audit creation, case UI and route tests | No status/resolve API despite the modeled lifecycle, provider assignment/marketplace, review package, commercial integration or focused Playwright. The memory fallback is non-durable and only creation is audited. |
| 15 | Emergency Binder | **PARTIAL** | Authenticated employer route, explicit presets/selection, RTL A4 browser print, missing-value labels and component tests | It reads transitional local data and is a client print view. No server manifest/PDF, durable export audit, authorization API, secure hash-backed sharing, access audit, rate limiting, attachment bundle, RLS integration or Playwright export test. |

**Totals:** COMPLETE 0; PARTIAL 14; FOUNDATION ONLY 1; NOT IMPLEMENTED 0.

This does not mean the product has no valuable delivered functionality. It means none of these
broad product labels has repository evidence for every layer implied by “end-to-end complete.”

## C. Exact cross-cutting gaps and Waves 3–6 review

### Highest-impact gaps

1. **Split source of truth:** Timeline, dashboard, score, monthly close, forecast and binder surfaces
   still consume `mvp-storage`, while normalized PostgreSQL/API implementations exist alongside
   them. The two paths can disagree and the local path bypasses tenant RLS and durable evidence.
2. **Wave 5 is unfinished:** PR #42 delivered persistence/application foundations and PR #43 made
   a worker slice reachable, but employer ownership UI, signed downloads, preferences,
   notifications, Timeline completeness and worker Playwright remain missing.
3. **Automation stops before canonical execution:** document, assistant and event-plan contracts
   are useful, but external providers are gated and event/checklist confirmation is not uniformly
   durable/idempotent/evidence synchronized.
4. **Audit coverage is uneven:** canonical services audit many mutations, while MVP local writes,
   binder output and parts of collaboration/escalation cannot produce durable evidence receipts.
5. **Provider/commercial boundaries are real blockers to provider-backed claims:** WhatsApp,
   production OCR/AI and professional assignment cannot be called complete without supplier,
   privacy, credential, webhook and operational approval outside this repository.

### Duplication, transitional paths and unfinished wiring

- `DashboardPage`, `TimelinePage`, `PayrollIntelligence` and `EmergencyBinderPage` form a
  transitional local-storage product path parallel to normalized repositories and authenticated
  APIs. It is not dead code because it is the current visible experience, but it is not a target
  for new canonical product state.
- Case health is calculated independently in the web product-intelligence facade and in the API.
  Until the UI consumes one canonical contract, factor drift is possible.
- Monthly-close SQL is durable and append-only, yet the runnable close control writes a distinct
  local receipt. This is the clearest unfinished Wave 3 wiring.
- Wave 5 has one canonical notification model and one Resend adapter (good reuse), but high-value
  events and preference mutation remain unwired. Disabled phone adapters are intentional, not
  production delivery.
- Professional review has a PostgreSQL aggregate but also a process-memory fallback. The fallback
  is acceptable for tests/local development only and cannot support a production lifecycle.
- Historical documents overstate several capabilities as GREEN. The matrix in this document
  supersedes those broad labels until the missing paths are evidenced; it does not rewrite history.
- No code was removed or refactored in this analysis PR.

## D. Proposed next-wave scope

Governance supports numbered Waves, but Wave 5 is explicitly not closed. Therefore the smallest
coherent next delivery should be named **Wave 5 closure — canonical collaboration and evidence**,
not Wave 7.

1. **Complete employer collaboration:** responsibility/task assignment and worker-request handling
   UI backed only by authenticated, manager-authorized APIs.
2. **Complete worker document and preference journeys:** short-lived authorized downloads plus
   locale/channel/consent preference mutations; keep WhatsApp/SMS disabled.
3. **Wire durable engagement and evidence:** trusted high-value events to canonical notification
   intents/attempts, with complete human Timeline and minimal append-only Audit effects.
4. **Add end-to-end proof:** desktop employer and mobile worker Playwright journeys, replay/
   idempotency checks, and live cross-tenant RLS coverage for every touched table/route.

This closes an already-started user loop without buying or approving a provider and avoids adding
new state to the transitional local-storage path.

## E. Explicit non-goals

- WhatsApp/SMS provider enablement, production OCR/generative AI, or a professional marketplace.
- Emergency Binder server export/sharing, Future Cost canonicalization, or new regulation content.
- Replacing Supabase authentication or inventing worker credentials.
- Migrating/removing all MVP storage, broad refactors, new product capabilities, or relabelling the
  proposed wave complete in its implementation PR.
- Sending document attachments or storing rendered message bodies/provider secrets.

## F. Architecture and security constraints

- PostgreSQL normalized aggregates remain canonical; do not dual-write without an approved
  reconciliation/cutover plan.
- Derive tenant, case and worker scope server-side from the authenticated actor/access relation.
  Never accept tenant or case authority from a worker payload.
- Every new/changed tenant table requires same-tenant foreign keys, `ENABLE`/`FORCE RLS`, both
  `USING`/`WITH CHECK`, least privilege and cross-tenant tests.
- Document download requires active worker access plus explicit worker visibility. Return only a
  short-lived signed URL; do not expose storage keys.
- Mutations require validation, authorization and durable tenant-scoped idempotency. Process memory
  is not a production idempotency store.
- Use canonical Timeline for human meaning and append-only Audit for security evidence. Provider
  attempts remain out of Timeline and no sensitive message/document content enters logs or audit.
- Email uses the existing server-only Resend adapter. Phone channels stay fail-closed until a
  separately approved provider/webhook design and affirmative consent exist.

## G. Acceptance criteria

- A manager can assign/reassign an active same-tenant family member and handle a worker request;
  unauthorized roles and cross-tenant identifiers fail without state change.
- An activated worker sees only their server-derived case, can download only explicitly visible
  documents through expiring links, and can update supported communication preferences/consent.
- Supported collaboration events create one intent per idempotency key, localize from the stored
  preference, record provider evidence without content, and never report disabled phone delivery.
- Responsibility, request, preference and document-access events have the approved Timeline/Audit
  behavior and remain consistent after refresh/retry.
- All employer and worker states are canonical PostgreSQL/API states; no new product write uses
  local storage.

## H. Required tests

- Domain/application unit tests for transitions, consent selection and idempotent orchestration.
- API integration tests for validation, role boundaries, replay and safe errors.
- PostgreSQL integration tests for same-tenant constraints, forced RLS, worker bootstrap boundary,
  append-only evidence and cross-tenant denial.
- Storage tests for explicit visibility and signed-link expiry/no raw-key disclosure.
- Resend/disabled-channel adapter tests, including safe retries and redacted evidence.
- React accessibility/component tests for employer and mobile worker states.
- Playwright: invite/activate; assign/handle request; visible-document download denial/allow;
  preference update; retry without duplicate intent; desktop and mobile layouts.
- Root format, lint, build, typecheck, unit/integration/accessibility, secret scan and CodeQL gates.

## I. Definition of Done

The wave may be marked complete only when all four deliverables and acceptance criteria are merged,
all required tests are green against a live PostgreSQL instance, Web/API previews succeed, no
critical/high security finding remains, documentation matches behavior, and recovery evidence has
been recorded. Mock providers, local state, a green unit suite alone, or an unmerged branch do not
satisfy this definition.

## J. Rollback and recovery

- Additive migrations must be forward-compatible with the current Web/API during deployment.
  Prefer disabling new routes/event producers before database rollback.
- Notification producers need a feature flag/kill switch. Retrying after recovery must reuse the
  durable idempotency key and must not duplicate delivery.
- Never delete append-only intent, attempt, Timeline, Audit or acknowledgement evidence during
  rollback. Correct with new evidence.
- Signed URLs must remain short-lived and revocable by access revocation. Rotate provider secrets
  rather than committing them or persisting them in recovery artifacts.
- Database restore and reconciliation must verify tenant counts, worker-access relationships,
  intent/attempt pairs and audit references before re-enabling delivery.

