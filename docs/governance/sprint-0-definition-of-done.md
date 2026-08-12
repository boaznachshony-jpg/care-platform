# Sprint 0 hardening: Definition of Done

Status: **Complete**
Completed: **2026-08-12**
Next delivery phase: **Wave 2**

## Delivered scope

Sprint 0 established the governed, secure engineering foundation for subsequent
product delivery. It completed four coordinated tracks:

- **Architecture and governance** through the canonical architecture freeze,
  authority order, legacy-to-canonical mapping, strangler migration controls,
  reconciliation/rollback rules, sunset gates, and architecture guardrails.
- **Database and RLS hardening** through the normalized database foundation,
  forced tenant-scoped RLS, least-privilege roles, cross-tenant integrity
  constraints, append-only audit protection, and executable PostgreSQL checks.
- **API and security hardening** through authorization and tenant-context
  enforcement, safer request handling, security controls, and operational
  observability.
- **QA and CI guardrails** through migration/architecture checks, formatting,
  linting, build/typecheck, unit/integration/accessibility tests, PostgreSQL RLS
  integration, desktop/mobile E2E tests, secret scanning, and an aggregate
  required quality gate.

The delivered work is recorded in merged PRs #25, #26, #27, and #28.

## Completion evidence

Sprint 0 is complete because:

- `SOURCE_OF_TRUTH.md` records the approved authority order and architecture freeze;
- ADR-006 records normalized PostgreSQL aggregates as the canonical target;
- `EmploymentCase` is the central employment aggregate;
- `document` and `document_version` are the canonical document model;
- the legacy inventory and mapping classify normalized, snapshot-only,
  duplicated, sensitive, and migration-priority data;
- migration phases declare read/write authority and prohibit undefined dual writes;
- rollback, reconciliation, tenant-scoped cutover evidence, and legacy sunset
  gates are defined;
- `MvpProfile` and other compatibility structures are prohibited as targets
  for new product data without explicit governance approval;
- tenant isolation is defended at both API and database layers;
- database RLS and security contracts are executable in CI;
- required static, compile, test, PostgreSQL RLS, E2E, and secret-scan gates are
  aggregated into the required quality result;
- PRs #25–#28 are merged; and
- post-merge CI on `main` completed successfully.

## Historical planning context

The initial Sprint 0 definition described a documentation-only architecture
freeze and excluded implementation, migrations, and CI changes. That statement
described the first governance slice, not the final delivered Sprint 0. The
scope subsequently expanded through separately reviewed engineering PRs #25–#28
to include database/RLS, API/security, and QA/CI hardening.

This closeout preserves that history while superseding the obsolete claim that
Sprint 0 as delivered changed no code or migrations. The closeout PR itself is
documentation-only and does not modify application code, database migrations,
CI configuration, dependencies, or production configuration.

## Exit decision

Sprint 0 is **complete**. Further product delivery proceeds as **Wave 2**.
Backfill, cutover, destructive legacy removal, and production promotion remain
subject to their documented evidence and approval gates.
