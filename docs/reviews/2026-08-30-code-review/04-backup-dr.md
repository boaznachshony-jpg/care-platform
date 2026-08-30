# Backup / Restore / Disaster Recovery Audit

Scope: operational data-safety of the CareDesk platform at `/home/user/care-platform`.
Read-only audit. No source file was modified.
Date of audit: 2026-08-30. Repo HEAD: `8531d0f`.

## Summary

CareDesk is unusual among young pilot products in that it has **written down** a
credible backup-and-recovery policy (`docs/operations/production-release-and-recovery.md`),
states explicit RPO/RTO targets, enforces an independent document-bytes mirror in
production code, and has an append-only evidence layer. That is genuinely more than
most pre-revenue products have. The documentation is honest about its own gaps.

The problem is that almost none of it is **executed**. The gap between the written
policy and the operating reality is the entire finding of this audit:

- The restore procedure has **never been rehearsed**. The first time anyone attempted
  a real restore was as an emergency, on 2026-08-29, one day before the only usable
  backup rolled off a 7-day retention window
  (`docs/governance/WORK-PLAN-2026-08-29.md:22-36`).
- This is not hypothetical risk. **A real customer's account was already wiped.** A
  browser-cache decryption failure produced a well-formed save that replaced a
  populated account with blanks, and optimistic locking waved it through
  (`packages/application/src/ports/workspace-shrink-guard.test.ts:4-17`). The loss was
  discovered by a human noticing a named customer's case was missing from the screen —
  not by any monitor.
- **Point-in-time recovery is not enabled**, stated flatly in
  `database/migrations/0035_workspace_version_history.sql:6`.
- **There is no single-tenant restore capability.** The only path is an owner-approved
  full-project restore into a disposable Supabase project followed by manual SQL
  extraction and a hand-merge of individual keys — improvised once, never documented as
  a procedure.
- **Nothing would detect silent data loss.** No monitoring, no alerting, no row-count
  check, no reconciliation job exists anywhere in the repository. `/ready` verifies that
  six schema objects *exist*; it cannot see an emptied table.
- The off-site logical database backup and the off-site Storage copy that the policy
  requires are **manual procedures with no script, no cron, no CI job and no named owner**.

The single strongest artifact in the repo is migration `0035_workspace_version_history.sql`,
which is well-designed and was written specifically because the recovery path did not
exist. But it covers only the legacy MVP workspace blob, **no code reads it**, and as of
the most recent work plan it had not yet been applied to production.

Bottom line: **unrecoverable loss of a single customer's data is possible today**, and
loss that goes unnoticed for more than seven days is permanent. The product must not
onboard real regulated PII until at least the BLOCKER items below are closed.

## Readiness scorecard

| Capability | Status | Evidence | Risk |
|---|---|---|---|
| DB backup | PARTIAL | `docs/operations/production-release-and-recovery.md:9-13` (Supabase Pro, 7 daily physical backups observed 2026-08-04); off-site logical backup required but not automated, `:16-18`, `:26-27` | 7-day rolling window is the entire envelope; loss noticed on day 8 is permanent |
| Storage-bucket backup | PARTIAL | `apps/api/src/storage/mirrored-document-storage.ts:8-31`; production refuses to boot without it, `apps/api/src/env.ts:106-116`; manual copy procedure `docs/operations/production-release-and-recovery.md:53-57` | Live mirror only — no versioning, no backfill of pre-existing objects, no completeness check |
| PITR | ABSENT | `database/migrations/0035_workspace_version_history.sql:6` ("point-in-time recovery is not enabled on this project"); `docs/operations/production-release-and-recovery.md:35-36` defers it to commercial launch | Recovery granularity is one snapshot per day. No sub-day recovery of any kind |
| Written restore runbook | PARTIAL | `docs/operations/production-release-and-recovery.md:115-129` (drill acceptance criteria, 7 checks) | Acceptance criteria exist; the restore *commands* and a single-tenant procedure do not |
| Restore ever rehearsed | ABSENT | Stated as future work, `docs/operations/production-release-and-recovery.md:15-18`; unchecked gate `PILOT_RELEASE.md:13`; first real attempt was an emergency, `docs/governance/WORK-PLAN-2026-08-29.md:22-36`. No drill record anywhere in repo | Every restore assumption is untested, including whether the backup contains the data |
| RTO defined | PRESENT | `docs/operations/production-release-and-recovery.md:34-35` — RTO ≤ 4 hours (provisional) | Never measured; no drill has ever timed it |
| RPO defined | PRESENT | `docs/operations/production-release-and-recovery.md:34-35` — RPO ≤ 24 hours (provisional) | Achievable in principle from daily backups, but only if loss is detected — and detection does not exist |
| Single-tenant restore | ABSENT | No script, no route, no procedure. Only ad-hoc path: `docs/governance/WORK-PLAN-2026-08-29.md:28-33` | The most likely real disaster (one tenant corrupted by user or deploy) has no supported answer |
| Soft delete / undo | PARTIAL | `0035_workspace_version_history.sql` (legacy blob only); append-only `audit_event` `0009:41+`, `timeline_event` `0007:94`, `document_version` `0008`, `binder_export_receipt` `0031:43-45`. **No** `deleted_at`/`is_deleted` column exists in any of the 36 migrations | Hard DELETE granted on `document` `0008:135`, `task` `0007:94`, contacts `0006:153`, `workspace_file` `0012:26`, `tenant_workspace` `0011:23` |
| DB-to-storage reconciliation | ABSENT | not found — no script in `scripts/`, no command in `package.json`, no CI job in `.github/workflows/ci.yml`. Requirement only: `docs/governance/next-delivery-wave-gap-analysis.md:174` | Rows and bytes will silently diverge after any restore, in both directions |
| Corruption detection/alerting | ABSENT | not found — no Sentry/Datadog/alerting anywhere; `/ready` checks object existence only, `apps/api/src/container.ts:631-650`; human daily eyeballing, `PILOT_RELEASE.md:52` | The customer is the monitor. This is empirically confirmed by the incident already suffered |
| Tenant data export | PARTIAL | `0031_binder_export_receipt.sql` is a *receipt*, `:5-8`; the export itself is `window.print()`, `apps/web/src/pages/EmergencyBinderPage.tsx:172`; evidence export is metadata-only, `apps/api/src/evidence-export-service.ts:11-16` | No machine-readable full-tenant export. Privacy notice promises CSV/JSON portability "from settings" — it does not exist |
| Audit-trail preservation | PARTIAL | Append-only by grant, `0009_audit_event.sql:21-25`, `:41+`; deliberately no FK to `tenant` to survive erasure, `:27-39` | Lives in the same database, so it shares the DB's backup fate; a restore to T-24h erases the audit record of the incident being investigated. No retention period defined |

---

## Findings

### [BLOCKER] The restore procedure has never been executed, and the first attempt was an emergency against an expiring backup

- **ID:** DR-01
- **File:** `docs/operations/production-release-and-recovery.md:15-18`, `:31-32`, `:115-129`; `PILOT_RELEASE.md:13`; `docs/governance/WORK-PLAN-2026-08-29.md:22-36`
- **What:** The policy requires "a documented restore drill to a disposable project before
  the first pilot customer and at least quarterly after launch" (`:31-32`) and states in
  present tense that "a restore must be exercised successfully before the first external
  customer" (`:17-18`). `PILOT_RELEASE.md:13` carries the same item as an unchecked gate.
  **No drill record exists anywhere in the repository** — no dated log, no signed record,
  no checksums file, no CI job, no script. The drill acceptance criteria at `:115-129`
  are well written (schema history matches, tenant/employment/payroll/task/document row
  counts match, sign-in isolation, private document downloads, payroll totals reconcile,
  `/health` and `/ready` green) but they have never been run.
  The only evidence of an actual restore is `docs/governance/WORK-PLAN-2026-08-29.md:22-36`,
  which plans a `Restore to new project` from the 2026-08-22 backup as step 1.1 of an
  urgent work plan, notes the window closes "tomorrow" because retention is 7 rolling
  days, and explicitly contemplates that the backup may itself be empty
  (`:36` — "if 1.2 finds 22.8 is also empty, the data was overwritten before that and
  there is nothing to restore").
- **Why it matters:** Concrete scenario: a bad migration or a bad deploy corrupts
  production on a Friday evening. Nobody has ever restored this system. The operator does
  not know whether `caredesk_app` role provisioning survives a restore, whether the
  Supavisor pooler username changes on a new project ref (it does — `database/README.md:48`),
  whether `WORKSPACE_ENCRYPTION_KEY` still decrypts the restored payloads, or how long any
  of it takes. The stated RTO of 4 hours is a guess. In a real incident the team discovers
  all of this under time pressure while customers are locked out — which is exactly the
  situation `WORK-PLAN-2026-08-29.md` documents.
- **Fix:**
  1. Run the drill **now**, against synthetic data, before any real PII exists. Follow the
     acceptance criteria already written at `:115-129`.
  2. Commit the drill record (date, source backup identifier, target project ref, results,
     measured wall-clock RTO, cleanup confirmation) to `docs/operations/`. A drill that is
     not recorded did not happen.
  3. Add the *restore* commands to the runbook. The document currently gives commands for
     the backup direction only (`:47-57`); the restore direction is described in prose.
  4. Make the drill a dated, recurring calendar obligation with a named owner, and make a
     stale drill a hard release gate rather than a checklist line.
- **Confidence:** CONFIRMED

---

### [BLOCKER] There is no way to restore one tenant. The only path is a full-project restore plus a manual hand-merge, gated on one person, inside a 7-day window

- **ID:** DR-02
- **File:** NOT FOUND IN REPO as a capability. Ad-hoc path documented once at
  `docs/governance/WORK-PLAN-2026-08-29.md:28-33`
- **What:** Nothing in the codebase can restore a single tenant. There is no admin route
  (`apps/api/src/routes/` contains no restore/recovery/admin route), no CLI command
  (`package.json` scripts are migrate, provision-app-role, provision-pilot-account,
  activate-subscription, rls-test, migration-safety — nothing restorative), and no
  documented procedure in `docs/operations/`.
  The improvised path actually used is:
  1. `Restore to new project` from a daily backup — "the action requires owner approval"
     (`WORK-PLAN-2026-08-29.md:28`), i.e. one human being with Supabase owner rights;
  2. query the disposable project's `tenant_workspace` to see whether it holds real data (`:29`);
  3. extract and decrypt the payload and diff it against production (`:30`) — which
     requires possession of `WORKSPACE_ENCRYPTION_KEY`;
  4. "surgical restoration — only the missing keys, without touching the rest"
     (`:31`), by hand, after per-key approval;
  5. delete the temporary project (`:32`).
  The one genuinely good property here: because it goes via a *separate* project, it does
  **not** clobber other tenants. Single-tenant restore is therefore *possible* — but only
  as an unrehearsed, undocumented, owner-gated manual operation bounded by the 7-day
  retention window, requiring SQL skill and the encryption key, with no verification step.
- **Why it matters:** This is the most likely disaster by a wide margin. A user deletes the
  wrong client; a family member with manager role clears a case; a bad deploy writes
  garbage into one workspace. Full-database restore is not an option — it would roll every
  other paying customer back by up to 24 hours, which is itself a data-loss incident.
  So in practice the operator will attempt the hand-merge under pressure, and the failure
  modes are: the backup is older than the corruption (7-day ceiling), the diff is done by
  eye and misses records, or the merge writes an inconsistent state that then propagates
  into `tenant_workspace_history` as if it were legitimate. There is no verification
  afterwards because there is no reconciliation job (DR-08).
- **Fix:**
  1. Write and test a `pnpm dr:restore-tenant` script: takes a source dump plus a tenant id,
     restores that tenant's rows into a staging schema, diffs against live, and requires an
     explicit confirmation before writing. Exercise it in the DR-01 drill.
  2. Build the read side of `tenant_workspace_history` (DR-05) — for the legacy blob this
     turns single-tenant recovery from a multi-hour project restore into a single query.
  3. Extend the same versioning idea to the canonical tables (DR-06), so the in-database
     undo covers what the product is actually migrating toward.
  4. Do not leave the recovery path gated on one individual's Supabase owner credential
     with no documented break-glass alternative.
- **Confidence:** CONFIRMED

---

### [BLOCKER] Nothing detects silent data loss. The customer is the monitor — and this has already happened

- **ID:** DR-03
- **File:** not found (no monitoring/alerting anywhere in repo). Related:
  `apps/api/src/container.ts:610-655`; `PILOT_RELEASE.md:52`;
  `packages/application/src/ports/workspace-shrink-guard.test.ts:4-17`
- **What:** There is no monitoring, alerting, row-count check, drift check, or integrity
  job anywhere in the repository. A grep for Sentry/Datadog/PagerDuty/alerting across
  `apps/`, `packages/` and `.github/` returns only two source comments observing that a
  lost audit record "is a monitoring problem" (`packages/application/src/use-cases/authorize.ts:75`)
  — with no monitoring behind them.
  `/ready` (`apps/api/src/container.ts:631-650`) issues a single query asserting that six
  schema objects exist (`resolve_caredesk_actor`, `tenant_workspace`, `workspace_file`,
  `list_caredesk_family_members`, `product_subscription`, `workflow_instance`). It reports
  green against a database in which every one of those tables has been emptied.
  `PILOT_RELEASE.md:52` is the entire detection strategy: "Review `/ready`, failed logins,
  storage errors and failed CI daily during the pilot" — a human, once a day, reading
  signals that cannot reveal an emptied tenant.
  The counterfactual is not needed. The incident described in
  `packages/application/src/ports/workspace-shrink-guard.test.ts:4-17` — "a perfectly
  well-formed save request that replaced a populated account with a set of blank values,
  and the optimistic version check waved it through" — was discovered by a person noticing
  a named customer's case was not on the screen (`WORK-PLAN-2026-08-29.md:34`).
- **Why it matters:** Detection latency directly multiplies every other weakness. Backup
  retention is 7 rolling days; PITR is off. If loss is not noticed within 7 days it is
  permanent regardless of how good the restore procedure is. The stated RPO of ≤24 hours
  is meaningless if the mean time to detection is measured in days. For regulated
  employment and identity data — passport scans, visa authorizations, payroll — a customer
  discovering the loss themselves is also a reportable security-incident trigger under the
  process `PILOT_RELEASE.md:47` requires but which does not yet exist.
- **Fix:**
  1. Cheapest high-value control first: a daily job that records per-tenant row counts for
     `tenant_workspace` (populated entries), `workspace_file`, `document`, `employment_case`,
     `task`, `payroll_entry`, and alerts on any tenant whose count drops by more than a
     small threshold. This is a few dozen lines and would have caught the incident.
  2. Alert on `WORKSPACE_SHRINK_REJECTED` (`packages/application/src/ports/workspace-repository.ts:16`).
     Today the guard correctly refuses the write — and nobody is told a customer's client
     just tried to erase their account.
  3. Extend `/ready` or add a separate `/internal/integrity` to assert non-emptiness of
     core tables for provisioned tenants, not merely their existence.
  4. Add uptime and error monitoring with a real alert destination before real PII lands.
- **Confidence:** CONFIRMED

---

### [HIGH] PITR is not enabled; the entire recovery envelope is seven daily snapshots

- **ID:** DR-04
- **File:** `database/migrations/0035_workspace_version_history.sql:6`;
  `docs/operations/production-release-and-recovery.md:34-36`, `:9-13`;
  `docs/governance/WORK-PLAN-2026-08-29.md:24`
- **What:** PITR is explicitly not configured. The clearest statement is in the migration
  comment itself: "point-in-time recovery is not enabled on this project, and the backup
  project mirrors documents only, not the workspace"
  (`0035_workspace_version_history.sql:6`). The policy document defers it —
  "Broader commercial launch requires a fresh risk review and may require Point-in-Time
  Recovery" (`:35-36`).
  **Window: none.** Recovery granularity is one physical snapshot per day. Retention is 7
  rolling days — confirmed by observation (`:10-11`, seven retained daily backups, latest
  2026-08-03 20:44:45 UTC) and by the operator's own note that "the 22.8 backup is the only
  one preceding the overwrite (23.8, 04:39 UTC); retention is 7 rolling days"
  (`WORK-PLAN-2026-08-29.md:24`).
  The repo **does** state which plan it relies on — Supabase Pro, upgraded 2026-08-04
  (`:9`, `:24-25`) — so this is not an unstated assumption. That is a point in its favour.
  What is unstated is the retention period *configured* on that plan (the policy says "with
  the desired retention period" without naming one) and whether anyone has verified it
  since the upgrade.
- **Why it matters:** Without PITR, the best possible outcome after a mid-day corruption is
  losing everything since the previous night's snapshot — up to 24 hours of a family's
  payroll entries, uploaded documents and case updates. With a 7-day ceiling, any loss that
  survives a week is unrecoverable by any means. Combined with DR-03 (no detection), that
  week can elapse silently.
- **Fix:**
  1. Enable PITR on the production project before real customer data is onboarded. On
     Supabase this is a plan/add-on decision, so make it explicitly and record the retention
     window in `production-release-and-recovery.md` next to the RPO statement.
  2. Until PITR exists, revise the stated RPO honestly: it is ≤24 hours *only for detected*
     loss, and effectively unbounded for undetected loss.
  3. Verify and document the actual configured retention on the Pro project rather than
     "the desired retention period".
- **Confidence:** CONFIRMED

---

### [HIGH] Migration 0035 is the right idea, but it covers only the legacy blob, no code reads it, and it may not be applied to production

- **ID:** DR-05
- **File:** `database/migrations/0035_workspace_version_history.sql` (whole file);
  `docs/governance/WORK-PLAN-2026-08-29.md:40-44`; `apps/api/src/container.ts:631-650`
- **What:** Read on its own terms this migration is well built, and this audit should say so
  plainly. **What it protects:**
  - Every superseded version of `tenant_workspace.payload` is archived by a `BEFORE UPDATE`
    trigger (`:67-70`), deliberately at the database layer "so that it also captures writes
    that bypass the API — manual SQL, the re-encryption pass in `PgWorkspaceRepository.find`,
    and any future code path" (`:10-12`). That re-encryption pass is real
    (`packages/db/src/workspace-repository.ts:110-119`), so this was a correct call.
  - Purely additive: no column dropped, no value changed, `tenant_workspace` untouched (`:8-9`).
  - The archive is seeded with every tenant's current state (`:72-78`), so the version live
    at migration time survives even if the very next write is bad.
  - `unique (tenant_id, version)` plus `on conflict do nothing` (`:28`, `:57`) means a
    re-run cannot fail a customer's save.
  - RLS enabled *and* forced with a tenant-scoped policy (`:34-39`); grants are
    `select, insert` only — "Deliberately no update and no delete" (`:41-44`).
  - `revoke all on function ... from public` (`:65`), closing the PostgREST-exposure hole
    that PostgreSQL's default `EXECUTE to PUBLIC` would otherwise open — this was a
    follow-up fix (commit `ea3ca81`).
  - Payload stays encrypted under `WORKSPACE_ENCRYPTION_KEY` with tenant id as AAD, so
    archiving does not widen read blast radius (`:14-16`).

  **What it does not protect:**
  1. **Nothing reads it.** `tenant_workspace_history` appears in no TypeScript file, no
     repository method, no API route, no script — grep across the repo returns only the
     migration itself. There is a write path and no read path. Recovery still requires a
     human with a database connection, SQL, and the encryption key.
  2. **DELETE is not archived.** The trigger is `BEFORE UPDATE` only (`:67-70`) while
     `caredesk_app` still holds `DELETE` on `tenant_workspace` (`0011_tenant_workspace.sql:23`).
     A delete of the row loses the then-current version.
  3. **Legacy blob only.** It covers `tenant_workspace.payload` — the compatibility MVP
     snapshot. It does **not** cover `employment_case`, `document`, `document_version`,
     `task`, `contact`, `payroll_month_close`, `payroll_entry`, the leave ledger, billing,
     or `workspace_file`. Those are the canonical tables the product is migrating toward
     (`docs/adr/ADR-006-normalized-persistence-migration.md`), and they have no history.
  4. **No document bytes and no `workspace_file` rows.**
  5. **Key dependency.** History is encrypted with `WORKSPACE_ENCRYPTION_KEY`. Losing or
     rotating that key without escrow makes the entire archive unreadable — see DR-12.
  6. **No pruning, no retention.** Unbounded growth, and archived payloads keep data that
     the privacy policy requires to be deleted — see DR-09.
  7. **Not enforced anywhere.** `/ready` checks six schema objects and
     `tenant_workspace_history` is not among them (`apps/api/src/container.ts:631-637`), so
     production reports green without the safety net. `docs/governance/WORK-PLAN-2026-08-29.md:40-44`
     lists applying 0035 to production as still-pending step 2 — "until it runs, there is
     no safety net."
- **Why it matters:** A reader of this migration could reasonably conclude the workspace is
  now recoverable. It is only *archivable*. In a live incident the operator still has to
  write ad-hoc SQL against an encrypted JSONB column under pressure — the same manual work
  as before, just with better source material. And if the migration is not applied to the
  production project, none of it exists at all.
- **Fix:**
  1. Confirm 0035 is applied to production and add `tenant_workspace_history` to the
     `/ready` object check so a missing safety net fails the readiness gate.
  2. Build the read path: a repository method listing versions for a tenant and an
     operator-only CLI that decrypts and diffs a chosen version against live. This is small
     and it is the difference between an archive and a recovery capability.
  3. Add an `AFTER DELETE` archive branch, or revoke `DELETE` on `tenant_workspace` from
     `caredesk_app` entirely (nothing in the application appears to need it).
  4. Define a retention/pruning policy for the archive that is consistent with the privacy
     notice, executed by the admin role.
  5. Add a test. This migration has no coverage; the RLS harness
     (`packages/db/src/rls-check.ts`) should assert the archive is tenant-isolated and that
     `caredesk_app` cannot update or delete a history row.
- **Confidence:** CONFIRMED

---

### [HIGH] Canonical tables have hard deletes and no version history; there are no soft deletes anywhere

- **ID:** DR-06
- **File:** `database/migrations/0008_documents.sql:135`, `0007_tasks_and_timeline.sql:94`,
  `0006_organizations_and_contacts.sql:153`, `0012_workspace_files.sql:26`,
  `0011_tenant_workspace.sql:23`, `0021_visa_renewal_persistence.sql:272`
- **What:** Across all 36 migrations there is **no** `deleted_at`, `is_deleted`, or any
  soft-delete column — the only match for that family of names is `archived_at` inside
  `tenant_workspace_history` (`0035:26`). `caredesk_app` holds `select, insert, update,
  delete` on `document`, `task`, contacts/organizations, `workspace_file`,
  `tenant_workspace`, and the visa-renewal tables.
  The architecture documentation anticipated this: `docs/architecture/database-blueprint.md:102-103`
  states "Soft deletion is permitted only where retention policy allows it. Audit, payroll
  snapshots, rule versions, and ledger entries are not silently [deleted]" — the retention
  policy that would authorise it remains an open legal decision (`:469-480`, "No developer
  may invent retention periods").
  The genuine mitigations that do exist: `document_version` is immutable (insert-only,
  `0008:57-58`), so replacing a file adds a version rather than overwriting; `audit_event`
  (`0009`), `timeline_event` (`0007`), `binder_export_receipt` (`0031`) and
  `automation_execution_receipt` (`0029`) are all append-only by grant. Those preserve the
  *record* of what happened. They do not preserve the data.
- **Why it matters:** A manager-role family member deletes a case, or a bad deploy issues a
  `DELETE` with a wrong predicate. The row is gone immediately and irreversibly. The audit
  trail will faithfully record that it happened and by whom, which is useful for the
  incident report and useless for the customer. Recovery then falls back to DR-02 —
  full-project restore and hand-merge — for what should be a one-click undo.
- **Fix:**
  1. Before onboarding real data, remove `DELETE` from `caredesk_app`'s grants on the
     tables where the application does not require it, and implement deletion as a status
     change plus a scheduled hard-delete governed by the retention policy.
  2. Where deletion must remain immediate, mirror the 0035 pattern: a trigger-written
     history table with insert-only grants.
  3. Resolve the blocking dependency: the retention periods are already written down in
     `CareDesk_Legal_Validation_P0.docx` §4 (payroll 7 years, ID scans 90 days after
     employment ends, AI questions 30 days, usage logs 12 months, inactive accounts 24
     months). Get those approved and encoded so soft delete stops being blocked on an
     "open legal decision".
- **Confidence:** CONFIRMED

---

### [HIGH] The off-site database backup and Storage copy are manual; there is no automation and no named owner

- **ID:** DR-07
- **File:** `docs/operations/production-release-and-recovery.md:16-18`, `:26-30`, `:38-61`;
  `package.json:12-30`; `.github/workflows/ci.yml:1-8`
- **What:** The policy requires "a separate daily off-site logical backup of database roles,
  schema, and data" (`:26-27`) and "a separate daily off-site copy of every private Storage
  object" (`:28-29`), both encrypted with access limited to production operators (`:30`).
  The document is explicit that these are not yet in place: "an off-site logical backup and
  Storage copy must be automated" (`:17`).
  What exists is a manual procedure to be run **before a schema change** (`:38-61`): three
  logical exports (`roles.sql`, `schema.sql`, `data.sql`) and
  `npx supabase storage cp -r ss://caredesk-private-documents <dir>\storage --experimental`
  (`:56`), with SHA-256 checksums, project ref, timestamps, object count and operator
  recorded (`:60-61`).
  There is no automation behind it: `package.json` has no backup/restore/verify script;
  `.github/workflows/ci.yml` triggers only on `workflow_dispatch`, `pull_request` and pushes
  to `main`/`staging` (`:3-7`) — there is **no `schedule:` trigger anywhere**; `scripts/`
  contains only lint and hygiene checks. Ownership is "the production operators" (`:30`)
  and `PILOT_RELEASE.md:13` — no named individual, no rota.
  Note also the copy command uses an `--experimental` CLI flag for a control on which
  customer document recovery depends.
- **Why it matters:** A "daily" backup that depends on a person remembering will be missed,
  and its absence is invisible until it is needed. It is also tied to the wrong event: the
  procedure fires before schema changes, but the realistic loss events (a bad application
  write, a user error, a leaked service-role key) are unrelated to schema changes. Worse,
  the managed Supabase backups and the off-site copy live in the same vendor account: a
  compromised or closed Supabase organisation takes out both simultaneously — which is
  precisely the failure the off-site copy is supposed to cover, and it currently does not
  exist.
- **Fix:**
  1. Automate both jobs on a schedule outside Vercel and outside the Supabase account (a
     scheduled GitHub Action with encrypted artifact upload to independent object storage,
     or an equivalent runner). Fail loudly and alert when a run is missed.
  2. Store the off-site copy under credentials that are not the Supabase account's, so a
     single-account compromise cannot destroy every copy.
  3. Name a specific owner and a backup owner in `production-release-and-recovery.md`.
  4. Automate the checksum recording and verification the policy already specifies (`:63-70`)
     rather than leaving it as a manual discipline.
- **Confidence:** CONFIRMED

---

### [HIGH] Staging and production may still share one Supabase project

- **ID:** DR-08
- **File:** `docs/operations/production-release-and-recovery.md:16-17`, `:22-23`, `:99`;
  `PILOT_RELEASE.md:1`
- **What:** "Staging and production still need separate Supabase projects" (`:16-17`),
  present tense, in the launch-blockers section. The minimum supported setup requires
  "Separate Supabase projects for staging and production. Staging must never use the
  production database or private Storage bucket" (`:22-23`), and the release checklist
  carries "staging and production project refs are different" as an unchecked item (`:99`).
  Nothing in the repository demonstrates the separation has been made.
- **Why it matters:** Everything else in this audit assumes production data can only be
  damaged by production activity. If the projects are shared, a staging `db reset`, a seed
  script, a truncate during a test, or a Playwright run against the wrong `DATABASE_URL`
  destroys real customer data directly. The release checklist explicitly guards against
  "`db reset`, seed, truncate, or bulk delete" in a release (`:105`), which only makes
  sense because the risk is live. Combined with no PITR, no detection and no rehearsed
  restore, a single mistyped environment variable is an extinction event for the pilot's
  data.
- **Fix:** Separate the projects before any real customer data is entered, and make the
  API refuse to start when its `DATABASE_URL` project ref matches a configured staging ref.
  This is cheap and it removes a whole category of accident.
- **Confidence:** LIKELY (the repository states the separation is outstanding; the actual
  current infrastructure state cannot be verified from the repo)

---

### [HIGH] Database rows and storage objects will drift after any restore, and no reconciliation job exists

- **ID:** DR-09
- **File:** `docs/operations/production-release-and-recovery.md:28-29`;
  `apps/api/src/storage/mirrored-document-storage.ts:5-6`, `:29-31`;
  `packages/application/src/use-cases/manage-workspace-files.ts:97-114`;
  `database/migrations/0012_workspace_files.sql:4-17`; reconciliation job: NOT FOUND IN REPO
- **What:** Document bytes and their metadata live in two independent systems with
  independent recovery timelines. The policy names the hazard: "Supabase database backups
  contain Storage metadata, not the uploaded files" (`:28-29`).
  The mirror makes this more subtle rather than less. `MirroredDocumentStorage` writes every
  object to an independent backup project before reporting success (`:14-23`), and
  deliberately does **not** propagate deletes: "User deletion intentionally does not delete
  the backup copy, preserving recovery from accidental deletion" (`:5-6`, `:29-31`). So
  after any restore:
  - **Rows without bytes:** an object deleted from the primary bucket after the backup was
    taken is restored as a `workspace_file` row pointing at a `storage_key` that no longer
    resolves in the primary. The signed-URL path (`GetWorkspaceFileUrl`) issues a link that
    404s. The bytes are still in the mirror, but nothing reads the mirror
    (`getSignedUrl` always uses the primary, `:25-27`).
  - **Bytes without rows:** an object uploaded after the backup keeps its bytes in both
    buckets while its row is gone, becoming an orphan that no tenant can see, no API can
    reach, and no erasure request can find.
  - **Deleted documents:** `DeleteWorkspaceFile` hard-deletes the `workspace_file` row
    (`manage-workspace-files.ts:99`) and then the primary object (`:101`). The mirror copy
    survives — but the row carrying its `storage_key` is gone, so the only remaining map to
    that byte range is the object path itself (`<tenantId>/workspaces/<clientId>/documents/<documentId>/<objectId>`,
    `apps/api/src/storage/supabase-document-storage.ts:40`) plus the
    `workspace.document.deleted` audit event. Recoverable by a human who knows this; not
    documented anywhere.
  No reconciliation exists. There is no script in `scripts/`, no `package.json` command, and
  no CI job. The requirement is stated only as future work:
  `docs/governance/next-delivery-wave-gap-analysis.md:174` ("Database restore and
  reconciliation must verify tenant counts, worker-access relationships, intent/attempt
  pairs and audit references before re-enabling delivery") and as one line of the drill
  acceptance criteria (`production-release-and-recovery.md:120`).
- **Why it matters:** Post-restore, a family opens the caregiver's passport and gets an
  error — with no indication whether the file is lost or merely unreachable, and no tool to
  tell the operator which of the two it is or how many documents are affected. For a product
  whose core promise is that the visa and passport paperwork is in one safe place, a
  silently broken document is the worst possible failure, and it will be discovered by the
  customer at the moment they need the document most.
- **Fix:**
  1. Write a reconciliation script (`pnpm dr:reconcile`) that lists every `workspace_file`
     and `document_version` storage key, lists both buckets, and reports three sets: rows
     without primary bytes, primary bytes without rows, and rows whose bytes exist only in
     the mirror. Run it after every restore and on a schedule.
  2. Add a documented fallback read from the mirror bucket for the "primary object missing"
     case, so the second copy is actually reachable in an incident.
  3. Make the reconciliation output part of the drill record required by
     `production-release-and-recovery.md:127-129`.
- **Confidence:** CONFIRMED

---

### [HIGH] Erasure obligations conflict with immutable copies that have no purge process

- **ID:** DR-10
- **File:** `CareDesk_Legal_Validation_P0.docx` §4 (retention table), §5 (rights), Part 3
  (P0 checklist); `apps/api/src/storage/mirrored-document-storage.ts:5-6`, `:29-31`;
  `database/migrations/0035_workspace_version_history.sql:41-44`;
  `docs/architecture/database-blueprint.md:469-480`; `PILOT_RELEASE.md:38`, `:43-44`
- **What:** The legal validation document sets concrete obligations under the Israeli
  Privacy Protection Law 5741-1981 and Amendment 13 (in force August 2025, penalties to
  ₪3.2M): a named DPO, database registration, a deletion policy with an access/correction/
  portability process, an audit log of sensitive access, DPAs with cloud providers, and a
  specific retention schedule — payroll 7 years (statutory), **passport/ID scans deleted 90
  days after employment ends**, AI questions anonymised after 30 days, usage logs 12 months,
  inactive accounts deleted after 24 months. "Automatic document deletion policy (90 days)"
  is a mandatory P0 pre-launch checklist item.
  Against that, three separate immutable-copy conflicts exist today, none of them documented
  as accepted risk:
  1. **The mirror bucket never forgets.** Deleting a document deletes only the primary
     (`mirrored-document-storage.ts:29-31`); the backup copy is retained deliberately. There
     is no purge path, no expiry, and no process for removing a specific object from the
     mirror on an erasure request. A passport scan a customer deleted persists indefinitely
     in a second Supabase project.
  2. **Workspace history never forgets.** `tenant_workspace_history` has no `delete` grant
     and no pruning (`0035:41-44`, "Pruning, if it is ever needed, is an operator action
     through the admin role"). Every archived payload contains the personal data as it stood
     at that version, including records the customer has since deleted.
  3. **Daily physical backups** hold erased data for the retention window. This one is a
     normal and defensible industry position — but it is nowhere written down as such.
  Additionally, **no automatic deletion exists at all**: no scheduled job, no retention
  enforcement, no erasure endpoint anywhere in `apps/api/src/routes/`. And the DPO fields in
  the privacy notice are placeholders ("[to be filled before launch]"), so there is no named
  recipient for the erasure or access request that `PILOT_RELEASE.md:38` requires to have "a
  named operator and written response procedure".
  `docs/architecture/database-blueprint.md:469-480` acknowledges the whole area is open:
  retention periods "remain an open legal/privacy decision… No developer may invent
  retention periods."
- **Why it matters:** A customer exercises the right to erasure. The operator deletes the
  rows and the primary objects, and truthfully believes the request is fulfilled — while
  copies of the same identity documents remain in the mirror bucket and inside archived
  workspace payloads, with no inventory of where they are and no tool to remove them. Under
  Amendment 13 that is an unfulfilled erasure request on sensitive data, with regulator
  exposure. It is also the classic trap: the controls added for data safety (DR-05, DR-09)
  are the ones that create the compliance conflict, and neither was reconciled against the
  retention schedule that already exists in the legal document.
- **Fix:**
  1. Write the erasure procedure **as a procedure**, enumerating every copy: primary bucket,
     mirror bucket, `tenant_workspace_history`, physical backups, off-site logical backups.
     For each, state either "purged on request" or "retained for N days as a documented,
     disclosed exception", and put the disclosure in the privacy notice.
  2. Propagate erasure to the mirror explicitly — a distinct operator-invoked path, separate
     from ordinary user deletion, so the accidental-deletion safety net survives while
     genuine erasure completes.
  3. Give `tenant_workspace_history` a retention window and an admin-role pruning job.
  4. Implement the 90-day identity-document deletion the P0 checklist requires, as a
     scheduled job, before real ID scans are accepted.
  5. Name the DPO and fill the contact fields before the first real customer.
- **Confidence:** CONFIRMED

---

### [MEDIUM] The "binder export" is a receipt plus a browser print — it is not a data export and not a recovery path

- **ID:** DR-11
- **File:** `database/migrations/0031_binder_export_receipt.sql:1-12`;
  `apps/api/src/binder-export-service.ts:5-17`, `:34-38`;
  `apps/web/src/pages/EmergencyBinderPage.tsx:172`;
  `apps/api/src/evidence-export-service.ts:6-25`
- **What:** Assessed honestly: `binder_export_receipt` is exactly what its own migration
  comment says — "durable evidence that a specific, explicitly selected manifest was
  exported for a case: which sections, which document ids, by whom and when, plus a
  deterministic sha256 fingerprint" (`0031:3-7`). It stores section names, document **ids**,
  actor, timestamp and a hash. It stores **no customer data**: "never file bytes, storage
  keys, or sensitive values — ids, section names and status metadata only"
  (`binder-export-service.ts:34`, `0031:22-24`). It is append-only and deliberately carries
  no sharing/link table (`0031:9-12`).
  The export it records is a client-side browser print: `EmergencyBinderPage` calls
  `window.print()` (`apps/web/src/pages/EmergencyBinderPage.tsx:172`). Nothing on the server
  produces a data file. `evidence-export-service.ts` likewise produces a metadata-only
  manifest of audit and timeline events, explicitly excluding "document bytes, storage keys,
  message bodies, extracted field values or AI prompt/completion text" (`:11-15`).
  There is no full-tenant export endpoint — `apps/api/src/routes/` contains no export route
  beyond `binder-exports` and `evidence-exports`. The closest thing is `GET /workspace`,
  which returns the legacy MVP workspace payload to an authenticated owner: real data, but
  the compatibility blob only, with no canonical-table coverage and no document bytes.
  The internal backlog agrees this is unfinished: "secure server-side Binder export" is
  listed under capability hardening (`CareDesk_Claude_Code_Handoff_2026-08-17/04_OPEN_WORK_AND_PRIORITIES.md:56`).
- **Why it matters:** Two consequences. Operationally, a printed PDF held by the customer is
  not a restore path — it cannot be re-imported, it covers a hand-picked subset, CareDesk
  does not retain it, and it excludes the original document files. It should not be counted
  as mitigation for any finding above. Legally, the privacy notice promises data portability
  "in a clean format (CSV/JSON)" via "export from settings" (`CareDesk_Legal_Validation_P0.docx` §5)
  — a capability that does not exist, while `PILOT_RELEASE.md:38` requires export requests to
  have a named operator and a written procedure.
- **Fix:**
  1. Build a server-side, tenant-scoped export producing machine-readable JSON of the
     canonical tables plus a manifest of documents, and either the bytes or signed
     time-limited links. Record it with the existing receipt mechanism.
  2. Until it exists, do not describe the binder as an export or a backup in any
     customer-facing copy, and update the privacy notice's portability row to match reality.
  3. Treat the export as a genuine (if slow) tenant-recovery input once it round-trips —
     which requires an import path, currently absent.
- **Confidence:** CONFIRMED

---

### [MEDIUM] The document mirror is undocumented in DEPLOYMENT.md, has no backfill, and no completeness check

- **ID:** DR-12
- **File:** `apps/api/src/env.ts:47-50`, `:94-116`; `apps/api/src/container.ts:425-444`;
  `.env.example:48-52`; `DEPLOYMENT.md:36-47`
- **What:** The mirror is a real control and deserves credit: production **refuses to start**
  with primary document storage configured but without an independent backup destination —
  "Production document storage requires an independent backup destination"
  (`apps/api/src/env.ts:106-116`), and all three `BACKUP_SUPABASE_*` settings must be
  supplied together (`:94-104`). `.env.example:48-52` documents them.
  But `DEPLOYMENT.md`'s "Vercel API project" environment-variable list (`:36-47`) does **not
  mention `BACKUP_SUPABASE_URL`, `BACKUP_SUPABASE_SERVICE_ROLE_KEY` or
  `BACKUP_SUPABASE_STORAGE_BUCKET` at all**. An operator following the deployment document
  faithfully will configure production and hit a startup failure whose cause is documented
  only in `.env.example` and the Zod schema.
  Three further weaknesses in the mirror itself:
  1. **No backfill.** Only objects uploaded *after* the mirror was configured exist in the
     backup bucket. Anything uploaded before is unprotected, and nothing detects this.
  2. **No completeness check.** Nothing compares object counts or checksums between the two
     buckets. `production-release-and-recovery.md:66` requires "the Storage object count
     matches the source bucket" as part of a *manual* backup verification; there is no
     equivalent for the live mirror.
  3. **Not an independent blast radius.** Both destinations are Supabase projects reached
     with service-role keys held by the same API process. A leaked service-role key, a
     compromised deployment, or a closed Supabase account can affect both. It is a strong
     defence against *accidental* deletion (deletes are not propagated, `:5-6`) and a weak
     one against compromise or vendor failure.
  4. The backup project's **region is unspecified anywhere in the repo**, while
     `PILOT_RELEASE.md:6` requires an approved `PILOT_DATA_REGION` for the primary and the
     privacy notice §7 requires equivalent protection plus a DPA for any cross-border
     transfer. A second copy of every passport scan is being written to an undocumented
     destination.
- **Why it matters:** The mirror is currently the only automated backup of document bytes in
  existence (DR-07). Its silent gaps — pre-existing objects, no verification, undocumented
  region — mean the team may believe document bytes are covered when they are partially
  covered, which is worse than knowing they are not.
- **Fix:**
  1. Add `BACKUP_SUPABASE_*` to `DEPLOYMENT.md`'s API variable list with a one-line
     explanation of why production fails closed without it.
  2. Write a one-off backfill and a recurring completeness check comparing the two buckets;
     fold the result into the DR-09 reconciliation script.
  3. Document the backup project's region and include it in the data-region approval
     required by `PILOT_RELEASE.md:6` and the privacy gate at `:41-47`.
  4. Add a genuinely independent third copy (different vendor/credentials) for the off-site
     requirement at `production-release-and-recovery.md:28-29`.
- **Confidence:** CONFIRMED

---

### [MEDIUM] WORKSPACE_ENCRYPTION_KEY is a single point of unrecoverable loss for live data, history and every backup

- **ID:** DR-13
- **File:** `apps/api/src/env.ts:171-186`; `packages/db/src/workspace-repository.ts:110-119`,
  `:139-149`, `:152-188`; `database/migrations/0035_workspace_version_history.sql:14-16`;
  key management procedure: NOT FOUND IN REPO
- **What:** `tenant_workspace.payload` is encrypted with AES-256-GCM under
  `WORKSPACE_ENCRYPTION_KEY` with the tenant id as AAD; production refuses to start without
  it when a database is configured (`apps/api/src/env.ts:184`). `PgWorkspaceRepository.find`
  transparently re-encrypts any plaintext row it encounters (`workspace-repository.ts:110-119`).
  `tenant_workspace_history` stores the payload "exactly as stored, which means it stays
  encrypted under `WORKSPACE_ENCRYPTION_KEY`" (`0035:14-16`).
  Encrypting at the application layer is the right call. The gap is that **no key management
  procedure exists anywhere in the repository** — no escrow, no rotation runbook, no
  key-version field on the payload envelope, and no mention of the key in
  `production-release-and-recovery.md`'s backup verification criteria (`:63-70`) or in the
  restore drill acceptance list (`:115-129`).
- **Why it matters:** Every recovery path in this audit routes through this key. Restore the
  database perfectly and lose the key, and you have restored ciphertext: the customer data
  is gone as surely as if the backup had failed. Conversely, the restore drill as currently
  written could pass while never proving the key still decrypts the restored rows, because
  decryption is not one of the seven acceptance checks. Rotation is also unaddressed: there
  is no key id in the envelope, so a rotation would need to decrypt-and-rewrite every row
  *and* every archived history version, and history has no update grant (`0035:41-44`).
- **Fix:**
  1. Document key custody: where the key lives, who can retrieve it, and the escrow such
     that losing one person or one secret store does not lose every customer's data.
  2. Add "restored workspace payloads decrypt and match the source" to the drill acceptance
     criteria at `:115-129`.
  3. Add a key-version identifier to the encryption envelope now, while the data volume is
     small, so rotation remains possible later.
- **Confidence:** CONFIRMED

---

### [MEDIUM] RTO/RPO are stated but never measured, and the audit trail shares the database's fate with no retention policy

- **ID:** DR-14
- **File:** `docs/operations/production-release-and-recovery.md:34-36`;
  `database/migrations/0009_audit_event.sql:21-39`;
  `docs/architecture/database-blueprint.md:469-480`
- **What:** Two related gaps.
  *Targets:* RPO ≤ 24 hours and RTO ≤ 4 hours are stated explicitly (`:34-35`) and marked
  provisional for the closed pilot. Credit where due — most products this age state nothing.
  But neither has been measured, because no drill has run (DR-01), and the RPO figure is
  only meaningful for *detected* loss (DR-03). No document distinguishes the two.
  *Audit trail:* `audit_event` is well designed for evidence — append-only by grant
  ("An audit trail the application can rewrite is not an audit trail", `0009:21-25`), and
  deliberately without an FK to `tenant` so that erasing a tenant cannot cascade away the
  evidence of what was done to their data, "including the erasure itself" (`0009:27-39`).
  That reasoning is sound. What is missing operationally: the audit trail is in the same
  database as everything else, so it is backed up on the same schedule and rolled back by
  the same restore. Restoring to T-24h to recover lost data also erases the audit record of
  the 24 hours under investigation. There is no separate audit export, no append-only
  off-database sink, and no defined retention period — `database-blueprint.md:469-480` leaves
  retention open, while the legal document requires an audit log of all sensitive-document
  access.
- **Why it matters:** After an incident the audit trail is the only source of what happened,
  and the recovery action destroys the portion of it that matters most. For a regulated
  product this also undermines the evidentiary value the append-only design was built for.
- **Fix:**
  1. Export `audit_event` continuously (or at least daily) to append-only off-database
     storage, so a restore cannot roll it back.
  2. Before restoring, always snapshot the current database first — make this an explicit
     step in the restore runbook, not an assumption.
  3. Restate RPO/RTO in two parts: recovery-point for detected loss, and the (currently
     unbounded) exposure for undetected loss. Re-measure both from the first drill.
  4. Set an audit retention period as part of the privacy approval gate
     (`PILOT_RELEASE.md:43-44`).
- **Confidence:** CONFIRMED

---

## Minimum viable DR plan before real customer data is onboarded

Ordered. Items 1-6 are the "do not accept real PII without these" set.

1. **Separate the staging and production Supabase projects** and make the API refuse to
   start against a staging project ref. (DR-08 — cheapest removal of a whole accident class.)
2. **Run the restore drill** against synthetic data, using the acceptance criteria already
   written at `docs/operations/production-release-and-recovery.md:115-129`, plus two added
   checks: restored payloads decrypt under `WORKSPACE_ENCRYPTION_KEY`, and DB↔storage
   reconciliation is clean. **Commit the drill record with the measured wall-clock RTO.**
   (DR-01, DR-13, DR-09.)
3. **Apply migration 0035 to production and prove it**, then add `tenant_workspace_history`
   to the `/ready` object check so the safety net's absence fails readiness. (DR-05.)
4. **Ship the minimum detection control**: a daily per-tenant row-count job with alerting on
   any material drop, plus an alert on every `WORKSPACE_SHRINK_REJECTED`. Without this,
   every other control is gated on a customer complaining. (DR-03.)
5. **Enable PITR** on the production project, or record a signed, explicit acceptance that
   the recovery envelope is seven daily snapshots and that undetected loss beyond seven days
   is permanent. (DR-04.)
6. **Write the single-tenant restore procedure** and test it in the drill — restore to a
   disposable project, extract one tenant, verify, merge. Not a plan in a work item: a
   script plus a runbook page. (DR-02.)
7. **Automate the off-site logical DB backup and Storage copy** on a schedule, under
   credentials outside the Supabase account, with a missed-run alert and a named owner.
   (DR-07.)
8. **Write the reconciliation script** (rows without bytes, bytes without rows, mirror-only
   bytes) and run it after every restore and nightly. (DR-09.)
9. **Backfill the mirror bucket** for objects predating the mirror, and add
   `BACKUP_SUPABASE_*` to `DEPLOYMENT.md`. Document the backup project's region and include
   it in the data-region approval. (DR-12.)
10. **Write the erasure procedure enumerating every copy** — primary bucket, mirror bucket,
    workspace history, physical backups, off-site backups — with either a purge path or a
    disclosed retention exception per copy. Name the DPO. (DR-10.)
11. **Remove `DELETE` grants the application does not need**, and implement deletion as
    status + scheduled hard-delete once retention periods are approved. (DR-06.)
12. **Continuously export `audit_event`** to append-only off-database storage. (DR-14.)
13. **Build the server-side tenant export** so the portability promise in the privacy notice
    is true and a slow recovery input exists. (DR-11.)

## Coverage note

**Searched:** all `*.md` in the repo (including the Hebrew governance and work-plan
documents), all 36 files in `database/migrations/`, `.github/workflows/ci.yml` (the only
workflow), `package.json`, `.env.example`, `scripts/`, `apps/api/src/` (env, container,
create-server, storage adapters, export services, all routes),
`packages/application/src/ports/` and `use-cases/`, `packages/db/src/`, and the binary
`CareDesk_Legal_Validation_P0.docx` (text-extracted). Git history reviewed for incident
evidence.

**Deliberately out of scope** (assigned to other agents): API authorization logic, frontend
behaviour, DB schema/RLS correctness, release-process safety beyond its data-safety
implications, and the domain layer. RLS is referenced here only where it bears on whether a
recovery artifact leaks across tenants.

**Limits of this audit:** everything below is inferred from the repository. This audit
**cannot** verify the live infrastructure — whether 0035 is actually applied to production,
whether staging and production are now separate projects, whether the Supabase Pro retention
window is still 7 days, whether `BACKUP_SUPABASE_*` is configured in the production Vercel
project, or whether a restore drill has been performed but not recorded in the repo. Where a
finding depends on infrastructure state it is marked LIKELY rather than CONFIRMED. The one
claim I would flag for direct verification with the operator before acting: **DR-08**
(staging/production separation), because the repo states it as outstanding but that document
may lag reality.

**A closing note on tone.** The findings above are severe, but the documentation in this
repository is unusually candid about its own gaps — `production-release-and-recovery.md`
opens by saying customer data matters more than a code release, `0035`'s header narrates the
exact failure it exists to prevent, and the work plan is frank about a backup that may turn
out to be empty. The gap is execution, not awareness. That is a fixable position, and it is a
much better starting point than a repository that claimed to be covered.
