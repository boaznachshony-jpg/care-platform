# Strangler migration from tenant workspace

Status: **Approved strategy for Sprint 0**
Last updated: 2026-08-12

## Objective and boundaries

Replace `tenant_workspace` / `MvpProfile` compatibility storage one aggregate
slice at a time with normalized PostgreSQL persistence. This strategy defines
authority, cutover, rollback, and evidence. It does not authorize product
features, migrations, or production configuration changes.

## Non-negotiable rules

- `EmploymentCase` is the central employment aggregate and the canonical case
  identifier must replace the legacy MVP client identifier at boundaries.
- A datum has one declared write authority. There is no implicit dual write.
- Compatibility projections are derived from the canonical aggregate after
  cutover; they cannot write back unless a separately approved phase contract
  explicitly assigns them authority.
- `document` / `document_version` owns documents. A migrated file produces an
  immutable version with `upload_source = migration`; legacy `workspace_file`
  metadata is not promoted as a second document model.
- Sensitive identifiers stay in their existing protected envelope until an
  approved encrypted/protected normalized design exists. They are excluded
  from plaintext backfills, logs, diffs, and reconciliation reports.
- Every read or write decision is tenant-scoped and auditable.

## Migration phases

| Phase | Read authority | Write authority | Required exit evidence |
|---|---|---|---|
| 0. Inventory | Legacy for legacy-only fields; normalized for existing aggregates | Existing owner only | Field inventory, sensitivity classification, stable tenant/case correlation |
| 1. Backfill | Legacy application path | Legacy for not-yet-cut-over fields; migration job alone may create normalized rows | Idempotent backfill, counts/checksums, exception report, no plaintext sensitive migration |
| 2. Shadow comparison | Legacy response; normalized read evaluated but not served | Same as phase 1 | Defined match thresholds met over representative tenants and retry/replay tested |
| 3. Read cutover | Normalized aggregate | One explicitly named writer to normalized storage | Feature-flag/cohort cutover, monitoring, rollback rehearsal, zero unresolved severity-1 mismatches |
| 4. Legacy freeze | Normalized aggregate | Normalized storage only; legacy snapshot read-only rollback evidence | Sustained reconciliation window and no required legacy writer |
| 5. Sunset | Normalized aggregate | Normalized storage only | All sunset criteria satisfied and deletion approved separately |

The compatibility contract for each slice must name: legacy source path,
canonical target, transformation version, write authority, cutover cohort,
reconciliation query, alert threshold, and rollback owner. If any item is
missing, that slice remains in its prior phase.

## Rollback

Read cutover must be independently reversible per tenant/cohort. Rollback
switches reads to the last intact legacy snapshot; it does not reverse-copy
normalized data into the snapshot. Normalized rows created during backfill or
cutover are retained and quarantined from further migration writes until the
incident is understood. Append-only evidence, including `document_version`,
`timeline_event`, and audit records, is never deleted or mutated to simulate a
rollback.

Rollback is triggered by unauthorized cross-tenant visibility, integrity or
relationship failure, unexplained sensitive-data exposure, sustained error
budget breach, or reconciliation beyond the approved threshold. Recovery must
record affected tenants/cases, transformation version, checkpoints, and the
decision to retry or repair.

## Reconciliation

Reconciliation runs before and after each cohort cutover and compares semantic
values, not raw JSON layout:

1. completeness: expected tenants, cases, parties, and child-record counts;
2. identity: stable legacy-client-to-EmploymentCase correlation is one-to-one;
3. field equivalence: normalized dates, enums, null/empty handling, and names;
4. relationships: all rows share the tenant and point to the intended case;
5. documents: logical document count, current version, opaque storage object,
   checksum where available, and immutable version ordering;
6. sensitive fields: presence/absence and protected-reference checks only,
   never plaintext values;
7. idempotency: rerunning a migration creates no duplicate aggregate or
   document version.

Reports contain opaque IDs, classifications, counts, and hashes only. Each
mismatch is classified as transformation, missing source, duplicate,
concurrent legacy change, or unsupported/sensitive. Automated repair is
allowed only for deterministic, approved transformations; all other repairs
require review.

## Sunset criteria for tenant_workspace

`tenant_workspace` may be removed only through a later approved migration when
all of the following are true:

- every active tenant and retained historical case has a stable canonical
  EmploymentCase correlation;
- all supported product reads and writes use normalized repositories;
- all inventory rows are normalized, deliberately retired, or covered by an
  approved protected/snapshot retention disposition;
- document bytes and metadata are represented by `document` /
  `document_version`, verified and recoverable;
- no application, job, test fixture, support procedure, or export depends on
  `tenant_workspace`, `workspace_file`, `MvpProfile`, or MVP client IDs;
- legacy writes have been disabled for at least one full approved observation
  window and reconciliation remains within threshold;
- rollback/restore and tenant export have been tested from normalized data;
- security, privacy, data-retention, Product Owner, and Data Architecture
  approvals are recorded; and
- a backup/retention disposition exists and the destructive removal is handled
  by a separate, explicitly approved change.
