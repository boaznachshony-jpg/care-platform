# CareDesk Israel

AI-native employment, compliance, and case-management platform for Israeli
families that directly employ a foreign live-in caregiver.

## Current status

The repository is in **documentation and foundation planning**. It contains no
production application code. `caredesk_prototype.html` is a visual reference
only and must not be used as a production code base.

## Start here

AI agents and contributors must read these documents in order:

1. [Source of Truth](docs/SOURCE_OF_TRUTH.md)
2. [Synchronization Matrix](SYNC_MATRIX.md)
3. `CareDesk_Product_Specification_v1.0.docx`
4. `CareDesk_AI_Coding_Constitution_v1.0 (1).md`
5. [Design System & Component Catalog](docs/design-system/design-system-and-component-catalog.md)
6. [Database Blueprint](docs/architecture/database-blueprint.md)
7. [Rules & Workflow Engine](docs/rules/rules-and-workflow-engine.md)
8. [User Stories & Acceptance Criteria](docs/product/user-stories-and-acceptance-criteria.md)
9. [AI Review Constitution](docs/governance/ai-review-constitution.md)
10. [Repository Bootstrap Plan](docs/architecture/repository-bootstrap-plan.md)

The [Gap Analysis](docs/product/gap-analysis.md) records the repository audit
and remaining decisions. Architecture decisions are under [docs/adr](docs/adr).

## Binding decisions

- The first foundation slice is **Employment Case Foundation**.
- The first complete business workflow is **Visa Renewal**.
- The repository is a pnpm monorepo with `apps/` and `packages/`.
- Authentication target: Supabase Auth, subject to ADR-001 acceptance.
- Tenancy target: shared PostgreSQL schema with `tenant_id` and RLS, subject to
  ADR-002 acceptance.
- External AI is disabled initially; `MockProvider` is required until ADR-003
  privacy gates are met.
- No legal, payroll, or regulatory value is considered verified without
  versioned source evidence and the required human approval.

## Prototype

`caredesk_prototype.html` is retained as a read-only visual reference. It may
inform information hierarchy and interaction ideas, but its JavaScript, CSS,
state, validation, calculations, and hard-coded text must not be copied into
production.

## Branching

Use GitHub Flow:

```text
main
agent/*
foundation/*
feature/*
fix/*
docs/*
chore/*
```

Do not develop directly on `main`. The historical remote branches `api`, `web`,
`mobile`, `infrastructure`, `docs`, `carepilot-app`, and `scripts` all point to
the same empty initial commit. They are preserved as an audit finding and can
be removed only in a separate approved maintenance change.

## Next milestone

Follow [Milestone 0 – Repository Foundation](docs/architecture/repository-bootstrap-plan.md).
Do not implement product features before its quality gates pass.
