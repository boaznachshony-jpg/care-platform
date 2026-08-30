# Code review — 30 August 2026

Full-stack review of backend, frontend, business-process screens, customer-data
persistence, backup, restore/recovery, and production release safety.

Six agents reviewed exclusive, non-overlapping scopes and reported in one shared
format (id, file:line, failure scenario, fix, confidence) on a single severity
scale, so the findings merge into one ranked list.

**112 findings — 13 BLOCKER, 38 HIGH, 44 MEDIUM, 17 LOW.**

All quality gates pass (`lint`, `build`, `typecheck`, `test` — 976 tests, 142
files, 0 failures). Every blocker is invisible to CI: no test executes SQL
against a real database as `caredesk_app`, so production's permission model is
never exercised.

**One document with everything: [FINDINGS.md](FINDINGS.md)** — all 112 findings
merged and ordered by severity, each with a stable ID. Work from that file; the
per-area reports below hold the same findings plus each reviewer's summary and
coverage notes.

| Report                                       | Scope                                 | BLOCKER | HIGH |
| -------------------------------------------- | ------------------------------------- | ------- | ---- |
| [01-backend-api.md](01-backend-api.md)       | `apps/api`, `packages/infrastructure` | 1       | 3    |
| [02-frontend.md](02-frontend.md)             | `apps/web`, `packages/ui`, `i18n`     | 4       | 9    |
| [03-database.md](03-database.md)             | 36 migrations, `packages/db`          | 0       | 6    |
| [04-backup-dr.md](04-backup-dr.md)           | backup, restore, DR readiness         | 3       | 7    |
| [05-release-safety.md](05-release-safety.md) | migrations, deploy, rollback          | 2       | 4    |
| [06-domain-logic.md](06-domain-logic.md)     | domain, application, rules, schemas   | 3       | 9    |

## The critical chain

The five most severe blockers are one chain, not five independent faults. Each
link disables the protection built for the previous one, so fix order matters:

1. **Real customer data was already destroyed.** The browser cache is encrypted
   with a key in `sessionStorage` while data sits in `localStorage`, so the data
   outlives the key. Unreadable keys were captured as empty strings, producing a
   well-formed save that blanked a populated account; the optimistic version
   check passed it. See `packages/application/src/ports/workspace-shrink-guard.test.ts:4-17`.
2. **The safety net was built** — migration `0035_workspace_version_history.sql`,
   trigger-level, additive, forced RLS, insert-only.
3. **It cannot be applied.** `0024`, `0027` and `0030` never insert into
   `schema_migrations`, and `migrate.ts` delegates the ledger write to each SQL
   file. Every second `db:migrate` re-runs `0024` (bare `create table`), fails
   with `42P07`, and aborts before reaching anything later.
4. **This already happened once.** `0017_restore_missing_pilot_workspace.sql:56-61`
   hand-backfills ledger rows for `0010`-`0012`. CI cannot see it: it only ever
   migrates a fresh database, never twice.
5. **The rehearsal writes to production.** `apps/web/vercel.json:8` hardcodes the
   production API for every deployment including Preview. The staging banner
   (`apps/web/src/environment.ts:9`) is a hostname check.

## Fix order (by dependency, not severity)

1. Fix the migration runner — record the version in `migrate.ts` after each
   file's transaction instead of trusting the file. Backfill the three missing
   ledger rows in production. Add a CI step that runs `db:migrate` twice.
2. Apply migration `0035` to production.
3. Convert the seven services off `SELECT … FOR UPDATE` on `idempotency_record`
   to claim-first (`insert … on conflict do nothing returning`). Do **not** grant
   UPDATE — `visa-renewal-migration.test.ts:37` asserts it must never exist, and
   `visa-renewal-repository.ts:258` shows the intended pattern.
4. Decouple Preview from production; stand up a staging database.
5. Frontend input protection: payroll wizard draft, navigation guard,
   ErrorBoundary, guarded `localStorage.setItem` (37 unguarded calls).
6. Database trigger rejecting UPDATE on a closed payroll month.
7. Pin `Asia/Jerusalem` explicitly; fix money rounding; test month boundaries.
8. Enable PITR, add loss detection, rehearse a single-tenant restore — all
   required before any real PII is onboarded.

## Verified independently

Critical findings were checked directly against the code rather than taken as
reported: the rounding helper was executed (`8.165 → 8.16`, `10.075 → 10.07`,
both wrong), all 36 migrations were checked for self-recording, frontend guards
were counted, and grants plus original design intent were read. One finding
(DOM-02) was downgraded from BLOCKER to HIGH because `0028:1-2` documents the
behaviour as deliberate. One proposed fix (API-01) was replaced as incorrect.
