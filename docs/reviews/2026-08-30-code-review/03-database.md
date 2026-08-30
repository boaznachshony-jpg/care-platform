# Database / Persistence Review

Scope: `database/migrations/0001..0035`, `database/README.md`,
`database/rls-test-harness-design.md`, `database/seed/**`,
`database/docker-compose.yml`, `packages/db/**`.
All 36 migration files read in full and in order; all 34 files in `packages/db/src` read.

## Summary

The schema itself is unusually disciplined. Every one of the 55 tenant-owned tables has
`ENABLE` + `FORCE ROW LEVEL SECURITY` and a permissive `FOR ALL` policy carrying **both**
`USING` and `WITH CHECK`. **Zero tables holding customer data are missing full RLS
coverage.** Cross-tenant references are structurally impossible on almost every FK because
the codebase consistently uses composite `(tenant_id, id)` foreign keys rather than plain
`id` references. There is not a single `ON DELETE CASCADE` in the entire schema — no FK
declares any `ON DELETE` action at all, so nothing can silently wipe customer history.
Money is `numeric(12,2)` or integer agorot everywhere; there is no float, `real`, or `money`
column in the schema. The append-only stance (grant `select, insert` only) is applied
consistently to `audit_event`, `timeline_event`, `document_version`, `payroll_month_close`,
`binder_export_receipt`, the two transition-history tables, and `tenant_workspace_history`.

The defects are not in the DDL. They are at the seams:

1. **Eight newer API services set the tenant GUC but skip `SET LOCAL ROLE caredesk_app`**,
   abandoning the exact defence that `packages/db/src/pool.ts` was written to provide, on
   tables including `payroll_entry`, `leave_entry`, `regulation_rule`, `worker_portal_access`
   and `audit_event`. Under the interim configuration that `database/README.md` itself
   documents (DATABASE_URL still on the owner), those paths have no tenant isolation at all
   while everything routed through `withTenant()` stays safe.
2. **Three migrations never record themselves in `schema_migrations`** and the runner relies
   entirely on the SQL file to do so, so `runMigrations` re-executes them on the next run and
   throws — permanently wedging every subsequent migration.
3. **Production does not fail closed onto Postgres.** `DATABASE_URL` is optional in `env.ts`,
   `buildContainer` silently builds the in-memory repositories when it is absent, and
   `index.ts` starts serving regardless of `readiness()`.
4. `tenant_workspace` still carries a `DELETE` grant with no delete-side archive trigger, so
   the newest workspace version — the one migration 0035 exists to protect — can still be
   destroyed with no recovery path.
5. `payroll_entry.total` is stored verbatim from the client with no reconciliation CHECK,
   unlike `payroll_month_close` which has one.

Sensitive-data handling is genuinely careful (no passport/ID/bank columns exist; migration
0003 and `sensitive-record-migration-requirements.md` explicitly defer them; workspace payload
is AES-256-GCM with tenant id as AAD; `sealed_payment_token` is app-encrypted;
`worker_portal_invitation.token_hash` is hashed with a length floor). The one at-rest plaintext
exposure found is a historical artefact in `tenant_workspace_history` (DB-05).

## RLS coverage matrix

Every tenant-scoped policy in this schema is a single permissive `CREATE POLICY … ON t
USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
WITH CHECK (same)` with **no `FOR` clause**, i.e. `FOR ALL`. A `FOR ALL` policy with both
clauses applies `USING` to SELECT/UPDATE/DELETE and `WITH CHECK` to INSERT/UPDATE, so a
single row in the table below covers all four columns. `caredesk_app` grants are listed
because they are the second half of the write story (a `WITH CHECK` that is never reachable
because there is no grant is stronger, not weaker).

Legend: ✓ = present. `S/I/U/D` = grants held by `caredesk_app`.

### Tenant-owned tables (55) — all fully covered

| table | migration | RLS | FORCE | SELECT pol | INSERT WITH CHECK | UPDATE WITH CHECK | DELETE pol | app grants |
|---|---|---|---|---|---|---|---|---|
| family_account | 0002/0004 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | S I U D |
| tenant_membership | 0002/0004 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | S I U D |
| permission_grant | 0002/0004 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | S I U D |
| care_recipient | 0003/0004 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | S I U D |
| employer | 0003/0004 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | S I U D |
| caregiver | 0003/0004 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | S I U D |
| employment_case | 0003/0004 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | S I U D |
| organization | 0006 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | S I U D |
| contact | 0006 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | S I U D |
| contact_channel | 0006 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | S I U D |
| case_contact_role | 0006 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | S I U D |
| task | 0007 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | S I U D |
| timeline_event | 0007 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **S I** (append-only) |
| document | 0008 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | S I U D |
| document_version | 0008 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **S I** (append-only) |
| audit_event | 0009 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **S I** (append-only) |
| tenant_workspace | 0011/0017 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | S I U D — see DB-04 |
| workspace_file | 0012/0017 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | S I U D |
| product_subscription | 0014 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | S I U |
| billing_setup_intent | 0014 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | S I U |
| product_billing_charge | 0014 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **S only** (writes via definer fn) |
| employment_authorization | 0021 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | S I U D |
| workflow_instance | 0021 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | S I U D |
| workflow_rule_evaluation | 0021 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | S I U D |
| workflow_evaluation_source | 0021 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | S I U D |
| workflow_step | 0021 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | S I U D |
| workflow_assignment | 0021 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | S I U D |
| workflow_blocker | 0021 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | S I U D |
| idempotency_record | 0021 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **S I** — see DB-08 |
| workflow_contact_activity | 0022 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **S I** |
| employment_authorization_link | 0022 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **S I** |
| authorization_overlap_review | 0022 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | S I U |
| workflow_completion | 0022 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **S I** |
| payroll_month_close | 0023 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **S I** |
| document_intake_review | 0024 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | S I U |
| event_action_plan | 0024 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **S I** |
| case_responsibility_assignment | 0025 (DO loop) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | S I U |
| worker_portal_access | 0025 (DO loop) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | S I U |
| worker_portal_invitation | 0025 (DO loop) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | S I U |
| worker_payment_acknowledgement | 0025 (DO loop) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **S I** |
| worker_request | 0025 (DO loop) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | S I U |
| communication_preference | 0025 (DO loop) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | S I U |
| notification_intent | 0025 (DO loop) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | S I U |
| notification_delivery_attempt | 0025 (DO loop) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | S I U |
| professional_review_request | 0027 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | S I U |
| ai_action_confirmation | 0027 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **S I** |
| payroll_entry | 0028 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | S I U |
| automation_execution_receipt | 0029 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | S I U |
| professional_review_transition | 0030 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **S I** |
| binder_export_receipt | 0031 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **S I** |
| regulation_rule | 0032 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | S I U |
| regulation_rule_transition | 0032 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **S I** |
| leave_entry | 0033 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | S I U |
| scenario_expense | 0034 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | S I U |
| tenant_workspace_history | 0035 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **S I** |

### Control tables (3)

| table | migration | RLS | FORCE | SELECT pol | INSERT WITH CHECK | UPDATE WITH CHECK | DELETE pol | app grants |
|---|---|---|---|---|---|---|---|---|
| tenant | 0015 | ✓ | ✓ | ✓ (`FOR SELECT TO caredesk_app`, id = current tenant) | ✗ (no policy → denied) | ✗ (denied) | ✗ (denied) | S only |
| app_user | 0015 | ✓ | ✓ | ✗ no policy → **all access denied** | ✗ | ✗ | ✗ | **none** (reached only via SECURITY DEFINER fns) |
| schema_migrations | 0015 | ✓ | ✓ | ✗ no policy → denied | ✗ | ✗ | ✗ | **none** |

Deny-by-default on `app_user` / `schema_migrations` is correct, not a gap.

### Global reference tables with no RLS (6)

| table | migration | RLS | FORCE | note |
|---|---|---|---|---|
| workflow_template | 0021 | ✗ | ✗ | no `tenant_id` column; `SELECT`-only grant to `caredesk_app` |
| workflow_template_version | 0021 | ✗ | ✗ | same |
| workflow_template_step | 0021 | ✗ | ✗ | same |
| visa_rule_definition | 0021 | ✗ | ✗ | same |
| visa_rule_version | 0021 | ✗ | ✗ | same |
| visa_rule_source | 0021 | ✗ | ✗ | same |

These hold no customer data and cannot be written by the application role. They are covered
by 0015's blanket revoke from `anon`/`authenticated` **only if** the default-privileges
revoke in 0015 held for the migration owner — they were created after 0015 ran. See DB-13.

**Count of tables missing full RLS coverage: 0 tenant-owned. 6 global reference tables
(no tenant column, read-only) carry no RLS by design.**

## Findings

### [HIGH] Eight API persistence paths set the tenant context without `SET LOCAL ROLE caredesk_app`

- **ID:** DB-01
- **File:** `apps/api/src/regulation-rule-service.ts:268-277`,
  `apps/api/src/collaboration/wave5-service.ts:87-104`,
  `apps/api/src/binder-export-service.ts:151-163`,
  `apps/api/src/evidence-export-service.ts:187-199`,
  `apps/api/src/payroll-entry-service.ts:64-75`,
  `apps/api/src/leave-entry-service.ts:48-59`,
  `apps/api/src/scenario-expense-service.ts:44-55`,
  `apps/api/src/product-intelligence/canonical-intelligence-service.ts:60-68`
  — contrast `packages/db/src/pool.ts:61-64`
- **What:** `packages/db/src/pool.ts` defines the one correct entry point:
  ```
  await client.query('begin');
  await client.query('set local role caredesk_app');
  await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
  ```
  Eight later services hand-rolled their own transaction helper and kept only the
  `set_config` line. Grepping the whole repo, `set local role` appears in exactly two
  non-test files: `pool.ts` and `rls-check.ts`. Every table these eight services touch —
  `payroll_entry`, `leave_entry`, `scenario_expense`, `regulation_rule`,
  `regulation_rule_transition`, `binder_export_receipt`, `worker_portal_access`,
  `case_responsibility_assignment`, `worker_request`, `professional_review_request`,
  `task`, `timeline_event`, `audit_event`, `employment_case`, `document`,
  `idempotency_record`, `tenant_membership` — is reached without the role switch.
- **Why it matters:** `pool.ts:41-52` states in its own comment that the role switch exists
  precisely for the case where "someone ever points DATABASE_URL back at an administrative
  role". `database/README.md:35-46` documents that exact state as a normal provisioning
  step: "Put that in `.env.local` as `CAREDESK_APP_DB_PASSWORD`, keep `DATABASE_URL` on the
  owner for now". In that window, and in any environment where the app URL is misconfigured
  to the owner, `withTenant()` paths remain isolated while these eight are fully cross-tenant:
  Supabase's `postgres` role has `rolbypassrls = true`, so every policy is skipped. The
  sharpest instance is `regulation-rule-service.ts:286-287`,
  `select role from tenant_membership where user_id=$1 and status='active' limit 1` — the
  authorization check itself relies solely on RLS for tenant scoping, so an owner connection
  turns it into "does this user have a manager role in *any* tenant", i.e. privilege escalation
  across tenants. `evidence-export-service.ts:231-247` would likewise export another tenant's
  audit and timeline rows.
- **Fix:** Delete the seven hand-rolled helpers and route every one through
  `withTenant()` from `@caredesk/db`. If a helper must stay local, make `set local role
  caredesk_app` the first statement after `begin`. Add an assertion to `rls-check.ts` that
  fails when `current_user` inside a tenant transaction is not `caredesk_app` — the file
  already checks this for the pool connection (`rls-check.ts:278-302`) but not for these
  code paths. A lint rule banning `set_config('app.tenant_id'` outside `pool.ts` would make
  the regression impossible to reintroduce.
- **Confidence:** CONFIRMED (the code fact; the cross-tenant consequence is conditional on
  the connecting role, which the README documents as a real interim state).

### [HIGH] Three migrations never record themselves, so the migration runner permanently wedges on the second run

- **ID:** DB-02
- **File:** `packages/db/src/migrate.ts:5-9,27-46`; `database/migrations/0024_wave4_automation.sql:53`
  (file ends after the last grant), `database/migrations/0027_product_differentiation_completion.sql:53`,
  `database/migrations/0030_human_escalation_lifecycle.sql:72`
- **What:** `runMigrations` explicitly delegates version bookkeeping to the SQL file — "each
  migration … self-records its version (the SQL files end with an insert into
  schema_migrations), so re-running is a no-op". 33 of the 36 files do. `0024`, `0027` and
  `0030` do not (verified by counting `insert into schema_migrations` per file: 0 for each).
- **Why it matters:** First run: all migrations apply, three of them unrecorded. Second run
  (any redeploy, any `pnpm db:migrate`): `0024` is not in `applied`, so it re-executes,
  `create table document_intake_review` raises `relation "document_intake_review" already
  exists`, the transaction rolls back and `runMigrations` **throws** at
  `migrate.ts:42`. The loop is sequential, so migration `0025` onward is never reached. A new
  migration `0036` can therefore never be applied to any environment that has already run
  0024 — the schema is frozen at 0035 and the failure looks like an unrelated "already
  exists" error. `0030` is worse than 0024 because it is not even idempotent in isolation:
  `alter table professional_review_request add column assigned_to_name text` has no
  `IF NOT EXISTS`.
- **Fix:** Add a new migration `0036` that inserts the three missing versions
  (`insert into schema_migrations (version) values ('0024_wave4_automation'),
  ('0027_product_differentiation_completion'), ('0030_human_escalation_lifecycle')
  on conflict do nothing;`) — the same repair pattern 0017 already uses at lines 56-61.
  Then stop trusting the SQL file: have `runMigrations` insert the version itself inside the
  same transaction after `client.query(sql)`, and add a `migration-safety` rule that rejects
  any new migration file lacking the self-record line.
- **Confidence:** CONFIRMED.

### [HIGH] Production can silently run on the in-memory repositories; the fail-closed claim holds only at `/readiness`

- **ID:** DB-03
- **File:** `apps/api/src/container.ts:272-279`, `apps/api/src/env.ts:37`,
  `apps/api/src/index.ts:14-37,39-56`, `apps/api/src/container.ts:613-620`
- **What:** `env.ts:37` declares `DATABASE_URL: z.string().optional()` and the production
  `superRefine` block never requires it (it only requires `WORKSPACE_ENCRYPTION_KEY`
  *when* `DATABASE_URL` is present — `env.ts:184-190`). `container.ts:279` then does
  `const pool = env.DATABASE_URL ? createPool(env.DATABASE_URL) : undefined;` and the `else`
  branch at `container.ts:344-355` swaps in `InMemoryCaseFoundationRepository`,
  `InMemoryDocumentRepository`, `InMemoryAuditService`, `InMemoryWorkspaceRepository`,
  `InMemoryBillingRepository` and friends. `index.ts` builds the server and exports it as the
  Vercel handler regardless; `readiness()` is a separate endpoint that reports
  `database: 'unconfigured'` but does not gate traffic, and nothing calls it at boot.
- **Why it matters:** A typo'd or unset `DATABASE_URL` in a production deploy yields a fully
  functional-looking API where every customer write lands in process memory. On Vercel each
  invocation may get a fresh instance, so a family enters payroll data, gets a 200, and the
  data is gone on the next request. The audit trail is an in-process array
  (`in-memory-audit-service.ts:3-8`) — there is no durable record that it happened. The only
  signal is one `app.log.info({ persistence: 'in-memory' })` line at `index.ts:47-50`, which
  is not emitted at all on Vercel (`startLocalServer` is guarded by `!process.env.VERCEL`).
- **Fix:** In `env.ts`, add to the production `superRefine`: `DATABASE_URL`,
  `SUPABASE_URL`/`SUPABASE_PUBLISHABLE_KEY` and the storage settings are required when
  `NODE_ENV === 'production'`. That turns a missing database into a startup failure, which
  `index.ts:25-34` already renders as a 503-everything app with the real message — exactly the
  fail-closed behaviour the docs claim.
- **Confidence:** CONFIRMED.

### [HIGH] `tenant_workspace` still has a DELETE grant, and the 0035 archive trigger only fires on UPDATE

- **ID:** DB-04
- **File:** `database/migrations/0035_workspace_version_history.sql:67-70`;
  grant at `database/migrations/0011_tenant_workspace.sql:23` and re-granted at
  `database/migrations/0017_restore_missing_pilot_workspace.sql:27`
- **What:** Migration 0035 opens with "a single bad write therefore destroyed the customer's
  data with no way back: point-in-time recovery is not enabled on this project, and the
  backup project mirrors documents only". Its fix is
  `create trigger tenant_workspace_archive_previous **before update** on tenant_workspace`.
  There is no `before delete` trigger, and `caredesk_app` retains
  `select, insert, update, **delete**` on `tenant_workspace`. The archive therefore holds
  versions 1..N-1; version N — the live one — exists only in `tenant_workspace`.
- **Why it matters:** `delete from tenant_workspace where tenant_id = …` destroys the
  customer's current workspace with no archive row and no PITR to fall back on. That is
  precisely the unrecoverable-loss scenario 0035 was written to close, left open through the
  one verb the trigger does not cover. No repository method in `packages/db` issues that
  DELETE today, but the grant is live, so any future code path, a hand-run operator query
  through the app role, or an ORM-style "replace the row" implementation reaches it.
  `tenant_workspace_history` also has no FK to `tenant_workspace`, so nothing at the schema
  level blocks the delete either.
- **Fix:** `revoke delete on tenant_workspace from caredesk_app;` in a new migration — no
  code needs it. Belt and braces: add a `before delete` trigger reusing
  `archive_tenant_workspace_version()` (change `return new` to `return old` for the delete
  path) so an operator-level delete still leaves the last version recoverable.
- **Confidence:** CONFIRMED.

### [HIGH] Migration 0035 permanently archived unencrypted workspace payloads into a table the app can never rewrite

- **ID:** DB-05
- **File:** `database/migrations/0035_workspace_version_history.sql:14-16,44,74-78`;
  `packages/db/src/workspace-repository.ts:110-119`
- **What:** 0035's header asserts "The payload is archived exactly as stored, which means it
  stays encrypted under WORKSPACE_ENCRYPTION_KEY with the tenant id as AAD. Archiving does
  not widen the blast radius of a database read." That is only true if the payload was
  already encrypted. `PgWorkspaceRepository.find` proves it is not always:
  ```ts
  if (row && this.encryptionKey && !isEncryptedEnvelope(row.payload)) {
    const encrypted = encryptPayload(row.payload, row.tenant_id, this.encryptionKey);
    await client.query(`update tenant_workspace set payload = $2::jsonb where …`, …);
  }
  ```
  This lazy re-encryption pass exists because plaintext workspace rows exist in the wild
  (encryption was added after the table). Migration 0035 lines 74-78 then bulk-copied
  `select … payload … from tenant_workspace` into the history table — capturing whatever was
  stored at that moment, plaintext included. The history table is granted
  `select, insert` only (line 44: "Deliberately no update and no delete"), so the lazy
  re-encryption pass can never reach it, and the `on conflict (tenant_id, version) do nothing`
  in the trigger means a later re-encryption UPDATE of the same version is a no-op against
  the archive.
- **Why it matters:** `tenant_workspace.payload` is the complete MVP state for a household:
  caregiver details, payroll figures, document metadata. For every tenant whose row was still
  plaintext when 0035 ran, a plaintext copy is now permanently at rest in
  `tenant_workspace_history`, and the application has no mechanism to remove or re-encrypt
  it. A database dump or a read by anyone with owner credentials sees cleartext for those
  tenants; the encryption-at-rest control the workspace design depends on does not cover them.
- **Fix:** Run an operator-role (owner) migration that re-encrypts any
  `tenant_workspace_history` row where `payload ->> '__caredesk_encrypted_workspace_v1'` is
  null, using the same AAD (`tenant_id`) as `workspace-repository.ts:44`. Add an assertion
  (or a CHECK) that every history payload carries the envelope marker. Correct 0035's header
  comment, which currently overstates the guarantee.
- **Confidence:** LIKELY — the code path proving plaintext rows exist is confirmed; whether
  any specific tenant was plaintext at the moment 0035 ran needs a query against the live
  database: `select count(*) from tenant_workspace_history where payload ->>
  '__caredesk_encrypted_workspace_v1' is null;`

### [HIGH] `payroll_entry.total` is client-supplied with no reconciliation constraint

- **ID:** DB-06
- **File:** `database/migrations/0028_canonical_payroll_entry.sql:25`;
  written from `apps/api/src/payroll-entry-service.ts:143,147`
- **What:** `total numeric(12,2) not null check (total between -10000000 and 10000000)` is
  the only constraint. The value comes straight from the request body
  (`PayrollEntryInput.total`, `payroll-entry-service.ts:22`) and is inserted verbatim at
  parameter `$22`. Compare `payroll_month_close`, where migration 0026 added
  `payroll_month_close_amount_reconciles check (total_amount = base_salary_amount +
  additions_amount - deductions_amount)` — the same team applied exactly this protection to
  the close receipt and not to the entry it derives from.
- **Why it matters:** `payroll_entry` is the canonical record of what a family paid a
  caregiver in a given month, and it is what `packages/application/src/product-intelligence.ts`
  reads to build financial projections. A UI rounding bug, a stale client, or a crafted
  request stores a total that does not equal its own components, and nothing in the database
  or the read path detects the discrepancy. Because
  `payroll_entry_case_month_unique (tenant_id, employment_case_id, payroll_month)` drives an
  `on conflict … do update`, a bad total silently overwrites a good one. In an Israeli
  caregiver-employment product this row is the evidence a family would show a labour
  inspector.
- **Fix:** Add a CHECK mirroring 0026, accounting for the `additional_payments` jsonb array:
  compute the expected total server-side in `payroll-entry-service.ts` and stop accepting
  `total` from the client at all; keep the CHECK as the backstop. Note `additional_payments`
  is `jsonb … check (jsonb_typeof(...) = 'array')` with no constraint on element shape or
  amount, so any reconciliation CHECK must either sum it in SQL or the column must be
  normalised into rows.
- **Confidence:** CONFIRMED.

### [MEDIUM] Migration 0030 adds a validated CHECK with no `NOT VALID`, so it fails on any database with an existing resolved review

- **ID:** DB-07
- **File:** `database/migrations/0030_human_escalation_lifecycle.sql:36-38`
- **What:**
  ```sql
  alter table professional_review_request
    add constraint review_resolution_note_consistent
    check (status <> 'resolved' or resolution_note is not null);
  ```
  `resolution_note` is added two statements earlier (line 32) as a nullable column with no
  backfill. A constraint added without `NOT VALID` is validated immediately against all
  existing rows. Migration 0020 demonstrates the team knows the `NOT VALID` + explicit
  `VALIDATE` pattern (lines 35-55) and uses it correctly there.
- **Why it matters:** `professional_review_request` was created in 0027 with
  `status … default 'open'` and a `'resolved'` value in its vocabulary. Any tenant that
  resolved a review between 0027 and 0030 has a row with `status = 'resolved'` and
  `resolution_note is null`, which makes migration 0030 abort. Combined with DB-02 (0030 also
  never records itself), a deployment hitting this fails, rolls back, and every later
  migration is blocked. It also takes an ACCESS EXCLUSIVE lock for the full validation scan.
- **Fix:** Add with `NOT VALID`, backfill `resolution_note` for existing resolved rows (e.g.
  a `'migrated'` sentinel meeting the 3-2000 char length constraint), then
  `alter table … validate constraint …` as a separate statement, exactly as 0020 does.
- **Confidence:** LIKELY — confirmed as a code fact; whether any resolved row exists is
  environment-dependent (`select count(*) from professional_review_request where status =
  'resolved' and resolution_note is null;`).

### [MEDIUM] `idempotency_record` stores full API response bodies forever with no expiry and no purge path

- **ID:** DB-08
- **File:** `database/migrations/0021_visa_renewal_persistence.sql:199-208,220-221,275`;
  `packages/db/src/visa-renewal-repository.ts:267-282`
- **What:** The table is
  ```sql
  create table idempotency_record (
    tenant_id …, operation text, idempotency_key text, request_hash text,
    response jsonb not null, created_at …, expires_at timestamptz,
    primary key (tenant_id, operation, idempotency_key)
  );
  ```
  `expires_at` is nullable with **no default**. `PgIdempotencyRepository.saveIdempotency`
  (and every other writer — `wave5-service.ts:79-83`, `binder-export-service.ts:271-273`,
  `payroll-entry-service.ts:166-168`, `regulation-rule-service.ts:407-409`) inserts without
  it, so it is always NULL. The partial index
  `idempotency_record_expiry on idempotency_record (expires_at) where expires_at is not null`
  (line 220) therefore indexes zero rows. And the grant is `select, insert` only (line 275) —
  the application has no DELETE.
- **Why it matters:** `response` is the complete serialized API response for the operation:
  a payroll entry (salary figures), a binder export receipt (document ids and manifest), a
  regulation rule, a worker request. That is customer financial and identity-adjacent data,
  duplicated indefinitely in a second table, growing monotonically with every mutating request,
  with no retention policy, no expiry, and no way for the application or a data-erasure
  workflow to remove it. `database/migrations/sensitive-record-migration-requirements.md:30-32`
  requires documented "retention, erasure, legal-hold" rules per record type; this table has
  none. It also silently enlarges the blast radius of any database read beyond the canonical
  tables that were carefully designed to minimise it.
- **Fix:** Set `expires_at timestamptz not null default (now() + interval '30 days')` for new
  rows, backfill existing rows from `created_at`, and add an operator-run (owner-role) purge
  job for expired rows — the existing partial index is already the right shape for it. Do not
  grant DELETE to `caredesk_app`. Consider storing a response *hash* plus a minimal
  reconstructable envelope rather than the whole body.
- **Confidence:** CONFIRMED.

### [MEDIUM] The live RLS guard does not cover five of the tables it is supposed to protect

- **ID:** DB-09
- **File:** `packages/db/src/rls-check.ts:29-80` (`ALL_TENANT_TABLES`)
- **What:** `ALL_TENANT_TABLES` is the list the "all tenant-owned and control tables retain
  enabled, forced RLS" assertion iterates (lines 498-512). Comparing it against the 55
  tenant-owned tables in the schema, five are missing:
  `professional_review_request` (0027), `ai_action_confirmation` (0027), `leave_entry` (0033),
  `scenario_expense` (0034), `tenant_workspace_history` (0035). Note
  `professional_review_transition` *is* listed while its parent
  `professional_review_request` is not, which reads like a copy/paste slip.
- **Why it matters:** The schema is correct today, so this is not itself a leak. But
  `database/README.md:113-125` and `rls-test-harness-design.md:34-37` both present
  `pnpm db:rls-test` as the coverage gate that catches exactly the class of defect migrations
  0004 and 0005 were written to fix. A future migration that forgets `FORCE` or `WITH CHECK`
  on `leave_entry` or `tenant_workspace_history` passes CI. `tenant_workspace_history` is the
  highest-value omission: it holds every historical version of every tenant's complete
  workspace.
- **Fix:** Derive `ALL_TENANT_TABLES` from the database instead of a hand-maintained literal —
  query `pg_class` for every table in `public` that has a `tenant_id` column and assert
  `relrowsecurity and relforcerowsecurity` plus a policy with both `polqual` and
  `polwithcheck`. That makes the gate self-maintaining, which is what
  `rls-test-harness-design.md:34-37` actually specifies ("generate the list … and fail the
  test suite if any table lacks a corresponding RLS test").
- **Confidence:** CONFIRMED.

### [MEDIUM] Actor columns (`created_by`, `updated_by`, `closed_by`, `linked_by`, `recorded_by`, `confirmed_by`, `changed_by`) carry no foreign key anywhere in the schema

- **ID:** DB-10
- **File:** `database/migrations/0003_care_employment_core.sql:15,17` (pattern origin);
  `0023_monthly_payroll_close.sql:14`, `0028_canonical_payroll_entry.sql:28-29`,
  `0031_binder_export_receipt.sql:26`, `0030_human_escalation_lifecycle.sql:51`,
  `0033_governed_leave_ledger.sql:20-21`, `0034_scenario_expense.sql:15-16`, and ~20 more
- **What:** These are all `uuid` (frequently `not null`) with no `references app_user (id)`
  and no composite `(tenant_id, …) references tenant_membership (tenant_id, id)`. Contrast
  `tenant_workspace.updated_by uuid not null references app_user (id)` (0011:10) and
  `workspace_file.updated_by` (0012:12), which *do* have the FK — so the omission is
  inconsistent rather than a uniform policy. `worker_portal_access.user_id` also has a real FK
  (0025:48).
- **Why it matters:** Evidence rows — a payroll close receipt, a binder export receipt, a
  review transition — assert "user X did this". With no FK, `created_by` can hold a UUID that
  matches no `app_user`, or (worse for isolation reasoning) a user id belonging to a different
  tenant, and nothing at the database layer notices. For `binder_export_receipt` and
  `payroll_month_close`, both explicitly framed as immutable evidence, an unresolvable actor
  id makes the evidence unable to answer the question it exists to answer.
- **Fix:** For actor columns that are semantically "a member of this tenant", use the composite
  FK to `tenant_membership (tenant_id, id)` — the candidate key already exists from
  `tenant_membership_tenant_unique` (0020:32-33). For genuinely global identities, use
  `references app_user (id)` as 0011/0012 already do. Add with `NOT VALID` + `VALIDATE` per
  0020's pattern so existing data surfaces rather than blocking the deploy.
- **Confidence:** CONFIRMED.

### [MEDIUM] `document.owner_id` is a polymorphic reference with no foreign key and no constraint tying it to `owner_type`

- **ID:** DB-11
- **File:** `database/migrations/0008_documents.sql:27-34`
- **What:** `owner_type text not null check (owner_type in ('employment_case',
  'care_recipient', 'employer', 'caregiver', 'organization', 'contact'))` paired with a bare
  `owner_id uuid` (nullable, no FK). Every *other* reference in this schema uses a composite
  same-tenant FK; this is the one polymorphic escape hatch.
- **Why it matters:** A passport document can be recorded as `owner_type = 'caregiver'` with
  an `owner_id` that is a `contact` id, a deleted caregiver's id, or a UUID from another
  tenant, and the database accepts it. `document.sensitivity` and downstream masking decisions
  are made per-document, but "which person is this passport about" is unverifiable. Because
  `document` also carries a DELETE grant while `document_version` does not, orphaning is
  one-directional but the dangling `owner_id` persists in the evidence trail.
- **Fix:** Either normalise into per-owner-type nullable FK columns with a CHECK that exactly
  one is set (the pattern `workflow_assignment` already uses at 0021:171-180 for
  `assignee_membership_id` / `assignee_contact_id`), or add a trigger-based same-tenant
  existence check. The `workflow_assignment` precedent means the house style already has an
  answer for this.
- **Confidence:** CONFIRMED.

### [MEDIUM] No index on `worker_portal_access.user_id`, which is the worker-portal authentication hot path

- **ID:** DB-12
- **File:** `database/migrations/0025_wave5_collaboration_engagement.sql:33-56`;
  consumed by `database/migrations/0026_wave5_worker_authorization.sql:12-14` and
  `apps/api/src/collaboration/wave5-service.ts:110-113`
- **What:** `worker_portal_access` has `unique (tenant_id, id)`,
  `unique index worker_access_active_case on (tenant_id, employment_case_id, caregiver_id)
  where status in ('invited','active')`, and the primary key on `id`. The
  `SECURITY DEFINER` resolver runs
  `select distinct access.tenant_id from worker_portal_access access
   where access.user_id = p_user_id and access.status = 'active'` — leading on `user_id`,
  for which no index exists. Because the function is `SECURITY DEFINER` it runs with
  BYPASSRLS, so there is no tenant predicate to narrow the scan either: it is a full
  sequential scan of every tenant's rows on **every authenticated worker request**.
- **Why it matters:** This is the first query of the worker portal request lifecycle. It grows
  linearly with total platform worker accounts across all tenants, not per-tenant, so it
  degrades in exactly the dimension that scaling makes worse.
- **Fix:** `create index worker_portal_access_by_user on worker_portal_access (user_id)
  where status = 'active';` Also consider `notification_intent`/`document_intake_review`
  secondary access paths (`document_intake_review` has only its `(tenant_id, id)` primary key,
  so a lookup by `document_version_id` scans the tenant's rows).
- **Confidence:** CONFIRMED.

### [MEDIUM] Six reference tables were created after 0015's lockdown; the `anon`/`authenticated` revoke may not have applied to them

- **ID:** DB-13
- **File:** `database/migrations/0015_lock_down_supabase_public_schema.sql:7-17` vs
  `database/migrations/0021_visa_renewal_persistence.sql:5-69`
- **What:** 0015 revokes existing grants (`revoke all privileges on all tables in schema
  public from anon, authenticated`) and then sets
  `alter default privileges **for role postgres** in schema public revoke all privileges on
  tables from anon, authenticated`. The default-privileges clause only affects objects created
  by role `postgres`. Migrations run as `DATABASE_ADMIN_URL`, which through Supavisor is
  `postgres.<project-ref>` — this authenticates *as* `postgres`, so the clause should hold —
  but on the CI path (`rls-check-ci.ts:24-40`) the connecting role is `caredesk` and
  `postgres` is created as a bare NOLOGIN placeholder, so tables created there fall outside
  the default-privileges rule entirely. The six tables from 0021
  (`workflow_template`, `workflow_template_version`, `workflow_template_step`,
  `visa_rule_definition`, `visa_rule_version`, `visa_rule_source`) plus every table from
  0022-0035 were created after 0015 and have no RLS to fall back on.
- **Why it matters:** If the default-privileges revoke did not apply, Supabase's own
  `alter default privileges … grant all on tables to anon, authenticated` gives the browser
  PostgREST role direct read access to those tables. For the six reference tables that is
  low-value (approved rule text), but the same reasoning covers the *tenant-owned* tables
  created after 0015 — those are saved only by their forced RLS policies, not by grant
  hygiene. `rls-check.ts:514-528` does assert zero `anon`/`authenticated` grants exist, which
  is the right check; it just is not run on every deploy.
- **Fix:** Add an explicit `revoke all privileges on all tables in schema public from anon,
  authenticated;` as the last statement of every migration that creates a table (0017:28,54
  already does this for two tables), or make the assertion in `rls-check.ts:514-528` part of
  the required deploy gate rather than an optional local command.
- **Confidence:** NEEDS-VERIFICATION — run
  `select table_name, grantee from information_schema.role_table_grants where table_schema =
  'public' and grantee in ('anon','authenticated');` against the live database.

### [MEDIUM] Migration 0032 satisfies its own "review evidence" constraint with a placeholder

- **ID:** DB-14
- **File:** `database/migrations/0032_regulation_rule_lifecycle.sql:50-51,109-151`
- **What:** The table defines
  `regulation_rule_review_consistent check ((status in ('approved','active','retired')) =
  (reviewed_by is not null and reviewed_at is not null))` — "Reviewed states must carry their
  review evidence (fail closed)". The seed then inserts four rules with `status = 'approved'`
  where `reviewed_by` is set to the literal string
  `'תוכן ייחוס ראשוני של CareDesk — טעון אימות על ידי גורם מקצועי'`
  ("CareDesk preliminary reference content — requires professional verification"), i.e. a
  disclaimer occupying the reviewer-name field, and `reviewed_at = now()`.
- **Why it matters:** The constraint is intended to guarantee that any approved rule names a
  human reviewer. Seeding it with a disclaimer string makes the constraint pass while the
  invariant it encodes is false, and the resulting rows are `status = 'approved'` in every
  existing tenant — one manager click away from `active`, at which point
  `apps/api/src/regulation-rule-service.ts` feeds them to assistant/wizard context as
  reviewed content. For Israeli labour-law statements presented to families, "who reviewed
  this" is the audit question that matters most.
- **Fix:** Seed at `status = 'draft'` (which the constraint permits with NULL reviewer) and
  require a real reviewer name on the transition to `approved`. Alternatively add a CHECK
  that `reviewed_by` does not match the disclaimer sentinel. Separately: the seed uses
  `cross join tenant`, so tenants created after 0032 receive no rules at all — there is no
  trigger or bootstrap path — which is an inconsistency worth resolving in the same change.
- **Confidence:** CONFIRMED.

### [MEDIUM] The in-memory fallback enforces none of the database's protective constraints, so tests cannot catch violations of them

- **ID:** DB-15
- **File:** `packages/infrastructure/src/mocks/in-memory-audit-service.ts:3-9`,
  `in-memory-task-repository.ts:6-27`, `in-memory-workspace-file-repository.ts:6-25`
- **What:** `InMemoryAuditService.record` is `this.events.push(event)` — no length caps, no
  denial-requires-reason rule. Postgres enforces
  `audit_event_change_summary_is_a_summary check (length(change_summary) <= 500)`,
  `audit_event_reason_is_short`, `audit_event_purpose_is_a_code` and
  `audit_event_denial_has_reason check (permission_decision <> 'denied' or reason is not
  null)` (0009:95-103). `InMemoryTaskRepository.createTask` accepts any
  `employmentCaseId` without checking it exists — Postgres has
  `task_case_same_tenant foreign key (tenant_id, employment_case_id)` (0007:67-69). None of
  the mocks implement CHECK vocabularies, uniqueness, or same-tenant composite FKs.
- **Why it matters:** A route that builds a `changeSummary` longer than 500 characters, or
  records a denial without a reason, passes every API test and then throws
  `violates check constraint` in production — aborting the *entire* transaction, so the
  business write it accompanied is rolled back too. Because audit writes are deliberately
  bundled into the same transaction as the change they describe
  (`visa-renewal-repository.ts:299-329`, `binder-export-service.ts:254-270`), an over-long
  summary does not just lose the audit row, it loses the customer's action. The mock is
  otherwise conscientious — `InMemoryWorkspaceRepository` explicitly mirrors the destructive-
  shrink guard with a comment saying why (`in-memory-workspace-repository.ts:22-24`) — which
  shows the team already accepts this principle; it just has not been applied to the
  constraint surface.
- **Fix:** Port the audit length caps and the denial-requires-reason rule into
  `InMemoryAuditService.record` (throw, don't truncate), and have `InMemoryTaskRepository` /
  `InMemoryDocumentRepository` reject a case id they have not seen. These are a handful of
  lines each and they convert a class of production-only failure into a test failure.
- **Confidence:** CONFIRMED.

### [MEDIUM] There is no implemented erasure or anonymisation path for a tenant

- **ID:** DB-16
- **File:** schema-wide — no `ON DELETE` clause exists in any of the 36 migrations
  (verified by grep); `database/migrations/0009_audit_event.sql:27-39` documents the intent
- **What:** Every FK is `NO ACTION`, and `caredesk_app` holds `DELETE` on only 22 of 55
  tenant-owned tables — never on `timeline_event`, `document_version`, `audit_event`,
  `payroll_month_close`, `payroll_entry`, `leave_entry`, `binder_export_receipt`,
  `idempotency_record` or any of the receipt/transition tables. 0009's header states that
  `audit_event` deliberately omits its tenant FK so that "erasing or anonymising a tenant"
  remains possible while "preserving minimal audit evidence" — but no such workflow exists
  anywhere in `packages/db` or the migrations.
- **Why it matters:** The absence of cascades is the right default and is why nothing can
  silently wipe customer history (a genuine strength — see "What is done well"). The flip
  side is that the product currently *cannot* honour a deletion request: an owner connection
  attempting `delete from tenant` is blocked by ~40 FK chains, and the correct ordering has
  never been written down or tested. Under Israeli Privacy Protection Law and for any EU
  data subject in `data_region = 'eu-central'`, that is a compliance gap, and the schema
  comments show it was anticipated but not built.
- **Fix:** Write the erasure procedure as an owner-role, tested, ordered script (or a
  `SECURITY DEFINER` function callable only by an operator role) that anonymises rather than
  deletes where evidence must survive, and add it to
  `database/migrations/sensitive-record-migration-requirements.md`'s gate list. The
  `rls-check.ts` cleanup block (lines 557-579) is already a hand-derived, correct deletion
  ordering for the core tables and is a good starting point — but it covers 15 tables, not 55.
- **Confidence:** CONFIRMED.

### [LOW] Two migrations share the `0026` prefix

- **ID:** DB-17
- **File:** `database/migrations/0026_canonical_product_intelligence.sql`,
  `database/migrations/0026_wave5_worker_authorization.sql`
- **What:** `runMigrations` sorts filenames lexicographically (`migrate.ts:22-24`) and keys
  `schema_migrations` on the full filename, so both apply and both record distinct versions —
  there is no functional collision today. The ordering between them is decided by the suffix
  (`canonical…` before `wave5…`), which is accidental rather than intended.
- **Why it matters:** It defeats the "NNNN is the total order" invariant that the migration
  numbering and `migration-safety.ts`'s `MIGRATION_PATH` regex assume, and makes a future
  ordering-dependent pair between them silently wrong.
- **Fix:** Leave the applied files alone (`migration-safety.ts:97-103` correctly makes applied
  migrations immutable). Add a `migration-safety` rule rejecting a new file whose 4-digit
  prefix already exists.
- **Confidence:** CONFIRMED.

### [LOW] Inconsistent handling of an empty `app.tenant_id`: `::uuid` vs `nullif(…, '')::uuid`

- **ID:** DB-18
- **File:** `database/migrations/0004_force_rls_and_with_check.sql:35-36` (and 50 further
  policies) vs `database/migrations/0015_lock_down_supabase_public_schema.sql:36` and
  `database/migrations/0017_restore_missing_pilot_workspace.sql:24-25,50-51`
- **What:** Almost every policy uses `current_setting('app.tenant_id', true)::uuid`. Three
  use `nullif(current_setting('app.tenant_id', true), '')::uuid`. `rls-check.ts:411-416`
  documents that the empty-string case is real: "PostgreSQL can expose an unset
  transaction-local custom setting as an empty string after a pooled connection is reused."
- **Why it matters:** With the bare cast, `''::uuid` raises `invalid input syntax for type
  uuid` mid-statement rather than evaluating to false. That is still fail-closed (no data
  leaks), but it aborts the transaction and surfaces as a 500 rather than an empty result —
  and inside a multi-statement transaction it discards work already done in that transaction.
  The three `nullif` variants degrade cleanly to "no rows"; the other 50 do not.
- **Fix:** Standardise on `nullif(current_setting('app.tenant_id', true), '')::uuid` across
  all policies in one new migration. Behaviour is identical when the GUC is a valid UUID.
- **Confidence:** CONFIRMED.

### [LOW] `document_intake_review.confirmed_fields`, `event_action_plan.answers` and `automation_execution_receipt.response` are unconstrained jsonb with a comment-only privacy contract

- **ID:** DB-19
- **File:** `database/migrations/0024_wave4_automation.sql:1-2,13,31`,
  `database/migrations/0029_automation_execution_receipt.sql:23`
- **What:** 0024 opens with "Durable review/confirmation evidence only. Raw OCR, prompts,
  document content, and provider responses are deliberately excluded." That rule is enforced
  nowhere in the schema: `confirmed_fields jsonb not null default '{}'`, `answers jsonb not
  null`, `response jsonb` have no shape constraint, no key allowlist and no size cap. Compare
  `audit_event`, where the same privacy contract is made mechanical with three explicit
  length CHECKs (0009:93-100) and the header says exactly that: "Length caps are the privacy
  contract made mechanical".
- **Why it matters:** The single line of defence today is one Zod schema —
  `intakeReviewBodySchema` at `apps/api/src/routes/case-documents.ts:36-60`, which currently
  admits only field *keys* (`'holder_name' | 'issue_date' | 'expiry_date'`) and validation
  metadata, no values. So there is no PII in these columns right now. But the intake flow
  exists to process passports and visas: the moment someone widens that Zod schema to carry an
  extracted value, passport and permit numbers land in a plaintext, uncapped jsonb column, in
  direct contradiction of
  `database/migrations/sensitive-record-migration-requirements.md:10-12` ("Store sensitive
  values as application-encrypted ciphertext … PostgreSQL, backups, replicas, logs, audit
  rows, and analytics exports must never receive plaintext").
- **Fix:** Give these columns the same mechanical treatment `audit_event` got: a size cap
  (`check (pg_column_size(confirmed_fields) <= 4096)`) and, for `confirmed_fields`, a CHECK
  that the object contains only the known metadata keys. That way the privacy contract fails
  the write rather than relying on a route schema staying narrow forever.
- **Confidence:** CONFIRMED.

### [LOW] `PgWorkspaceFileRepository.delete` drops the only record of a private storage key

- **ID:** DB-20
- **File:** `packages/db/src/workspace-file-repository.ts:80-90`;
  `database/migrations/0012_workspace_files.sql:4-17`
- **What:** `workspace_file` is described as holding "the opaque key" for bytes that "live
  only in a private storage bucket". The repository's `delete` issues a hard
  `delete from workspace_file … returning …` — there is no soft-delete status column and no
  tombstone, unlike `scenario_expense` (0034:13, "No delete grant: removal is a soft status
  change") and `leave_entry` (0033:15-17, "Ledger rows are never hard-deleted").
- **Why it matters:** If the row is deleted and the subsequent object-storage delete fails
  (network error, permissions, a crash between the two), the blob remains in the bucket with
  no record anywhere of which tenant it belongs to or that it exists. It cannot be found, cannot
  be included in an erasure request, and cannot be reconciled — a permanent orphaned copy of
  customer document data outside the schema's reach.
- **Fix:** Follow the house convention: add a `status text not null default 'active' check
  (status in ('active','deleted'))` column, soft-delete, and drive object-storage cleanup from
  a reconciliation sweep over `status = 'deleted'` rows that only removes the row once the
  object is confirmed gone.
- **Confidence:** CONFIRMED.

## What is done well

- **RLS is complete and correct.** All 55 tenant-owned tables have `ENABLE` + `FORCE` and a
  `FOR ALL` policy with both `USING` and `WITH CHECK`. Not one has a SELECT policy without a
  write check. Migration 0004's header is an unusually honest post-mortem of the two real
  defects (`ENABLE` not applying to the owner; `USING` without `WITH CHECK`), and 0005 goes
  further by identifying that even `FORCE` is defeated by `BYPASSRLS` and creating a
  `NOBYPASSRLS` application role. That is the correct three-layer analysis and it is rare to
  see it worked all the way through.
- **Composite same-tenant foreign keys throughout.** Rather than `references employment_case
  (id)`, essentially every reference is `foreign key (tenant_id, x_id) references t
  (tenant_id, id)`, backed by explicit `unique (tenant_id, id)` candidate keys. This makes a
  cross-tenant reference structurally impossible even if RLS were bypassed entirely — real
  defence in depth, not a slogan. 0006:8-12 and 0020:31-33 show the pattern being extended
  deliberately as new referencing tables arrive.
- **No `ON DELETE CASCADE` anywhere.** Zero occurrences of `ON DELETE` in 3,220 lines of DDL.
  Nothing in this schema can silently wipe audit events, documents, timeline entries or
  payroll history when a parent row goes away.
- **Money is modelled correctly.** `numeric(12,2)` for payroll and expenses, integer agorot
  for product billing (`price_agorot`, `amount_agorot`), with range CHECKs on every one. No
  float, `real`, `double precision` or `money` column exists. `payroll_month_close` even has a
  reconciliation CHECK (0026:8-11).
- **Append-only is enforced by grant, not by convention.** `audit_event`, `timeline_event`,
  `document_version`, `payroll_month_close`, `binder_export_receipt`,
  `worker_payment_acknowledgement`, `workflow_completion`, both transition tables and
  `tenant_workspace_history` all hold `select, insert` only. A tenant cannot delete its own
  audit rows: there is no DELETE grant and no `SECURITY DEFINER` function that deletes.
- **The `audit_event` privacy contract is mechanical, not aspirational.** Deliberately no
  jsonb payload column, plus three length CHECKs and a denial-requires-reason CHECK, with a
  header explaining that the caps exist so "a short summary cannot hold a document, a bank
  statement or a model prompt". The reasoning for omitting the tenant FK (0009:27-39) is one
  of the best-argued schema comments I have read.
- **Sensitive fields are deferred rather than fudged.** 0003's header explicitly refuses to
  add passport-number and bank-detail columns until the encrypted-field design lands, and
  `sensitive-record-migration-requirements.md` writes down the eight gates such a design must
  clear. `worker_portal_invitation` stores `token_hash` with a 32-char minimum, never a token.
  `product_subscription` stores an app-encrypted `sealed_payment_token` with a CHECK that the
  token, provider id and last4 are all present or all absent.
- **Constraint craftsmanship.** `task_has_exactly_one_title check ((title is null) <> (title_key
  is null))`, `task_completed_at_matches_status check ((status = 'completed') = (completed_at
  is not null))`, `document_version_verification_evidence`, `worker_access_state`,
  `regulation_rule_review_consistent`, partial unique indexes for "at most one active X"
  (`tenant_membership_active_unique`, `case_contact_role_single_primary`,
  `case_responsibility_current`, `worker_access_active_case`). These are the constraints that
  prevent nonsense states, and they are everywhere.
- **`withTenant()` is the right abstraction** — transaction-local role and tenant, both
  unable to leak to the next borrower of a pooled connection, with a comment
  (`pool.ts:28-53`) that explains why the apparently redundant `SET LOCAL ROLE` is kept.
- **`pool.ts:12-13` disables node-postgres's `date` parser** so a visa expiring 2026-09-01
  cannot come back as 2026-08-31T21:00:00Z. That is a real compliance bug caught and fixed at
  the type-parser level.
- **`rls-check.ts` is a genuine live isolation test**, not a unit test: two synthetic tenants,
  assertions for read/update/delete/insert-with-foreign-tenant-id, a missing-tenant-context
  check, a "can the app role reshape the schema" check, and a `pg_policy` introspection check
  that both `polqual` and `polwithcheck` are non-null. It cleans up after itself and uses
  `example.invalid` addresses.
- **`migration-safety.ts` strips comments and string literals before pattern matching**
  (lines 64-69), so a migration that *explains* a `DROP TABLE` in prose is not flagged. That
  is the difference between a lint rule people keep and one they disable.
- **`PgWorkspaceRepository.save` gets optimistic concurrency right**: the shrink guard reads
  with `FOR UPDATE` inside the same transaction as the write, and the create path uses
  `on conflict (tenant_id) do nothing` so it cannot overwrite. The re-encryption pass in
  `find` uses a compare-and-set (`where payload = $3::jsonb`) so two concurrent readers cannot
  race. `PgTaskRepository.completeTask` uses `where status <> 'completed'` for idempotency
  rather than rewriting the original completion time.
- **`sql-literal.ts`** correctly identifies `ALTER ROLE … PASSWORD` as the one place a bind
  parameter is impossible, delegates escaping to `pg.escapeLiteral`, rejects NUL and control
  characters instead of silently truncating, and keeps the helpers pure so they are unit-testable.

## Coverage note

**Read in full:** all 36 files in `database/migrations/` (0001-0035, including both `0026_*`
files), `database/migrations/README.md` (via `database/README.md`),
`database/migrations/sensitive-record-migration-requirements.md`, `database/README.md`,
`database/rls-test-harness-design.md`, `database/seed/README.md`,
`database/docker-compose.yml`, and all 34 `.ts` files under `packages/db/src`
(implementation files read line by line; the 11 `*.test.ts` files were skimmed for behavioural
assertions only).

**Read partially, for cross-checking only** (owned by other reviewers — findings referencing
them are flagged as such): `apps/api/src/container.ts`, `apps/api/src/env.ts`,
`apps/api/src/index.ts`, `apps/api/src/routes/case-documents.ts`,
`apps/api/src/payroll-entry-service.ts`, `apps/api/src/regulation-rule-service.ts`,
`apps/api/src/collaboration/wave5-service.ts`, `apps/api/src/binder-export-service.ts`,
`apps/api/src/evidence-export-service.ts`, `apps/api/src/leave-entry-service.ts`,
`apps/api/src/scenario-expense-service.ts`, and five files under
`packages/infrastructure/src/mocks/`. DB-01, DB-03 and DB-15 straddle the boundary: the
defect is in API/infrastructure code, but the property at risk — tenant isolation and
constraint enforcement at rest — is this review's subject, so they are reported here.

**Not verified against a live database.** Every claim above is derived from static reading of
the migrations and code. Three findings need a query against the running Supabase instance to
close out, and each names the exact query: DB-05 (`tenant_workspace_history` plaintext count),
DB-07 (resolved reviews without a note), DB-13 (`anon`/`authenticated` grants). I did not run
`pnpm db:migrate`, `pnpm db:rls-test`, or `pnpm db:migration-safety` — no database was
available and the task was read-only.

**Explicitly checked and found clean** (negative results, recorded so they are not re-checked):
no `ON DELETE CASCADE` or any `ON DELETE` clause anywhere; no `float`/`real`/`double
precision`/`money` column; no policy after 0004 missing `WITH CHECK`; no `DELETE` grant on any
append-only evidence table; no `SECURITY DEFINER` function that deletes tenant data; all
`SECURITY DEFINER` functions pin `search_path` and are revoked from `PUBLIC` before being
granted to `caredesk_app` only; `0026_wave5_worker_authorization.sql` places `pg_temp` last in
its `search_path`, which is the safe ordering.

**Not covered by this review** (other reviewers' scope): API route authorization, frontend,
backup/DR procedures, the release and migration-safety CI pipeline, and the domain layer.
