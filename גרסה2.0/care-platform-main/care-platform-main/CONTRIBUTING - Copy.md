# Contributing to CareDesk

Before writing any code, read in this order (per `docs/SOURCE_OF_TRUTH.md`):

1. `CareDesk_Product_Specification_v1.0.docx`
2. `CareDesk_AI_Coding_Constitution_v1.0 (1).md`
3. Any accepted ADR in `docs/adr/`
4. `docs/architecture/database-blueprint.md`
5. `docs/rules/rules-and-workflow-engine.md`
6. `docs/design-system/design-system-and-component-catalog.md`
7. `docs/product/user-stories-and-acceptance-criteria.md`
8. `docs/governance/ai-review-constitution.md`
9. `docs/architecture/repository-bootstrap-plan.md`

## Local setup

```bash
corepack enable
pnpm install
pnpm check
```

`pnpm check` runs formatting, lint, typecheck, tests, and build — the same
gates CI enforces. It must pass before opening a pull request.

## Branching

GitHub Flow only: `main`, `feature/*`, `foundation/*`, `fix/*`, `docs/*`,
`chore/*`. No long-lived branches split by layer (no permanent `api`/`web`
branches — those are directories inside this monorepo).

## Pull requests

- Small, focused, one concern per PR (Constitution §27).
- Reference which authority documents were consulted and the `SYNC_MATRIX.md`
  rows touched, per `docs/governance/ai-review-constitution.md`.
- No real personal data anywhere — fixtures and demos use synthetic data only.
- If a change diverges from an existing ADR or the Constitution, open a new
  ADR instead of silently deviating (Constitution §28).

## Adding an ADR

Copy the structure used by `docs/adr/ADR-001-authentication-strategy.md`
(Status/Date/Owners/Approved by/Approved at, Context, Decision, Alternatives
Considered, Consequences, Acceptance Evidence, Migration Impact, References).
New ADRs start at `Status: Proposed` and are never self-approved by the
authoring agent (Constitution §33).
