# Production Release Safety Review

Scope: deploy-time risk surface only — migration runner, migration content, CI gates, environment
promotion, rollback. API code, frontend, RLS policy content, backup/DR and the domain layer are
other agents' scope and are cited here only where they bear on a deploy.

Repo: `/home/user/care-platform` @ `main`. All paths absolute below the repo root unless noted.

## Summary

The good news first, because it is genuinely unusual: **there is not one `DROP TABLE`, `TRUNCATE`,
`DELETE FROM`, `DROP COLUMN`, `RENAME`, or `ALTER COLUMN ... TYPE` in the entire 36-file migration
set.** Verified by exhaustive grep over `database/migrations/*.sql`. The team has a written
expand/migrate/contract policy (`docs/operations/production-release-and-recovery.md:78-86`), a CI
job that blocks destructive migrations and edits to applied migrations
(`.github/workflows/ci.yml:60-61`), a CI job that applies every migration to a real Postgres 17 from
scratch (`ci.yml:128-162`), and at least one migration written by somebody who clearly knows what an
`ACCESS EXCLUSIVE` lock is (`0020_sprint_zero_database_hardening.sql:35-55`, `NOT VALID` then
`VALIDATE`). Most releases here will not destroy customer data.

The bad news is that the team **cannot currently ship a new migration at all**, and the path they
will be pushed down when they discover that is hand-editing the production ledger.

Three migrations — `0024`, `0027`, `0030` — never insert their version into `schema_migrations`. The
runner (`packages/db/src/migrate.ts:11-48`) does not write the ledger itself; it *delegates* that to
each SQL file. So on the production database those three versions are permanently "pending". The
next `pnpm db:migrate` re-executes `0024_wave4_automation.sql:3` — a bare `create table
document_intake_review` with no `if not exists` — which raises `42P07 duplicate_table`, rolls its
transaction back, and **aborts the entire run before reaching migration `0025` or anything after
it.** No new migration can be applied until somebody manually inserts ledger rows into production.
CI cannot see this because CI only ever migrates a fresh database and no test runs the runner twice.
This has demonstrably happened before: `0017_restore_missing_pilot_workspace.sql:56-61` exists solely
to back-fill ledger rows for `0010`/`0011`/`0012` after exactly this class of divergence.

Second blocker: **there is no staging database.** "Staging" is a Vercel *Preview* deployment of the
same two projects (`DEPLOYMENT.md:5-9`) and a purple banner driven purely by hostname
(`apps/web/src/environment.ts:9`). `apps/web/vercel.json:8` hardcodes the *production* API host into
the rewrite for every deployment, previews included. The team's own runbook states the position
plainly: "Staging and production still need separate Supabase projects"
(`docs/operations/production-release-and-recovery.md:15-18`). A staging deploy today is a production
deploy against production customer data.

Third: the migration runner has **no advisory lock**, **no environment guard**, and **no dry-run**.
The only advisory lock in the repo is inside a function body at
`0019_backfill_self_service_accounts.sql:29`. `pnpm db:migrate` will happily point at whatever
`DATABASE_ADMIN_URL` is in the operator's `.env.local`.

Everything else is degrees of exposure rather than a hard stop. The single riskiest *content*
decision in the set is `0030_human_escalation_lifecycle.sql:13-22,36-38`, which narrows a `CHECK`
vocabulary and adds a conditional-NOT-NULL constraint — a genuine break of the expand/contract rule
the same repo documents, and the one place where "redeploy the last known-good commit" produces
constraint violations rather than a clean rollback.

## Deploy-risk scorecard

| Control | Status | Evidence | Risk if it fails |
|---|---|---|---|
| Transactional migration runner | **PRESENT** | `packages/db/src/migrate.ts:34-45` — `begin` / `commit`, `rollback` on error, per migration. No migration contains `commit;`, `create index concurrently`, or `alter type ... add value` (grep clean), so nothing breaks the wrapping transaction. | A half-applied DDL file leaves the schema in a shape no code targets. |
| Migration ledger | **PARTIAL** | Table created `migrate.ts:12-14`, read `:16-20`. The runner **never inserts**; each SQL file self-records (`migrate.ts:8-9`). `0024`, `0027`, `0030` omit the insert — verified by grep for `schema_migrations` in each file (0 hits). | Re-runs of already-applied DDL; `db:migrate` aborts permanently. |
| Concurrent-deploy lock | **ABSENT** | No `pg_advisory_lock` in `migrate.ts` or `cli.ts`. Only occurrence repo-wide is `0019_backfill_self_service_accounts.sql:29`, inside a plpgsql function. | Two operators migrating at once interleave DDL; one gets a duplicate-object error mid-sequence. |
| No destructive migrations | **PRESENT** | Exhaustive grep of `database/migrations/*.sql`: zero `drop table`, `truncate`, `delete from`, `drop column`, `rename`, `alter column ... type`. Only `drop policy` / `drop trigger` / `drop constraint`. | — (this control is genuinely holding) |
| Expand/contract discipline | **PARTIAL** | Practised: `0025:4` nullable add; `0025:9` `not null default '<constant>'` (metadata-only in PG11+); `0020:35-55` `NOT VALID` then `VALIDATE`; `0030:24-26` deliberately keeps the legacy `assigned_to` column; `0035` purely additive. Broken: `0030:13-22,36-38`. | A rollback of the web/API build hits `CHECK` violations against the already-migrated schema. |
| Rollback procedure | **PARTIAL** | `docs/operations/production-release-and-recovery.md:95-113` is a real checklist and correctly states "Code rollback does not roll the database backward". `DEPLOYMENT.md:8` is one sentence. No down migrations exist (`ls database/migrations` — none). | Operators improvise under pressure on a database with no PITR (`0035:5`). |
| Old-code/new-schema compatibility | **PARTIAL** | Compatible for 33 of 36 migrations. `0030_human_escalation_lifecycle.sql:18-20` narrows `status` to exclude `'draft'`/`'open'`; `:36-38` requires `resolution_note` whenever `status='resolved'`. | Rolled-back API build writes a now-illegal status → 500s on the escalation path. |
| Web/API version-skew handling | **ABSENT** | Two independent Vercel projects (`DEPLOYMENT.md:13-33`). No API version prefix, no `X-API-Version`, no contract test between deployed artifacts (grep for `apiVersion`/`/v1/` finds only Supabase's own URLs). `apps/web/src/api/client.ts:36-47` resolves a base URL and nothing else. | New web calls a route the old API has not deployed yet → user-visible 404/500 during every promotion. |
| CI blocks bad migrations | **PARTIAL** | `ci.yml:60-61` runs `pnpm db:migration-safety`; `ci.yml:128-162` applies all migrations to a real Postgres. Aggregator `ci.yml:210-239` requires all seven jobs green. Blind spots: no `UPDATE` rule, `execute '<sql>'` bypass, no `CONCURRENTLY`/`NOT VALID` rule, no ledger-insert rule, no duplicate-number rule. | A destructive or locking migration passes CI clean. |
| Applied-migration immutability enforced | **PRESENT (with a caveat)** | `packages/db/src/migration-safety.ts:97-102` rejects any git status other than `A`; run in CI at `ci.yml:61`. Git history confirms no migration has ever been edited after reaching `main` (only `0024` and `0035` have two commits, both within their own PR — `254a5cd`/`33bbd05` in PR #41, `ea3ca81`/`1e94dff` in PR #102). | Caveat: immutability is measured against `origin/main`, not against what production has actually applied. |
| Prod/staging DB separation | **ABSENT** | `docs/operations/production-release-and-recovery.md:15-22` states separate projects are still needed. `apps/web/src/environment.ts:7-9` — "staging" is a hostname banner only. | Every staging rehearsal reads and writes real customer data. |
| Preview env cannot reach prod DB | **ABSENT** | `apps/web/vercel.json:8` hardcodes `https://care-platform-api.vercel.app` for all deployments. `DEPLOYMENT.md:20-27` gives one value list and requires the auth variables "in Preview and Production". No `VERCEL_ENV` handling in `.env.example` or either app. | A preview branch build mutates production rows. |
| Seeds cannot run on prod | **PARTIAL** | No seed script exists at all — `database/seed/` contains only `README.md` (`:19-24`). But `pnpm db:rls-test` (`package.json:13` → `packages/db/src/rls-check.ts`) is designed to run against the live project (`PILOT_RELEASE.md:10`), writes rows with the BYPASSRLS admin connection, creates and drops a table (`rls-check.ts:551,558`), and issues 16 `DELETE`s (`:559-578`) with **no environment guard** — unlike its CI twin (`rls-check-ci.ts:19-22`). | A widened `WHERE` clause in that cleanup block deletes customer rows in production. |
| Feature flags | **ABSENT** | No flag mechanism in `apps/` or `packages/`. Only aspirational mentions: `docs/governance/next-delivery-wave-gap-analysis.md:168`, `docs/architecture/strangler-migration.md:36`, `docs/adr/ADR-003-ai-provider-and-data-minimization.md:64`. Nearest thing is `BILLING_PROVIDER=disabled` (`.env.example:71`), which needs a redeploy to flip. | Every risky change is live for every customer the instant it merges; the only "off" switch is a redeploy. |

## Destructive-statement inventory

No statement in the set destroys a table or a column. The rows below are everything that *writes to*,
*constrains*, or *locks* pre-existing customer data.

| Migration | Statement | Touches existing customer rows? | Lock risk | Verdict |
|---|---|---|---|---|
| `0004_force_rls_and_with_check.sql:26-32` | `drop policy if exists` ×7, then recreate | No (policies, not rows) | Brief `ACCESS EXCLUSIVE` per table | Safe. Recreated in the same transaction, so no isolation gap. |
| `0015_lock_down_supabase_public_schema.sql:32` | `drop policy if exists tenant_current_reference on tenant` | No | Brief | Safe |
| `0017_restore_missing_pilot_workspace.sql:22,48` | `drop policy if exists` | No | Brief | Safe |
| `0017:56-61` | `insert into schema_migrations` for `0010`/`0011`/`0012` | No (bookkeeping) | None | **Symptom of a prior ledger/schema divergence incident.** Evidence the failure mode in REL-01 has already bitten once. |
| `0018_self_service_account_bootstrap.sql:76` | `execute 'drop trigger if exists caredesk_owner_bootstrap on auth.users'` | No | Brief on `auth.users` | Safe, but this is the exact `execute '<literal>'` idiom that evades the safety scanner (REL-06). |
| `0018:41-61` | `insert` into `tenant`/`app_user`/`family_account`/`tenant_membership`; `update family_account` | Yes — creates tenancy rows | Row-level | Guarded by `pg_advisory_xact_lock` in the sibling `0019:29`; idempotent by design. Acceptable. |
| `0019_backfill_self_service_accounts.sql:65-96,131` | Bulk backfill: `insert`/`update app_user`, create `tenant`+`family_account`+`tenant_membership` for every Auth user missing one | **Yes — mass write across every user** | Row-level, unbounded (no batching) | Data migration in one transaction with no batching and no row-count verification, contrary to the team's own rule at `production-release-and-recovery.md:82`. Irreversible — no down migration. |
| `0020_sprint_zero_database_hardening.sql:8-28` | 4 × `create index` on **existing** `audit_event`, `task`, `document`, `tenant_membership` — no `CONCURRENTLY` | No (reads them) | `SHARE` lock — **blocks all writes** for the build duration | Fine at pilot size; an outage on a large `audit_event`. `CONCURRENTLY` is impossible here because the runner wraps every migration in a transaction. |
| `0020:32-33` | `alter table tenant_membership add constraint ... unique (tenant_id, id)` | No | `ACCESS EXCLUSIVE` + full unique-index build | Same as above. |
| `0020:35-48` then `:53-55` | 3 × FK `NOT VALID`, then `VALIDATE CONSTRAINT` | Validates every row | `ACCESS EXCLUSIVE` (brief) then the lighter validation lock | **Best-practice example in this repo.** Comment at `:50-52` shows the author understood the trade-off exactly. |
| `0025_wave5_collaboration_engagement.sql:4` | `alter table task add column assignee_membership_id uuid` | No | Metadata only | Safe expand. |
| `0025:5-6` | `alter table task add constraint task_assignee_same_tenant foreign key ...` — **no `NOT VALID`** | Validates every `task` row | `ACCESS EXCLUSIVE` on `task` + `SHARE ROW EXCLUSIVE` on `tenant_membership` + full scan | Should have followed the `0020` pattern. Outage risk on a large `task` table. |
| `0025:7` | `create index task_by_assignee on task (...)` — no `CONCURRENTLY` | No | Blocks writes to `task` | Same class as `0020:8-28`. |
| `0025:9-10` | `alter table document add column worker_visibility text not null default 'employer_only' check (...)` | Every existing `document` row acquires the default | Metadata-only in PG11+ (constant default ⇒ no rewrite) | **Safe**, and a good expand: old code inserting without the column still works. Would have been a rewrite pre-PG11. |
| `0026_canonical_product_intelligence.sql:3-11` | 4 × nullable `add column` + `add constraint payroll_month_close_amount_reconciles check (...)` — no `NOT VALID` | Validates every `payroll_month_close` row | `ACCESS EXCLUSIVE` + full scan | Constraint is all-null-tolerant, so old code inserting none of the four columns still passes. Safe expand; lock risk only. |
| `0030_human_escalation_lifecycle.sql:13-14` | `alter table professional_review_request drop constraint if exists ..._status_check` | No | `ACCESS EXCLUSIVE` | Safe alone; sets up the next row. |
| **`0030:15-17`** | **`update professional_review_request set status='requested' where status in ('draft','open')`** | **Yes — rewrites customer rows** | Row locks on all matching rows | **The one in-place data rewrite in the set.** Unbounded, unbatched, no row-count check. Runs as the BYPASSRLS owner across every tenant (comment `:11-12` says so explicitly). Not flagged by CI: `migration-safety.ts:13-58` has **no `UPDATE` rule at all**. |
| **`0030:18-20`** | **`add constraint ..._status_check check (status in ('requested','acknowledged','in_review','resolved','cancelled'))`** | Validates every row | `ACCESS EXCLUSIVE` + scan | **Breaking.** Narrows the vocabulary `0027:12` established. Any code version that writes `'open'` or `'draft'` now fails. |
| `0030:21-22` | `alter column status set default 'requested'` | No | `ACCESS EXCLUSIVE` (brief) | Safe. Softens the above for inserts that omit `status`. |
| `0030:27-34` | `add column assigned_to_name text` / `resolution_note text` (both nullable) | No | Metadata only | Safe expand. `:24-26` explicitly leaves the legacy `assigned_to` column — correct discipline. |
| **`0030:36-38`** | **`add constraint review_resolution_note_consistent check (status <> 'resolved' or resolution_note is not null)`** | Validates every row | `ACCESS EXCLUSIVE` + scan | **Breaking.** A conditional NOT NULL on a column the previous build did not know existed. Any rolled-back code resolving a review fails. |
| `0032_regulation_rule_lifecycle.sql:109+` | `insert into regulation_rule ... from tenant t cross join (values ...)` — no `on conflict` | **Yes — writes seed content into every existing tenant** | Row-level | A migration that mass-inserts *product content* into customer tenants, irreversibly (no down migration). Note `regulation_rule_key_version_unique` at `:46` means a re-run would error — masked only because this file *does* self-record. |
| `0035_workspace_version_history.sql:67-70` | `create trigger tenant_workspace_archive_previous before update on tenant_workspace` | No | `ACCESS EXCLUSIVE` on `tenant_workspace` | Safe; small table. |
| `0035:74-78` | `insert into tenant_workspace_history select ... from tenant_workspace on conflict do nothing` | Reads every workspace, writes an archive copy | Row-level | **Safe and actively protective** — this migration is the recovery path for the one table with no version history. Note `:5` admits PITR is not enabled on the project. |

Lock-risk footnote that applies to all of the above: **no `lock_timeout` or `statement_timeout` is
set anywhere** (grep clean across `packages/`, `database/`, `apps/`). An `ALTER TABLE` that queues
behind one long-running transaction then blocks *every subsequent query* on that table behind it in
the lock queue. That is the standard mechanism by which a "small" migration becomes a total outage.

## Findings

### [BLOCKER] Three migrations never record themselves; `pnpm db:migrate` is permanently broken on any database that has them

- **ID:** REL-01
- **File:** `packages/db/src/migrate.ts:11-48` (runner); `database/migrations/0024_wave4_automation.sql` (no `schema_migrations` insert, EOF at line ~55); `database/migrations/0027_product_differentiation_completion.sql` (same); `database/migrations/0030_human_escalation_lifecycle.sql:72` (ends at the `grant`, no insert)
- **What:** The runner does not write the ledger. It creates the table (`:12-14`), reads it (`:16-20`), and relies on every SQL file to insert its own version — documented as the design at `:8-9` ("the SQL files end with an insert into schema_migrations, so re-running is a no-op"). 33 of 36 files comply. `0024`, `0027`, and `0030` do not. Verified: `grep -ci 'insert into schema_migrations'` returns 0 for all three, and no variant spelling exists (`grep -in 'schema_migrations'` on those three files returns nothing).
- **Why it matters:** Concrete sequence. Production is at `0035`. Someone adds `0036` and runs `pnpm db:migrate`. The runner sees `0024` absent from the ledger, executes it, and hits `create table document_intake_review` at `0024_wave4_automation.sql:3` — a bare `create table` with no `if not exists`. Postgres raises `42P07 duplicate_table`. The transaction rolls back correctly (no damage), the runner throws (`migrate.ts:42`), and **the loop stops there** — `0025` through `0036` are never attempted. `0036` cannot be applied. The API build that needs it is already on Vercel. The operator, under release pressure, now hand-writes `insert into schema_migrations` against the production database — the precise manoeuvre that `0017_restore_missing_pilot_workspace.sql:56-61` exists to clean up after the last time, and the one where transposing a version number silently skips a real migration. The README advertises the opposite: `README.md:71` and `database/README.md:66` both say `pnpm db:migrate # apply pending migrations (idempotent)`, and `database/README.md:82` claims "each recording its own version in `schema_migrations`".
- **Why CI cannot see it:** `ci.yml:128-162` migrates a *fresh* Postgres container. `grep -rn "runMigrations"` shows three call sites and none of them runs the migrator twice. No test asserts that a migration file self-records. The failure is invisible until it happens on the one database that matters.
- **Fix:** (1) Move ledger insertion into the runner — `await client.query('insert into schema_migrations (version) values ($1)', [version])` between `migrate.ts:37` and `:38`, inside the same transaction, and make it `on conflict do nothing` so the 33 self-recording files stay valid. (2) Add a CI assertion that every `database/migrations/*.sql` either self-records or that the runner covers it. (3) Add a CI step that runs `runMigrations` **twice** against the same container and asserts the second call returns `[]`. (4) Before the next release, reconcile the production ledger deliberately: confirm `document_intake_review`, `event_action_plan`, `professional_review_request`, `ai_action_confirmation`, `professional_review_transition` all exist and match the committed DDL, then insert the three missing versions in one reviewed transaction with a backup taken first.
- **Confidence:** CONFIRMED

### [BLOCKER] There is no staging database; "staging" is a banner, and previews are wired to the production API

- **ID:** REL-02
- **File:** `docs/operations/production-release-and-recovery.md:15-22`; `apps/web/src/environment.ts:6-10`; `apps/web/vercel.json:8`; `DEPLOYMENT.md:5-9,20-27`
- **What:** `DEPLOYMENT.md:5` describes `staging` as a branch that "produces a Vercel Preview deployment" — of the same two Vercel projects, not a separate stack. `apps/web/src/environment.ts:9` classifies any `*.vercel.app` hostname as "staging" purely to show a purple banner; nothing about the backend changes. `apps/web/vercel.json:8` rewrites `/api/:path*` to the hardcoded literal `https://care-platform-api.vercel.app` on **every** deployment, previews included. `DEPLOYMENT.md:20-27` lists a single set of web variables and states "Both authentication variables are required in Preview and Production", pointing preview builds at the same Supabase project. `.env.example` has no `VERCEL_ENV` branch and no staging/production split anywhere in its 129 lines. The team's own runbook says it outright: "Staging and production still need separate Supabase projects" and "Staging must never use the production database or private Storage bucket" (`:17-18`, `:22-23`) — written as an open launch blocker, not a solved one.
- **Why it matters:** Every "staging rehearsal" described in `PILOT_RELEASE.md` and `DEPLOYMENT.md` is executed against live customer data. A preview deployment of an in-progress branch — with a half-finished write path, a bad migration assumption, or a loop that re-saves workspaces — mutates production rows. Because `PILOT_RELEASE.md:60` gates promotion on "the same commit passes every gate above", the team is systematically encouraged to exercise unmerged code against production. This is the classic catastrophic mistake and it is currently the documented process, not an accident waiting to happen.
- **Fix:** Create a second Supabase project. Scope `DATABASE_URL`, `SUPABASE_*`, `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_STORAGE_BUCKET` per Vercel environment (Production / Preview / Development are separate scopes in the Vercel dashboard — verify none of them is currently set to "All Environments"). Replace the hardcoded host in `apps/web/vercel.json:8` with a per-environment value, or delete the rewrite (nothing in `apps/web/src` fetches `/api/*` — the client uses `API_BASE_URL` from `apps/web/src/api/client.ts:47` — so it is currently dead config aimed at production). Add a boot assertion in `apps/api` that refuses to start when `VERCEL_ENV !== 'production'` and the connection string points at the production project ref.
- **Confidence:** CONFIRMED (repo evidence). The exact Vercel per-environment variable scoping is dashboard state — NEEDS-VERIFICATION for that one detail, but the runbook's own statement settles the substance.

### [HIGH] The migration runner has no concurrency lock, no environment guard, and no dry-run

- **ID:** REL-03
- **File:** `packages/db/src/migrate.ts:11-48`; `packages/db/src/cli.ts:16-44`; contrast `packages/db/src/rls-check-ci.ts:19-22`
- **What:** No `pg_advisory_lock` anywhere in the runner (repo-wide, the only advisory lock is inside a plpgsql body at `0019_backfill_self_service_accounts.sql:29`). `cli.ts:17` reads `DATABASE_ADMIN_URL` and connects — it never checks which environment that is, never prints a plan, never asks for confirmation, never records what it did beyond stdout (`cli.ts:36-39`). The CI RLS harness *does* guard its target (`rls-check-ci.ts:19-22` refuses any non-loopback host) — the production-facing runner does not.
- **Why it matters:** Two failure modes. (a) Two operators, or one operator and a retried terminal, run `db:migrate` concurrently: both read the ledger, both see the same version pending, both execute the DDL, one gets a duplicate-object error mid-sequence and leaves the run partially advanced. Vercel does not trigger migrations (neither `vercel.json` runs `db:migrate`; the build commands at `apps/web/vercel.json:5` and `apps/api/vercel.json:4` only build), so this is human concurrency rather than deploy concurrency — but `AGENTS.md` describes a multi-agent workflow, which makes two people at two terminals the expected case, not the exotic one. (b) An operator with a production `.env.local` open in one window runs what they believe is a local migration. Nothing stops them.
- **Fix:** Wrap the whole loop in `select pg_advisory_lock(<constant>)` / `pg_advisory_unlock` around `migrate.ts:22-46` (a session-level lock, since transaction-level would release at each `commit`). Add a `--dry-run` that prints the pending list and exits. Require an explicit `--yes-production` flag or an interactive confirmation when the host is not loopback. Append each applied version, timestamp and operator to a release log.
- **Confidence:** CONFIRMED

### [HIGH] Migration 0030 is a breaking change that makes a code rollback fail with constraint violations

- **ID:** REL-04
- **File:** `database/migrations/0030_human_escalation_lifecycle.sql:15-20,36-38`; contrast `database/migrations/0027_product_differentiation_completion.sql:12`
- **What:** `0027:12` created `professional_review_request.status` with `check (status in ('draft','open','in_review','resolved','cancelled'))` and `default 'open'`. `0030:15-17` rewrites existing `'draft'`/`'open'` rows to `'requested'`, `0030:18-20` installs a new `CHECK` that **no longer permits** `'draft'` or `'open'`, and `0030:36-38` adds `check (status <> 'resolved' or resolution_note is not null)` — a conditional NOT NULL on a column that did not exist one migration earlier.
- **Why it matters:** `DEPLOYMENT.md:8` and `PILOT_RELEASE.md:37` both define rollback as "redeploy the last known-good production commit". Do that across `0030` and the restored API build writes `'open'` (its `0027`-era default) into a column whose constraint now rejects it, and resolves reviews without a `resolution_note` into a constraint that now requires one. Both surface as `23514 check_violation` — a 500 on the escalation path, not a graceful degradation. The `0030` author clearly *understood* expand/contract, because `:24-26` explicitly preserves the legacy `assigned_to` column "(expand-only release policy)" — the discipline was applied to the column and skipped on the constraints. It also passes CI cleanly: `migration-safety.ts` has no rule for constraint narrowing and none for `UPDATE`.
- **Fix:** For the constraint half, the expand form is: add the new statuses to the `CHECK` *without* removing the old ones, ship code that stops writing the old ones, wait one stable release, then contract. For `review_resolution_note_consistent`, add it `NOT VALID` first so it constrains only new rows, and validate in the following release. Going forward, add a "rollback compatibility" line to the release checklist at `production-release-and-recovery.md:95-108` that names the oldest build the new schema still accepts.
- **Confidence:** CONFIRMED

### [HIGH] The `/ready` deployment gate is blind to every migration after 0021

- **ID:** REL-05
- **File:** `apps/api/src/container.ts:611-657`, specifically the probe at `:632-638`
- **What:** Readiness in production checks exactly six database objects: `resolve_caredesk_actor`, `tenant_workspace`, `workspace_file`, `list_caredesk_family_members`, `product_subscription`, `workflow_instance`. The newest of these arrives in `0021_visa_renewal_persistence.sql`. Nothing from `0023` onward is checked — not `payroll_month_close`, `document_intake_review`, `event_action_plan`, `payroll_entry`, `automation_execution_receipt`, `professional_review_request`, `professional_review_transition`, `binder_export_receipt`, `regulation_rule`, `leave_entry`, `scenario_expense`, or `tenant_workspace_history`.
- **Why it matters:** `DEPLOYMENT.md:62-63` makes `/ready` a deployment blocker ("A 503 is a deployment blocker, even when `/health` is green") and `PILOT_RELEASE.md:28` repeats it. But given REL-01 — where the migration run aborts and the operator may not notice the non-zero exit in a scrollback — the API deploys, `/ready` returns `ready: true`, the release is signed off, and the first customer to open the payroll or escalation screen gets a `42P01 undefined_table` 500. The gate that exists specifically to catch "required migrations are missing" (`container.ts:649`) reports green on a database 14 migrations behind the code.
- **Fix:** Replace the hand-maintained `to_regclass` list with a ledger comparison: have the build embed the highest migration version present in `database/migrations/` at build time, and have `/ready` fail when `select max(version) from schema_migrations` is below it. That single check subsumes the six object probes and cannot go stale.
- **Confidence:** CONFIRMED

### [HIGH] The migration safety scanner has four exploitable blind spots

- **ID:** REL-06
- **File:** `packages/db/src/migration-safety.ts:13-58` (rules), `:64-69` (`executableSql`), `:88-116` (driver); invoked at `.github/workflows/ci.yml:60-61`
- **What:** Four gaps, in descending order of how likely they are to be hit:
  1. **No `UPDATE` rule.** `DESTRUCTIVE_RULES` covers `DROP TABLE`, `DROP SCHEMA`, `TRUNCATE`, `DELETE FROM`, `DROP COLUMN`, `RENAME COLUMN`, `ALTER COLUMN ... TYPE`, `SET NOT NULL`. A bulk `UPDATE ... SET` destroys customer data exactly as thoroughly as a `DELETE` and is not mentioned. `0030:15-17` — the one in-place rewrite in the set — sailed through.
  2. **String-literal bypass.** `executableSql` at `:68` replaces every `'...'` literal with `''` before matching. So `execute 'truncate task'` is invisible to all eight rules. This is not hypothetical syntax: `0018:76` and `0019:131` already use exactly this `execute '<ddl>'` idiom. A `DO $$ ... EXECUTE '<destructive>' ... $$` block passes clean.
  3. **Bounded lookahead.** The `drop-column`, `alter-column-type` and `set-not-null` patterns (`:41,:51,:56`) use `[\s\S]{0,400}` / `{0,250}` windows between `alter table` and the dangerous keyword. A migration with a long `ALTER TABLE ... ADD COLUMN ... , ... , DROP COLUMN x` — like the four-column `0026_canonical_product_intelligence.sql:3-11` shape — can push the keyword past the window.
  4. **No lock/ordering rules at all.** Nothing flags `CREATE INDEX` without `CONCURRENTLY` on an existing table, `ADD CONSTRAINT` (CHECK or FK) without `NOT VALID`, a duplicate migration number, or a file that omits its `schema_migrations` insert. Those are the four checks that would have caught REL-01, REL-04, REL-07 and REL-08 respectively.
- **Why it matters:** The team correctly treats this check as authoritative — `migration-safety-cli.ts:77-79` prints "Do not bypass this check", and `database/README.md:76-77` says "CI rejects edits to applied migrations and common destructive or rolling-deployment-incompatible changes". A green check reads as "this migration is safe to run on production". For a bulk `UPDATE` or an unconcurrent index, it is not saying that.
- **Fix:** Add rules for `\bupdate\s+\w+\s+set\b`, `create\s+index(?!\s+concurrently)` on a table not created in the same file, and `add\s+constraint(?![\s\S]*not\s+valid)`. Match against the pre-strip SQL for the `execute '...'` case (or strip comments only, not literals). Add a structural check: every `database/migrations/NNNN_*.sql` must contain exactly one `insert into schema_migrations` naming its own version, and no two files may share an `NNNN`. All four are cheap and all four are file-local.
- **Confidence:** CONFIRMED

### [MEDIUM] Indexes and constraints are added to live tables without `CONCURRENTLY`/`NOT VALID`, and no lock timeout bounds the damage

- **ID:** REL-07
- **File:** `0020_sprint_zero_database_hardening.sql:8-28,32-33`; `0025_wave5_collaboration_engagement.sql:5-7`; `0026_canonical_product_intelligence.sql:8-11`; `0030_human_escalation_lifecycle.sql:18-20,36-38`. No `lock_timeout`/`statement_timeout` anywhere (grep clean).
- **What:** Four `CREATE INDEX` on existing tables (`0020:8-28`), a `UNIQUE` constraint on `tenant_membership` (`0020:32-33`), an unvalidated-then-validated FK on `task` (`0025:5-6` — no `NOT VALID`), a `CREATE INDEX` on `task` (`0025:7`), and three `ADD CONSTRAINT ... CHECK` without `NOT VALID` (`0026:8-11`, `0030:18-20`, `0030:36-38`).
- **Why it matters:** `CREATE INDEX` without `CONCURRENTLY` holds a `SHARE` lock — reads continue, **all writes block** until the index is built. `ADD CONSTRAINT ... CHECK` and a non-`NOT VALID` FK take `ACCESS EXCLUSIVE` plus a full table scan — reads *and* writes block. On today's pilot volumes each is milliseconds. On `audit_event` after a year of a growing customer base, it is a write outage of minutes. The compounding factor is the absent `lock_timeout`: an `ACCESS EXCLUSIVE` request that cannot be granted immediately (one long-running report is enough) sits in the lock queue and **every subsequent query on that table queues behind it**, converting a slow migration into a total table outage. Note the structural constraint: `CONCURRENTLY` cannot be used at all while the runner wraps each file in a transaction (`migrate.ts:36-38`), so this needs a deliberate escape hatch, not just discipline.
- **Fix:** Set `set local lock_timeout = '3s'` and a `statement_timeout` at the top of each migration transaction (or issue them in `migrate.ts` right after `begin`) so a blocked `ALTER` fails fast and retries instead of freezing the table. Adopt `NOT VALID` + a separate `VALIDATE` for every new `CHECK`/FK — `0020:50-55` already demonstrates the pattern and even documents why. For indexes on large existing tables, add an opt-out marker (e.g. a `-- migrate:no-transaction` header the runner honours) so `CONCURRENTLY` becomes available.
- **Confidence:** CONFIRMED

### [MEDIUM] Two migrations share the number 0026 and nothing enforces uniqueness

- **ID:** REL-08
- **File:** `database/migrations/0026_canonical_product_intelligence.sql` and `database/migrations/0026_wave5_worker_authorization.sql`; ordering determined at `packages/db/src/migrate.ts:22-24`
- **What:** Two distinct migrations carry the prefix `0026`. Ordering falls out of a lexicographic `.sort()` (`migrate.ts:24`), so `canonical` happens to run before `wave5` — deterministic, but by accident of the letter `c` preceding `w`, not by design. `migration-safety.ts` validates the *filename shape* (`MIGRATION_PATH` at `:11`) but never checks that a number is unused, and `README.md` for migrations (`database/migrations/README.md:3-5`) states the convention as prose only.
- **Why it matters:** These two `0026`s are independent, so nothing broke. But `AGENTS.md:25-30` describes parallel agents working on separate branches, and `migration-safety.ts:97` classifies a new file as `A` (added) with no cross-branch awareness. Two agents both writing `0036_*.sql` both pass CI; whichever merges second silently becomes "later" or "earlier" depending on its filename spelling. If one depends on the other's table, the migration run fails on production with a missing-relation error — and per REL-01's mechanics, aborts the whole sequence.
- **Fix:** Add a check (in `migration-safety.ts` or a standalone `scripts/check-migration-numbers.mjs` wired into `pnpm lint`) asserting that migration numbers are unique and that a newly added migration's number is strictly greater than every number already on `origin/main`. The second half also blocks the merge-order hazard.
- **Confidence:** CONFIRMED

### [MEDIUM] No down migrations, and three migrations perform irreversible bulk writes to customer tenants

- **ID:** REL-09
- **File:** `database/migrations/` (no `*_down.sql`, no `rollback` directory — directory listing confirms); `0019_backfill_self_service_accounts.sql:65-96`; `0030_human_escalation_lifecycle.sql:15-17`; `0032_regulation_rule_lifecycle.sql:109+`
- **What:** There is no reverse path for any migration. Three of them write customer data in bulk: `0019` creates a `tenant` + `family_account` + `tenant_membership` for every Auth user missing one; `0030:15-17` rewrites review statuses; `0032` cross-joins `tenant` to insert reviewed regulation content into **every** tenant. None batches, none verifies row counts, none is reversible.
- **Why it matters:** The team's own rule at `production-release-and-recovery.md:82` says "backfill in bounded, restartable batches and verify row counts". These three do none of that — they are single unbounded statements inside one transaction. If `0032`'s seed content turns out to be wrong (it is Hebrew legal reference text, permanently marked `requires_professional_validation = true`, per its own comment at `:102-109`), it is now in every customer's database and the only removal path is hand-written SQL against production. `production-release-and-recovery.md:110-113` correctly states that code rollback does not roll the database back — that is honest, but it leaves data-migration mistakes with no rehearsed remedy, on a project where `0035:5` records that point-in-time recovery is not enabled.
- **Fix:** Require every data-writing migration to be batched and restartable, to log affected row counts, and to ship with a written reverse statement in a comment block even if no down-migration runner exists. Keep reference content like `0032`'s seed out of migrations entirely — it is application data with a lifecycle, and `apps/api/src/regulation-rule-service.ts` already holds a parallel copy (`0032:107-108` acknowledges the duplication and asks a human to keep both in sync).
- **Confidence:** CONFIRMED

### [MEDIUM] `pnpm db:rls-test` writes to, and deletes from, production tables with a BYPASSRLS connection and no environment guard

- **ID:** REL-10
- **File:** `package.json:13`; `packages/db/src/rls-check.ts:101-114,260-261,551,558-578`; contrast `packages/db/src/rls-check-ci.ts:19-22`
- **What:** `PILOT_RELEASE.md:10` step 4 and `database/README.md:67` both instruct running `pnpm db:rls-test` against the live Supabase project as part of release. The script connects with the owner/BYPASSRLS credential, inserts two synthetic tenants' worth of rows across ~40 tables, executes `create table rls_probe_should_fail` (`:551`), then in its `finally` block runs `drop table if exists rls_probe_should_fail` (`:558`) followed by **16 `DELETE` statements** (`:559-578`). Its CI sibling refuses any non-loopback host (`rls-check-ci.ts:19-22`); this one has no host check, no environment check, no confirmation.
- **Why it matters:** As written today it is safe — the deletes are scoped by `tenant_id` to two `randomUUID()` fixtures (`:101-114`, `:260-261`), so no customer row matches. But it is a script whose documented purpose is to run against production, which holds the one credential that bypasses every RLS policy, whose cleanup block is a wall of unqualified-looking `delete from <table>`, and which has nothing — no guard, no dry-run, no test — standing between a careless edit to one `WHERE` clause and mass deletion of customer data. `migration-safety.ts` does not scan `.ts` files, so no CI check covers it either. It also leaves DDL side effects on the production schema (`create table` / `drop table` at `:551,:558`).
- **Fix:** Add an explicit opt-in guard mirroring `rls-check-ci.ts:19-22` — refuse to run unless `CAREDESK_RLS_TEST_ALLOW_REMOTE=1` is set *and* the operator passes the expected project ref. Assert before each cleanup `DELETE` that the target `tenant_id` is one of the two fixtures created in this process. Move the probe table into a scratch schema so a failed run cannot leave objects in `public`.
- **Confidence:** CONFIRMED (behaviour); the "safe as written" assessment is CONFIRMED by reading the fixture construction.

### [MEDIUM] Web and API deploy independently with no version negotiation or contract check

- **ID:** REL-11
- **File:** `DEPLOYMENT.md:13-33`; `apps/web/src/api/client.ts:36-47`; `apps/web/vercel.json`; `apps/api/vercel.json`; no versioning found (grep for `apiVersion`, `X-API-Version`, `/v1/` returns only Supabase's own endpoint URLs)
- **What:** Two separate Vercel projects, each triggered by the same push to `main`, each building and deploying on its own timeline. Routes are unversioned. The web client resolves a base URL (`client.ts:36-47`) and sends requests — no version header, no capability handshake, no negotiated contract. `@caredesk/schemas` is shared, but only at compile time: each app bakes its own copy at build, so agreement holds only if both projects deploy from the same commit, which nothing enforces or verifies.
- **Why it matters:** Every promotion has a skew window of however long the slower build takes. New web + old API → the new UI calls a route that does not exist yet (404) or posts a field the old handler's Zod schema rejects (400). Old web + new API → a response shape the old client cannot parse. Neither is data loss, but both are user-visible failures during every release, and they are exactly the sort of thing that gets misdiagnosed as a broken deploy and "fixed" with a rollback — which, per REL-04, has its own hazard. There is no way to detect skew after the fact: nothing reports the commit each project is serving.
- **Fix:** Have both builds embed their git SHA and expose it (`/health` already exists at `apps/api/src/create-server.ts`). Have the web log or surface a mismatch. Longer term, version the API surface, or make the web tolerate a 404 on a not-yet-deployed route by degrading rather than erroring. At minimum, add a release step that verifies both projects report the same SHA before the release is signed off.
- **Confidence:** CONFIRMED

### [MEDIUM] No feature flags: every change is live for every customer at merge

- **ID:** REL-12
- **File:** NOT FOUND — no flag mechanism in `apps/` or `packages/`. Aspirational references only: `docs/governance/next-delivery-wave-gap-analysis.md:168` ("Notification producers need a feature flag/kill switch"), `docs/architecture/strangler-migration.md:36` ("Feature-flag/cohort cutover"), `docs/adr/ADR-003-ai-provider-and-data-minimization.md:64` ("Kill switch and safe fallback demonstrated").
- **What:** There is no runtime flag system, no cohort mechanism, no dark-launch path. The closest analogue is env-var configuration: `BILLING_PROVIDER=disabled` (`.env.example:71`) and `BILLING_LAUNCH_DISCOUNT_PERCENT=100` (`:77`) gate the billing subsystem, and `AI_PROVIDER=mock` (`:95`) gates AI — all requiring a redeploy to change, all all-or-nothing across every tenant.
- **Why it matters:** The team's own architecture documents assume flags exist for exactly the risky work they have planned: the strangler cutover at `strangler-migration.md:36` specifies "Feature-flag/cohort cutover, monitoring, rollback rehearsal" as the gate for read cutover to normalized storage. Without flags, the only rollback lever is a full redeploy — which, per REL-04 and `production-release-and-recovery.md:110`, does not undo the schema change that shipped with it. A risky change cannot be exposed to one pilot tenant first, and cannot be switched off in seconds when it misbehaves.
- **Fix:** A minimal flag table keyed by `(tenant_id, flag_key)` behind the existing RLS model, read once per request in the container, with a global default — enough for cohort rollout and an instant kill switch, without a third-party service. Even a simple env-var-driven allowlist of tenant IDs would cover the pilot-customer-first case.
- **Confidence:** CONFIRMED

### [LOW] Applied-migration immutability is measured against `main`, not against what production actually ran

- **ID:** REL-13
- **File:** `packages/db/src/migration-safety.ts:97-102`; `packages/db/src/migration-safety-cli.ts:10-21`
- **What:** The immutability rule rejects any migration whose git status is not `A` relative to the comparison base — `origin/$GITHUB_BASE_REF` in CI (`migration-safety-cli.ts:16-18`), `HEAD^` locally (`:20`). This works, and history confirms it: no migration in this repo has ever been edited after reaching `main`. The two files with multiple commits (`0024`: `254a5cd` after `33bbd05`, PR #41; `0035`: `ea3ca81` after `1e94dff`, PR #102) were both edited *within their own PR before merge*, which is legitimate and correctly permitted.
- **Why it matters:** The check equates "not yet merged" with "not yet applied". But migrations are applied manually by an operator from a local checkout (`PILOT_RELEASE.md:8`, `database/README.md:39`) — which may be a feature branch. If someone runs `pnpm db:migrate` from an unmerged branch against a shared or production database and then edits that migration before merge, the check reports `A` and passes, while the database holds the earlier text forever. `0024` is the live illustration: `254a5cd` rewrote its RLS policies from `app.current_tenant_id()` to `current_setting('app.tenant_id', true)::uuid`. Had the pre-edit version been applied anywhere, that database now has policies that differ from the committed file and — because of REL-01 — no ledger row recording which version it got.
- **Fix:** Make the ledger record a content hash: extend `schema_migrations` with a `checksum` column, have the runner compute and store it, and have `/ready` or a `db:verify` command compare stored checksums against the files on disk. That detects drift regardless of git state. Separately, document that migrations are applied only from `main`.
- **Confidence:** CONFIRMED (mechanism); NEEDS-VERIFICATION whether any migration was ever applied from an unmerged branch — that is operator history, not repo state.

### [LOW] The migration connection disables TLS certificate verification

- **ID:** REL-14
- **File:** `packages/db/src/pool.ts:20-26`, specifically `ssl: { rejectUnauthorized: false }` at `:23`
- **What:** Every pool — including the owner/admin pool that `cli.ts:30` uses to apply migrations to production Supabase — connects with certificate verification disabled. The comment at `:16-19` acknowledges it: "we require TLS but don't pin a CA here (the managed endpoint is trusted); tighten to a pinned CA before production."
- **Why it matters:** Mostly a security finding and largely another agent's scope, but it lands on the deploy path: this is the connection that carries DDL and the owner credential to production. An attacker positioned between the operator and Supabase can present any certificate.
- **Fix:** Pin Supabase's CA bundle and set `rejectUnauthorized: true` for the admin connection at minimum. The TODO is already written at `pool.ts:19`.
- **Confidence:** CONFIRMED

### [LOW] No release artifact ties a deployed build to the schema version it requires

- **ID:** REL-15
- **File:** `DEPLOYMENT.md:8`; `PILOT_RELEASE.md:37`; `docs/operations/production-release-and-recovery.md:95-113`
- **What:** The release record captures the promoted commit SHA (`DEPLOYMENT.md:8`) and "the last known-good commit and Vercel rollback deployment" (`PILOT_RELEASE.md:37`). Nothing records which migration numbers were applied for that release, or which range of migrations a given build tolerates.
- **Why it matters:** This is what makes "roll back to the last known-good commit" a guess rather than a decision. An operator at 2am cannot answer "does build X work against schema 0035?" without reading migrations. Given REL-04, the answer is sometimes no.
- **Fix:** Add two lines to the release record: highest applied migration, and the oldest build SHA still compatible with it. Embed the required migration version in the build (see REL-05's fix) so the answer is mechanical.
- **Confidence:** CONFIRMED

## Safe-release checklist this repo should adopt

Ordered so that the first four are prerequisites for shipping anything, and the rest harden the
process afterwards.

**Before the next release can happen at all**

1. Reconcile the production `schema_migrations` ledger for `0024`, `0027`, `0030` — after a verified
   backup, in one reviewed transaction, having first confirmed the five affected tables exist and
   match the committed DDL. (REL-01)
2. Move the ledger insert into `packages/db/src/migrate.ts` with `on conflict do nothing`, and add a
   CI test that runs `runMigrations` twice and asserts the second call returns `[]`. (REL-01)
3. Stand up a separate Supabase project for staging, scope every Vercel variable per environment,
   and remove the hardcoded production API host from `apps/web/vercel.json:8`. (REL-02)
4. Add an environment guard and a `--dry-run` to `pnpm db:migrate`, and an advisory lock around the
   apply loop. (REL-03)

**Every migration, enforced in CI rather than reviewed by eye**

5. Exactly one `insert into schema_migrations` per file, naming its own version.
6. Migration numbers unique, and strictly greater than every number on `origin/main`. (REL-08)
7. `set local lock_timeout` and `statement_timeout` at the head of every migration transaction, so a
   blocked `ALTER` fails fast rather than freezing the table behind it. (REL-07)
8. New `CHECK` and FK constraints added `NOT VALID`, validated in a separate statement — the pattern
   `0020:50-55` already establishes. (REL-04, REL-07)
9. Scanner rules for `UPDATE ... SET`, `CREATE INDEX` without `CONCURRENTLY` on a pre-existing table,
   `ADD CONSTRAINT` without `NOT VALID`, and destructive SQL inside `execute '<literal>'`. (REL-06)
10. Data-writing migrations batched, restartable, and row-count-verified, with the reverse statement
    written in a comment even absent a down-runner. (REL-09)

**Every release**

11. `/ready` compares `max(schema_migrations.version)` against the version the build requires, so a
    behind-schema database fails the deployment gate. (REL-05)
12. Both Vercel projects report the same git SHA before sign-off. (REL-11)
13. Release record names: promoted SHA, highest applied migration, oldest still-compatible build SHA.
    (REL-15)
14. Verified backup taken before any migration touches production — the procedure at
    `production-release-and-recovery.md:38-70` is already written; it needs to be executed and its
    checksum record filed, not rewritten.
15. Migrations applied only from `main`, never from a feature branch. (REL-13)

**Structural, worth doing before the customer base grows**

16. A `checksum` column on `schema_migrations` plus a `db:verify` command, so schema drift is
    detectable rather than assumed away. (REL-13)
17. A minimal per-tenant feature flag table, giving cohort rollout and a sub-minute kill switch that
    does not require a redeploy. (REL-12)
18. An opt-out marker letting a specific migration run outside a transaction, so `CREATE INDEX
    CONCURRENTLY` becomes available for large tables. (REL-07)

## Coverage note

**Read in full:** `package.json`, `packages/db/src/migrate.ts`, `cli.ts`, `pool.ts`,
`migration-safety.ts`, `migration-safety-cli.ts`, `rls-check-ci.ts`, `packages/db/package.json`,
`.github/workflows/ci.yml`, all four `scripts/check-*.mjs`, `DEPLOYMENT.md`, `PILOT_RELEASE.md`,
`AGENTS.md`, `.env.example`, both `vercel.json`, `docs/operations/production-release-and-recovery.md`,
`database/README.md`, `database/migrations/README.md`, `database/seed/README.md`,
`apps/web/src/environment.ts`, and migrations `0001`, `0016`, `0017`, `0020`, `0026` (both), `0030`,
`0035`.

**Read in part:** `packages/db/src/rls-check.ts` (fixture construction, guards, cleanup block),
`apps/api/src/container.ts` (readiness), `apps/web/src/api/client.ts` (base URL resolution),
`apps/api/src/routes/product-differentiation.ts` (escalation status writes), `0019`, `0024`, `0027`,
`0032`, `docs/governance/RELEASE-GATE.md`, `docs/governance/VERIFY-PRODUCTION.md`.

**Scanned systematically:** all 36 files in `database/migrations/*.sql` via targeted greps for
`drop`, `truncate`, `delete from`, `alter column`, `set not null`, `rename`, `create index`,
`not null default`, `add column`, `update ... set`, `insert into`, `commit`, `concurrently`,
`create type`, `alter type`, `vacuum`, `create extension`, plus a per-file count of
`insert into schema_migrations`. Git history checked per migration file for post-merge edits.

**Verified negatives (searched, genuinely absent):** feature-flag mechanism; API version prefix or
version header; down/rollback migrations; `pg_advisory_lock` in the runner; `lock_timeout` /
`statement_timeout`; seed script under `database/seed/`; `VERCEL_ENV` handling in either app; any
`db:migrate` invocation in a Vercel build command.

**Not verified — outside repo state, needs a human with dashboard access:**
- Whether `required-quality-gates` (`ci.yml:210`) is actually configured as a required status check
  in GitHub branch protection. The job is correctly written to fail unless all seven upstream jobs
  succeed (`:232-239`), but a workflow cannot enforce its own requiredness.
- Vercel per-environment variable scoping — specifically whether `DATABASE_URL` and the Supabase
  variables on the API project are set to "All Environments" (the dashboard default when adding a
  variable, and the condition that would make REL-02 immediately exploitable) or scoped to
  Production only.
- Whether any migration has ever been applied to a shared database from an unmerged branch (REL-13).
- The current production `schema_migrations` contents — the REL-01 analysis predicts `0024`, `0027`
  and `0030` are absent; confirming that before the next release is the single highest-value check
  in this report.

**Explicitly out of scope, covered by other agents:** API route logic and authorization, frontend
behaviour, RLS policy correctness (assessed here only where a migration's lock or ordering profile
depends on it), backup/DR adequacy, and the domain layer.
