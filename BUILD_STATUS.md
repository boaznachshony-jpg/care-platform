# CareDesk build status

## Canonical payroll cutover candidate (2026-08-17)

The authenticated case page now contains the canonical payroll-entry editor with optimistic locking, explicit conflict recovery, and a user-confirmed legacy preparation path that does not delete or dual-write MVP data. Future Cost precedence is closed `payroll_month_close`, then open `payroll_entry`, then deterministic forecast/unknown. Local and hosted validation evidence is still required before this candidate is production-ready.

Status date: **2026-08-16**

## Wave 3 canonical Product Intelligence closure (2026-08-16)

- Timeline, Dashboard and CareDesk Score now consume authenticated, case-scoped canonical API contracts.
- Monthly Close persists only through PostgreSQL with manager authorization, durable idempotency, a human Timeline event and minimal Audit evidence.
- Closed payroll actual snapshots are server-reconstructable for Future Cost; historical receipts without snapshots remain explicitly `UNKNOWN`.
- Open payroll/scenario inputs remain isolated in MVP storage pending a canonical payroll-entry aggregate; no monthly-close state is written there.
- PR #48 merged at `a97f61f`; the post-merge CI and Push-on-main workflows succeeded for that exact
  SHA. Compliance Timeline, Decision Dashboard, CareDesk Score and Monthly Close therefore meet the
  strict end-to-end definition. Future Cost remains partial while open payroll/scenario inputs use
  transitional storage. The final 15-capability assessment and remaining launch gates are recorded
  in `docs/governance/final-product-gap-and-production-readiness.md`.

## Wave 5 canonical collaboration implementation (2026-08-16)

- Employer assignment, task ownership and request handling are wired to authenticated canonical APIs with durable replay receipts and Timeline/Audit effects.
- Worker-visible documents use active server-derived portal access and short-lived signed links; communication locale/email preferences persist canonically.
- WhatsApp and SMS remain fail-closed. No provider delivery is claimed and no new product writes use MVP/local storage.
- The merged implementation has successful post-merge main CI, but strict capability closure is not
  claimed: focused employer/worker Playwright journeys and production identity/storage configuration
  remain outstanding. Family Collaboration and Worker Portal are therefore PARTIAL.

## Post-Wave 6 verified capability review (2026-08-16)

Baseline `81ef692` is merged PR #45. Required CI, both CodeQL analyses and both Vercel production
deployments were verified successful before planning. A strict repository-layer review found **0
COMPLETE, 14 PARTIAL, 1 FOUNDATION ONLY and 0 NOT IMPLEMENTED** among the agreed broad product
capabilities. Historical GREEN labels describe delivered slices, not current end-to-end completion.
The evidence matrix, exact gaps, proposed **Wave 5 closure — canonical collaboration and evidence**,
acceptance criteria and Definition of Done are in
`docs/governance/next-delivery-wave-gap-analysis.md`. That proposed wave is not implemented or
complete.

## Wave 6 financial planning and binder pass (2026-08-15)

Future Cost now distinguishes closed-payroll actuals from forecasts and unknown values, exposes
inspectable components, rejects unsafe amounts, and provides three-month/annual totals plus clearly
labelled planning reserve guidance. An authenticated Emergency Binder route adds reviewed presets,
explicit document selection and RTL A4 print/PDF output. Human Escalation remains honestly ORANGE:
PR #44 request persistence exists, but no provider marketplace or assignment is claimed. The gap
analysis and secure-export prerequisites are in
`docs/architecture/wave-6-financial-binder-escalation.md`.

## P1 Product Differentiation Completion Wave (2026-08-15)

Baseline `b3be5ed` contains merged PR #43 and all Wave 3–5 foundations. The exact pre-code gap
analysis, methodology, governance, privacy flow, provider gates, escalation lifecycle and honest
15-capability review are recorded in
`docs/architecture/product-differentiation-completion.md`. This change adds factor provenance,
authenticated case-health and grounded-assistant APIs, confirmed checklist execution, and forced-
RLS professional-review persistence. External AI/OCR is not approved or configured; those
capabilities remain ORANGE, and this document does not relabel their foundations as complete.

## Wave 3 — Product Intelligence

Implementation baseline: `d3d15cc` (PRs #31–#39 verified in local history). Shared Timeline, attention, explainable score, payroll analytics, 12-month forecast and monthly-close implementation is present. Hosted PostgreSQL, Playwright and CI evidence must be green before closeout; Wave 3 is therefore not yet marked complete.

Current Wave 2 baseline: `main` after merged PRs #31 through #37
Sprint 0 closeout baseline: `main` after merged PRs #25, #26, #27, and #28
Previous architecture-review baseline (retained for history): `main` at `0c6acee`
Previous recovery baseline (retained for history): `main` at `3eaee63`

## Sprint 0 status

**Complete.** Sprint 0 delivered the engineering and governance foundation required
before product workflow delivery.

The completed scope comprised four coordinated tracks:

- **Architecture and governance:** canonical data architecture, authority order,
  migration governance, legacy mapping, rollback/reconciliation rules, and
  architecture guardrails.
- **Database and RLS hardening:** normalized database foundation, forced
  tenant-scoped row-level security, least-privilege access, cross-tenant
  integrity controls, append-only audit protection, and executable RLS checks.
- **API and security hardening:** authorization and tenant-context enforcement,
  safer request handling, security controls, and operational observability.
- **QA and CI guardrails:** migration and architecture checks, static analysis,
  build/typecheck, unit/integration/accessibility tests, PostgreSQL RLS
  integration, desktop/mobile end-to-end tests, secret scanning, and a required
  aggregate quality gate.

## Wave 2 status

**Complete.** Wave 2 delivered the governed Visa Renewal workflow end to end.
The implementation now includes versioned rule/evidence contracts, canonical
workflow persistence, forced tenant RLS, authenticated/idempotent API commands,
contact activity, renewed-authorization linkage without history overwrite,
overlap-review handling, completion validation, synchronized task/Timeline/Audit
side effects, and accessible RTL Web presentation.

Wave 2 was delivered through separately reviewed PRs #31 through #37. The final
application/API slice was merged in PR #37. Its protected CI run completed with
all required jobs green, including migration/architecture guardrails, unit and
integration tests, build/typecheck, format/lint, secret scan, live PostgreSQL RLS
integration, Playwright end-to-end, and the aggregate quality gate.

## Canonical architecture decisions

- Normalized PostgreSQL aggregates are the canonical persistence target.
- `EmploymentCase` is the central employment aggregate.
- `document` and `document_version` are the canonical document model.
- `tenant_workspace`, `workspace_file`, `MvpClient`, and `MvpProfile`
  are transitional compatibility structures, not targets for new product data.
- Each datum has one declared writer in every migration phase; undefined dual
  writes are prohibited.
- Tenant isolation is enforced through API authorization, least-privilege
  database roles, forced RLS, and tenant-consistent relationships.
- Sensitive identifiers must not be migrated to plaintext columns.
- Legacy sunset, backfill, cutover, and destructive removal require explicit
  evidence and separately approved gates.

## Recovery summary

The repository is substantially ahead of the older milestone documentation.
Milestone 0, Sprint 0, and Wave 2 are complete; the project must not be
bootstrapped again. The current baseline contains a React web application,
Fastify API, PostgreSQL/Supabase persistence, tenant isolation, authentication,
billing, case management, documents, family access, support requests, payroll
records, national-insurance tracking, the full governed Visa Renewal workflow,
and automated tests.

## Included in this E2E candidate

- Responsive RTL shell for desktop, tablet, and mobile.
- Dashboard, tasks, employee, documents, timeline, payroll, settings, and case flows.
- Governed Visa Renewal start/list/read/progress/completion flows.
- Persisted contact activity and follow-up metadata.
- Renewed-authorization linkage that preserves prior authorization history.
- Explicit overlap-review lifecycle.
- Completion validation with synchronized workflow/task/Timeline/Audit effects.
- Vercel-compatible Fastify default export.
- Workspace dependency builds before Web/API builds.
- Unit, integration, accessibility, PostgreSQL RLS, and Playwright E2E coverage.
- CI jobs for quality checks, E2E, RLS integration, and secret scanning.
- CORS configuration for the production Web domain.
- Supabase authentication and authenticated workspace recovery.
- Employment onboarding and employer/workspace switching.
- Persisted employment cases, contacts, tasks, timeline, and documents.
- Family-member invitation and access management.
- Subscription billing integration and account bootstrap.
- Payroll records, printable reports, and quarterly national-insurance tracking.
- Renewal-date follow-up task generation.
- Private in-app support requests.

## Current delivery state

| Area                                     | State                                                                        |
| ---------------------------------------- | ---------------------------------------------------------------------------- |
| Repository foundation and CI             | Complete                                                                     |
| Sprint 0 architecture and governance     | Complete                                                                     |
| Database and RLS hardening               | Complete                                                                     |
| API and security hardening               | Complete                                                                     |
| QA and CI guardrails                     | Complete                                                                     |
| Web and API application shells           | Complete                                                                     |
| Authentication and workspace persistence | Implemented                                                                  |
| Employment case foundation               | Implemented                                                                  |
| Contacts, tasks, timeline, and documents | Implemented                                                                  |
| Family access                            | Implemented                                                                  |
| Billing                                  | Implemented                                                                  |
| Payroll record workflow                  | Implemented; professional validation still blocks authoritative calculations |
| Visa renewal                             | Wave 2 complete end to end                                                   |
| External AI                              | Disabled by design pending privacy approval                                  |

## Delivery outlook

Wave 2 is closed. Any next product-delivery phase must be separately governed by
`docs/SOURCE_OF_TRUTH.md`, accepted ADRs, the synchronization matrix, and an
explicit Definition of Done before implementation begins.

The previously recorded milestone descriptions remain historical planning
context and do not override the current repository state.

## Verification status

PRs #31 through #37 were merged to `main` for Wave 2. The final PR #37 protected
CI run completed successfully. Verified green jobs included:

- Migration and architecture guardrails.
- Unit, integration, and accessibility tests.
- Build and typecheck.
- Format and lint.
- Secret scan.
- PostgreSQL RLS integration against a live CI database.
- Playwright end-to-end tests.
- Required aggregate quality gate.

The Wave 2 implementation therefore has both code history and recoverable Git
history in the merged PR chain; no Wave 2 closeout work depends on an unpushed
local-only checkout.

## Before real personal data

Production authentication/MFA, managed PostgreSQL, encrypted document storage,
backup/restore drills, monitoring, rate limiting, and professional payroll/legal
validation are still mandatory.

# Wave 4 update (2026-08-15)

Wave 4 automation foundations and task UI are implemented on the PR #40 baseline: reviewed
Smart Document Intake contracts, least-privilege Action AI, eight “Something changed” event
wizards, and the governed rules evaluator. Durable review/commit evidence has forced tenant
RLS. Production OCR/AI remains externally configuration-gated; manual workflows remain usable.
See `docs/architecture/wave-4-automation-ai.md` and the Wave 4 Definition of Done.

# Wave 5 completion pass (2026-08-15)

Baseline `4f4273e` includes merged PR #42. The completion audit found that the
Wave 5 database/application foundation was not yet reachable as an end-to-end
product. This pass adds the worker authorization bootstrap, authenticated
portal projection/mutations, and a distinct mobile-first worker shell, but the
honest release status remains **ORANGE / not ready to close**. Required employer
UX, signed worker downloads, complete notification persistence, live RLS,
Playwright, and Vercel preview evidence are still outstanding. See
`docs/governance/wave-5-definition-of-done.md`.
