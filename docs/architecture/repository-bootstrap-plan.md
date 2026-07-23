# Milestone 0 — Repository Foundation

Status: **Review-ready plan v1.0**
Goal: a reproducible, secure, testable monorepo with no product feature logic
Last updated: 2026-07-23

## 1. Outcome

At Milestone 0 completion, a clean checkout can be installed, checked, tested,
built, and run locally through documented commands. Web and API shells prove
the architecture, RTL, accessibility, dependency boundaries, mock adapters,
and CI. No legal rule, payroll calculation, real authentication tenant,
external AI, or real personal data is included.

## 2. Preconditions

- authority documents reviewed and approved;
- branch based on current `main`;
- no attempt to merge historical empty layer branches;
- runtime and package-manager versions selected;
- ADR-001 through ADR-003 may remain Proposed only because all provider
  integrations are mocked;
- synthetic-data rule accepted.

## 3. Target repository structure

```text
apps/
  web/
  api/
packages/
  ui/
  domain/
  application/
  schemas/
  rules/
  workflows/
  infrastructure/
  testing/
docs/
database/
  migrations/
  seed/
scripts/
.github/
  workflows/
```

Package boundaries:

- `domain`: entities, value objects, domain errors; no framework/provider code;
- `application`: use cases and ports;
- `schemas`: shared external validation contracts;
- `rules`: deterministic rule types/evaluator shell, no legal values;
- `workflows`: workflow contracts/state-machine shell;
- `ui`: domain-neutral design-system components;
- `infrastructure`: adapters for auth, storage, database, audit, timeline, AI;
- `testing`: synthetic fixtures, contract-test helpers.

## 4. Technical baseline

Use the AI Coding Constitution as the governing baseline. Bootstrap assumptions
to confirm in the implementation PR:

- pnpm workspace;
- Node LTS pinned in `.nvmrc` or equivalent and `package.json#engines`;
- TypeScript strict with shared base config;
- React web app;
- Node TypeScript API;
- ESLint and Prettier;
- Vitest for unit/component tests;
- Playwright for later E2E, with one foundation smoke test;
- accessible component testing;
- environment validation using a typed schema;
- no production database connection in the first bootstrap commit.

If a tool choice differs from the constitution, create an ADR before adoption.

## 5. Work packages

### M0.1 — Workspace and policy files

Deliver:

- root `package.json`;
- `pnpm-workspace.yaml`;
- lockfile;
- pinned runtimes;
- `.editorconfig`, `.gitignore`, Prettier and ESLint configuration;
- shared TypeScript configuration;
- `CONTRIBUTING.md`, `SECURITY.md`, `.env.example`;
- dependency and script documentation.

Checks:

- clean install;
- no secrets;
- all packages discovered;
- strict TypeScript cannot be weakened locally without review.

### M0.2 — Web shell

Deliver:

- AppShell with `lang="he"` and RTL;
- responsive navigation placeholders;
- translation infrastructure with Hebrew default;
- design tokens and a small primitive set: Button, StatusBadge, Alert,
  EmptyState, ErrorState, Skeleton;
- health/demo page using synthetic content.

Checks:

- keyboard and focus;
- 320 px responsive view;
- automated accessibility smoke test;
- no hard-coded user-facing strings;
- no business calculations.

### M0.3 — API shell

Deliver:

- health and readiness endpoints;
- typed error envelope;
- request/correlation id;
- environment validation;
- structured logging with redaction;
- graceful shutdown;
- placeholder authorization middleware that denies protected routes by default.

Checks:

- no PII in logs;
- health tests;
- invalid config fails safely;
- no direct dependency on UI.

### M0.4 — Core ports and mocks

Define:

```text
AuthService
AuthorizationService
Clock
IdGenerator
AuditService
TimelineService
DocumentStorage
AIProvider
RuleRepository
WorkflowRepository
```

Deliver deterministic in-memory or mock adapters and contract tests.

`MockAIProvider` is the only enabled AI adapter. Storage accepts synthetic
fixtures only.

### M0.5 — Domain vocabulary

Create canonical types/enums from the Database Blueprint:

- Tenant, FamilyAccount, User, TenantMembership;
- EmploymentCase and status;
- sensitivity classes;
- task, workflow, payroll, rule, and notification statuses;
- RACI roles;
- typed identifiers.

No duplicate aliases (`Account`, `CareWorker`, generic `Workflow`) are allowed.

### M0.6 — Database development scaffold

Only after the schema approach is selected:

- migration folder and naming convention;
- local PostgreSQL development configuration;
- empty baseline migration or schema smoke test;
- RLS test harness design;
- synthetic seed strategy.

Do not create the full business schema in Milestone 0. ADR-002 must be accepted
before production-like RLS implementation.

### M0.7 — CI and repository governance

CI on pull requests:

1. lockfile install;
2. formatting;
3. lint;
4. typecheck;
5. unit/component tests;
6. build;
7. accessibility smoke;
8. secret/dependency scanning where available.

Add PR template requiring authority, sync-matrix, privacy/security, and test
evidence. Enable branch protection separately after checks exist.

### M0.8 — Developer and AI-agent documentation

Update README with:

- authority reading order;
- setup and commands;
- architecture boundaries;
- use of mocks;
- synthetic-data policy;
- troubleshooting;
- how to add an ADR;
- how to prepare review evidence.

## 6. Suggested issue sequence

| Order | Issue |
|---:|---|
| 1 | Initialize pnpm workspace and pinned runtime |
| 2 | Configure strict TypeScript, lint, formatting |
| 3 | Create shared package boundaries |
| 4 | Create RTL web shell and design tokens |
| 5 | Create API health shell and safe logging |
| 6 | Define core ports and deterministic mocks |
| 7 | Add canonical domain vocabulary |
| 8 | Configure test frameworks and smoke tests |
| 9 | Configure CI and PR template |
| 10 | Verify clean-checkout setup and documentation |

Keep each issue small and reviewable. Do not combine product feature work with
bootstrap configuration.

## 7. Required root commands

The exact names may be confirmed during bootstrap, but the repository must
provide equivalents of:

```text
pnpm install --frozen-lockfile
pnpm dev
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:a11y
pnpm build
pnpm check
```

`pnpm check` runs all required local quality gates.

## 8. Environment policy

- `.env.example` contains names and safe descriptions only.
- startup validates required variables.
- local defaults enable mocks and synthetic data.
- production secrets come from managed secret storage.
- `NODE_ENV` or a UI flag alone must not authorize sensitive operations.
- external AI is off unless explicitly configured after ADR-003 acceptance.

## 9. Validation matrix

| Gate | Evidence |
|---|---|
| Reproducibility | clean checkout install and `pnpm check` |
| Architecture | dependency-boundary tests/lint rules |
| Type safety | strict typecheck across all packages |
| RTL | root direction plus responsive screenshots/test |
| Accessibility | automated smoke and manual keyboard pass |
| Security | secret scan, safe logging test, deny-by-default route |
| Privacy | synthetic fixtures and no external provider calls |
| Adapters | contract tests for each mock |
| CI | pull-request run passes |
| Documentation | setup tested by a fresh context |

## 10. Definition of done

Milestone 0 is complete when:

- a clean checkout passes all root checks;
- web and API shells run locally;
- shared boundaries and canonical vocabulary compile;
- mock adapters are deterministic and contract-tested;
- RTL and accessibility smoke tests pass;
- CI matches local checks;
- no real data, legal constants, payroll formulas, or external AI calls exist;
- README and authority documents are synchronized;
- a human reviewer approves the foundation PR.

## 11. Explicitly excluded

- Dashboard feature implementation;
- Employment Case persistence screens;
- visa/insurance rules;
- payroll formulas;
- full database schema;
- production Supabase project;
- production storage;
- real notifications;
- OCR;
- external AI;
- deployment with real users.

The next milestone is **Employment Case Foundation**, followed by the first
complete business workflow, **Visa Renewal**.
