# CareDesk Israel

AI-native employment, compliance, and case-management platform for Israeli
families that directly employ a foreign live-in caregiver.

## Current status

**Sprint 0 is complete. Wave 2 is in progress.**

The current pilot foundation includes persisted employment cases, contacts,
tasks, timeline, documents, family access, billing, payroll records, quarterly
national-insurance tracking, and renewal-date follow-up tasks. Supabase
authentication and tenant isolation are implemented; the canonical normalized
architecture and engineering guardrails are recorded in
[BUILD_STATUS.md](BUILD_STATUS.md).

Development and test data remain **synthetic only**. External AI is disabled,
and no real personal data may be used until every blocking gate in the
[gap analysis](docs/product/gap-analysis.md) has an approved owner and evidence.
Wave 2 delivers the full persisted Visa Renewal Workflow; see
[issue #30](https://github.com/boaznachshony-jpg/care-platform/issues/30).

`caredesk_prototype.html` is a visual reference only and must not be used as
a production code base.

## Local development

Requires Node (version pinned in `.nvmrc`) and `corepack` for pnpm:

```bash
corepack enable
pnpm install
pnpm check   # format:check + lint + typecheck + test + build
```

Run the web and API shells locally:

```bash
pnpm dev       # apps/web on http://localhost:5173
pnpm dev:api   # apps/api on http://localhost:4000
```

### Testing on a phone

Both dev servers bind all interfaces, so with the phone on the same Wi-Fi,
open the **Network** URL that `pnpm dev` prints (e.g.
`http://192.168.1.50:5173`). The web app derives the API host from the page
it was loaded from, so nothing needs configuring — pointing it at `localhost`
would mean the phone itself.

Outside production the API also accepts any private-network origin, so CORS
does not need editing for whatever address the router assigns. Public origins
are still refused. If the phone cannot connect, it is almost always Windows
Firewall prompting for Node on a private network.

This matters more than usual here: the product is mobile-first for users in
their 50s and 60s, and RTL layout, tap targets and on-screen-keyboard
behaviour are not fully exercised by a narrowed desktop viewport.

`apps/web`'s Dashboard page calls `apps/api`'s `/health` endpoint — run both
together to see it succeed. See `CONTRIBUTING.md` for the full workflow,
branching policy, and how to add an ADR.

### Database

The API runs against Postgres when a connection URL is configured and falls
back to in-memory repositories otherwise, so the test suite and a bare
`pnpm dev:api` work with no database at all.

```bash
pnpm db:migrate    # apply pending migrations (idempotent)
pnpm db:rls-test   # live tenant-isolation check; exits non-zero on any leak
```

Both read the connection string from `.env.local` (gitignored). See
[database/README.md](database/README.md) for the connection specifics — in
particular why the Supabase **session pooler on port 5432** is required, and
why RLS needed `FORCE` plus a dedicated non-administrative role before it
actually isolated anything.

Run `pnpm db:rls-test` after any change to a policy, a tenant-owned table, or
`withTenant()`.

## Architecture boundaries

Dependencies point inward, per Constitution §5:

```text
apps/web, apps/api        → Presentation
packages/application      → Application (use cases, ports)
packages/domain            → Domain (entities, status vocabulary)
packages/infrastructure   → Infrastructure (mock adapters implementing the ports)
```

`packages/rules` and `packages/workflows` provide deterministic rule and
workflow primitives. Wave 2 extends them for the governed Visa Renewal flow;
unverified legal values or authority procedures must not be encoded as truth.
`packages/ui`, `packages/design-tokens`, and `packages/i18n` are
domain-neutral and used by `apps/web` only.

## Mocks

Every external dependency is behind a port (`packages/application/src/ports`)
with an in-memory or deterministic mock implementation
(`packages/infrastructure/src/mocks`) — `MockAuthService`,
`DenyByDefaultAuthorizationService`, `InMemoryAuditService`,
`InMemoryTimelineService`, `InMemoryDocumentStorage`, `MockAIProvider`, and
shell `InMemoryRuleRepository`/`InMemoryWorkflowRepository`. Swapping a mock
for a real adapter (Supabase, a real AI provider, real object storage)
requires the corresponding ADR to reach **Accepted** first — see
`docs/adr/`.

## Synthetic data

`packages/testing` is the only source of fixture data. Every fixture uses
the `example.invalid` email domain and a name prefixed "Synthetic" — no real
personal data belongs in this repository, in any branch, at any time
(Constitution §16, §25). See `database/seed/README.md` for the seed
strategy once real tables exist.

## Troubleshooting

- **`pnpm install` fails to resolve a workspace package** — confirm
  `pnpm-workspace.yaml` still lists `apps/*` and `packages/*`, and that the
  package you added has a `name` field starting with `@caredesk/`.
- **Vite dev server can't reach the API** — start `pnpm dev:api` in a second
  terminal; `apps/web` reads `VITE_API_BASE_URL` from `.env` (copy
  `.env.example`), defaulting to `http://localhost:4000`.
- **A `docs/**` file is unexpectedly reformatted** — it shouldn't be:
  `.prettierignore` excludes authority documents so Prettier never rewrites
  reviewed content; if it happens, that's a bug in `.prettierignore`.
- **Database commands fail** — `database/docker-compose.yml` requires Docker
  locally; it has not been run or verified in every environment this
  repository has been developed in (see `database/README.md`).

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
- Authentication: Supabase Auth under accepted ADR-001.
- Tenancy: shared PostgreSQL schema with `tenant_id`, forced RLS, and
  least-privilege roles under accepted ADR-002.
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

## Next delivery phase

Sprint 0 is complete and the pilot application is already deployed. **Wave 2 —
Visa Renewal Workflow** is now the active delivery phase: turn the existing visa
renewal date and generated follow-up tasks into a persisted, auditable workflow
with version provenance, explicit ownership, contact guidance, completion
evidence, and synchronized Timeline/Audit events.

Work is governed by [issue #30](https://github.com/boaznachshony-jpg/care-platform/issues/30)
and the [Wave 2 Definition of Done](docs/governance/wave-2-definition-of-done.md).
Continue to use synthetic data and do not encode unverified legal rules while
the required professional approvals remain outstanding.
