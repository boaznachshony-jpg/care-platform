# ADR-006: Normalized PostgreSQL persistence migration

Status: **Accepted (architecture freeze)**
Decision date: 2026-08-12
Owners: Product Owner and Data and Domain Architecture

## Context

The pilot has two persistence shapes. PostgreSQL contains normalized,
tenant-scoped aggregates, while `tenant_workspace` stores a versioned JSON
snapshot compatible with the web `MvpProfile` and related MVP client data.
Keeping both shapes without an explicit authority rule creates ambiguous
writes, divergent records, and unsafe handling of identifiers.

## Decision

1. Normalized PostgreSQL aggregates are the canonical persistence target.
2. `EmploymentCase` is the central employment aggregate. CareRecipient,
   Employer, Caregiver, Document, Task, TimelineEvent, and later aggregates are
   reached through a tenant-scoped case relationship.
3. `tenant_workspace`, `workspace_file`, `MvpClient`, and `MvpProfile` are
   transitional compatibility mechanisms, not domain models.
4. `document` and immutable `document_version` are the canonical document
   model. `workspace_file` is transitional metadata only.
5. No new product field may be added to `MvpProfile` or the workspace payload.
   A compatibility-only change requires an accepted ADR amendment naming its
   removal condition; it must not become the sole store for new domain data.
6. A field has exactly one write authority during each migration phase.
   Undefined bidirectional or best-effort dual writes are prohibited.
7. Sensitive identifiers, including national ID, passport, policy, bank, and
   government case numbers, must not be copied into plaintext normalized
   columns. Their migration waits for an approved protected-field design.
8. Migration proceeds by tenant/case slice, with measured reconciliation and a
   reversible read cutover. The legacy snapshot remains recoverable until the
   sunset gates are met.

## Consequences

- New product work must model normalized aggregates first.
- Compatibility adapters may read legacy snapshots, but cannot redefine the
  canonical domain or silently overwrite normalized values.
- During backfill the snapshot is an input record; after a verified cutover it
  is a rollback record. It is never co-authoritative.
- Migration tooling and schema changes require separate reviewed work; this ADR
  does not implement them.
- Some legacy values remain snapshot-only until an aggregate and sensitivity-
  appropriate storage design exist.

## Alternatives rejected

- **Keep JSON as canonical:** prevents enforceable relationships, lifecycle
  rules, field-level sensitivity controls, and deterministic reconciliation.
- **Permanent dual writes:** has no reliable conflict authority and expands the
  failure surface.
- **Flatten all profile fields into columns:** preserves the wrong aggregate
  boundary and risks plaintext sensitive identifiers.

## Related governance

- `docs/architecture/strangler-migration.md`
- `docs/architecture/legacy-data-inventory.md`
- `docs/architecture/database-blueprint.md`
- `SYNC_MATRIX.md`
