# Sprint 0 hardening: Definition of Done

Sprint 0 freezes and makes the canonical data architecture governable. It
delivers no product feature and is done only when:

- SOURCE_OF_TRUTH identifies the accepted architecture freeze and unambiguous
  authority order;
- ADR-006 is accepted and normalized PostgreSQL aggregates are recorded as the
  canonical target;
- EmploymentCase is documented as the central employment aggregate;
- the legacy-to-canonical mapping and data inventory classify normalized,
  snapshot-only, duplicated, sensitive, and migration-priority data;
- the strangler phases name read/write authority and prohibit undefined dual
  writes;
- rollback, reconciliation, and tenant-scoped cutover evidence are defined;
- `document` / `document_version` is confirmed as the canonical document model;
- sensitive identifiers are explicitly barred from plaintext migration;
- `tenant_workspace` sunset criteria and a separately approved removal gate are
  defined;
- `SYNC_MATRIX.md` prohibits new product fields in `MvpProfile` and requires
  governance review for compatibility exceptions;
- `BUILD_STATUS.md` records the freeze without deleting or rewriting its prior
  delivery history;
- the change touches only `docs/**`, `SYNC_MATRIX.md`, and `BUILD_STATUS.md`;
- Markdown links and terminology are reviewed, the diff contains no secrets or
  personal data, and the PR records the synchronization-matrix row and review
  evidence; and
- application code, database migrations, and production configuration remain
  unchanged.

Implementation, backfill, cutover, and destructive sunset work are explicitly
outside Sprint 0 and require later reviewed changes.
