# CareDesk build status

Status date: **2026-08-12**

Sprint 0 closeout baseline: `main` after merged PRs #25, #26, #27, and #28
Previous architecture-review baseline (retained for history): `main` at `0c6acee`
Previous recovery baseline (retained for history): `main` at `3eaee63`

## Sprint 0 status

**Complete.** Sprint 0 delivered the engineering and governance foundation required
before the next product-delivery phase. The next delivery phase is **Wave 2**.

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

Sprint 0 was originally described as a documentation-only architecture freeze.
That description is retained only as historical planning context: the delivered
Sprint 0 expanded through the separately reviewed and merged PRs #25–#28 and
included application, database migration, security, test, and CI changes. This
governance closeout PR itself remains documentation-only.

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
Milestone 0 and Sprint 0 are complete, and the product is already a working
pilot candidate; the project must not be bootstrapped again. The current
baseline contains a React web application, Fastify API, PostgreSQL/Supabase
persistence, tenant isolation, authentication, billing, case management,
documents, family access, support requests, payroll records,
national-insurance tracking, and automated tests.

## Included in this E2E candidate

- Responsive RTL shell for desktop, tablet, and mobile.
- Dashboard, tasks, employee, documents, timeline, payroll, settings, and case flows.
- Vercel-compatible Fastify default export.
- Workspace dependency builds before Web/API builds.
- Unit, integration, accessibility, and Playwright E2E coverage.
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

| Area                                     | State                                                                         |
| ---------------------------------------- | ----------------------------------------------------------------------------- |
| Repository foundation and CI             | Complete                                                                      |
| Sprint 0 architecture and governance     | Complete                                                                      |
| Database and RLS hardening               | Complete                                                                      |
| API and security hardening               | Complete                                                                      |
| QA and CI guardrails                     | Complete                                                                      |
| Web and API application shells           | Complete                                                                      |
| Authentication and workspace persistence | Implemented                                                                   |
| Employment case foundation               | Implemented                                                                   |
| Contacts, tasks, timeline, and documents | Implemented                                                                   |
| Family access                            | Implemented                                                                   |
| Billing                                  | Implemented                                                                   |
| Payroll record workflow                  | Implemented; professional validation still blocks authoritative calculations  |
| Visa renewal                             | Date capture and follow-up tasks implemented; full persisted workflow is next |
| External AI                              | Disabled by design pending privacy approval                                   |

## Next delivery phase

**Wave 2** is the next product-delivery phase. Its detailed scope and acceptance
criteria must be governed by the Source of Truth, accepted ADRs, and the
synchronization matrix.

The previously recorded Milestone 2 visa-renewal slice remains useful historical
planning context, but it does not override the approved Wave 2 plan.

## Verification status

PRs #25, #26, #27, and #28 were merged to `main`. Post-merge CI on `main`
completed successfully, including the required quality gates introduced during
Sprint 0. The post-merge Vercel checks for both the Web and API projects also
reported success.

This closeout changes governance documentation only. Formatting, terminology,
cross-document status, and Markdown consistency were reviewed; no application
code, database migration, CI configuration, dependency, or production
configuration is modified.

## Before real personal data

Production authentication/MFA, managed PostgreSQL, encrypted document storage,
backup/restore drills, monitoring, rate limiting, and professional payroll/legal
validation are still mandatory.
