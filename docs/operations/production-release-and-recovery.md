# Production release, backup, and recovery

Customer-entered data is more important than a code release. A release may be
rolled back; lost care, employment, payroll, or document data may not be
recoverable. The rules below are release gates, not suggestions.

## Current protection status and launch blockers

The Supabase organization was upgraded to Pro on 4 August 2026. The dashboard
shows seven retained daily physical database backups; the latest backup
observed during the release review was created on 3 August 2026 at 20:44:45
UTC. Both existing private Storage buckets were inspected during the same
review and contained no objects.

Managed backups are now active, but production is not yet approved for
external pilot data. Staging and production still need separate Supabase
projects, an off-site logical backup and Storage copy must be automated, and a
restore must be exercised successfully before the first external customer.

The minimum supported launch setup is:

1. Separate Supabase projects for staging and production. Staging must never
   use the production database or private Storage bucket.
2. Supabase Pro (or higher) for daily managed database backups with the desired
   retention period.
3. A separate daily off-site logical backup of database roles, schema, and
   data.
4. A separate daily off-site copy of every private Storage object. Supabase
   database backups contain Storage metadata, not the uploaded files.
5. Encrypted backup storage with access limited to the production operators.
6. A documented restore drill to a disposable project before the first pilot
   customer and at least quarterly after launch.

For the closed pilot, the provisional recovery targets are RPO <= 24 hours and
RTO <= 4 hours. Broader commercial launch requires a fresh risk review and may
require Point-in-Time Recovery.

## Backup procedure before a schema change

Use a timestamped directory outside the repository. Never commit dumps or
customer files to git. The administrative connection string and access token
must come from the operator's secret store, not command-line history.

Create the three logical database exports described by the Supabase backup and
restore guide:

```text
roles.sql   -- custom database roles
schema.sql  -- application schema
data.sql    -- application data, using COPY
```

Then copy the private document bucket recursively with the linked Supabase CLI:

```powershell
npx supabase storage cp -r ss://caredesk-private-documents <backup-directory>\storage --experimental
```

The exact bucket name comes from `SUPABASE_STORAGE_BUCKET`; do not assume the
example name. Record SHA-256 checksums for every dump and Storage object, the
Supabase project ref, start/end timestamps, object count, and operator.

A backup is considered verified only when:

- all three database exports completed without errors;
- the Storage object count matches the source bucket;
- all recorded checksums can be recalculated;
- the backup is encrypted and copied off the deployment machine; and
- a restore to a disposable Supabase project completes and passes API health,
  RLS isolation, document download, and representative payroll reads.

## Safe schema evolution

All remote schema changes use committed, numbered migrations. Never edit or
renumber an applied migration and never change production through the
Dashboard SQL/Table Editor.

Use the expand/migrate/contract sequence:

1. **Expand:** add nullable columns, new tables, or compatible indexes only.
2. Deploy application code that can read both the old and new shapes.
3. **Migrate:** backfill in bounded, restartable batches and verify row counts.
4. Switch reads to the new shape and keep the old shape for at least one stable
   release.
5. **Contract:** remove old fields only in a separately reviewed release after
   a fresh verified backup and explicit approval.

`pnpm db:migration-safety` blocks edits to applied migrations and common
destructive or rolling-deployment-incompatible statements. A failed safety
check is not bypassed; the migration is redesigned and reviewed.

Each migration runs inside its own database transaction. A failed migration is
rolled back, and its version is not added to `schema_migrations`.

## Release checklist

Before production:

- [ ] staging and production project refs are different;
- [ ] the staging release passed CI, E2E, RLS, upload/download, and payroll tests;
- [ ] the latest production database backup is verified;
- [ ] the latest private Storage backup is verified;
- [ ] the quarterly restore drill is current;
- [ ] the migration safety check passed;
- [ ] the release contains no `db reset`, seed, truncate, or bulk delete command;
- [ ] the application version remains compatible with the existing schema;
- [ ] a code rollback target and forward-fix migration are prepared;
- [ ] production health and readiness checks are green after deployment.
- [ ] `pnpm test:data-safety` passes, including empty/invalid workspace,
  refresh, sign-out, failed sync, and optimistic-concurrency scenarios;
- [ ] a staging smoke test creates synthetic employer and payroll records,
  reloads, signs out/in, opens a second tab, and confirms every value remains;
- [ ] the canary account is synthetic and its workspace version and record
  counts are recorded before and after deployment;

Do not promote a release when the client reports `workspace-sync` error or when
an authenticated workspace unexpectedly becomes empty. The client deliberately
fails closed in that state and retains the same-user encrypted cache. Before a
newer remote snapshot replaces a readable cache, the previous encrypted values
are copied to the account-scoped `caredesk.workspace-backup.v1.*` recovery key.
The recovery copy is usable only while that browser session's encryption key
still exists; it is defense in depth, not a durable backup. Recovery from it is
an incident operation: keep the affected tab open, compare workspace versions
and record counts, and restore only after an authorized operator has identified
the correct source of truth. Never paste the snapshot into tickets or logs.

## Canary and post-deploy sequence

1. Deploy to staging and run CI plus the synthetic persistence smoke above.
2. Verify a current database and private-Storage backup and a recent restore drill.
3. Deploy the identical artifact to a limited synthetic canary; do not migrate
   or test with a real employer account.
4. Confirm health/readiness, authentication refresh, workspace version, record
   counts, payroll reads, document access, and browser reload/two-tab behavior.
5. Promote only after the observation window is clean and an operator records
   artifact identifier, checks, timestamps, and approval.

If any count decreases, hydration fails, or a suspicious empty workspace is
observed, stop promotion. Roll back application code to the recorded artifact;
do not roll the database schema backward. Preserve logs without personal data,
open an incident record, and use a compatible forward fix unless verified data
loss requires the documented backup restore process.

Code rollback does not roll the database backward. If a schema migration has
already committed, prefer a compatible forward fix. Restore a backup only for
confirmed corruption or loss, with an incident record and an announced
maintenance window.

## Restore drill acceptance

The drill is complete only after these checks pass on the disposable target:

1. schema migration history matches the source;
2. expected tenant, employment, payroll, task, and document row counts match;
3. an owner can sign in and access only their own tenant;
4. a family member's role is enforced;
5. a private uploaded document can be downloaded and opened;
6. a saved payroll calculation and annual total match the source;
7. the API `/health` and `/ready` endpoints return success.

Record the drill date, source backup identifier, target project ref, results,
and cleanup confirmation. Delete the disposable project only after the signed
record and checksums are stored safely.
