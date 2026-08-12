# Future sensitive-record migration requirements

Sprint 0 does not move sensitive snapshot values into normalized plaintext
columns. A later schema proposal must satisfy these gates before any such data
is migrated:

- Define typed records for each sensitive value family (identity credentials,
  banking/payment details, payroll values, and care/medical facts). Do not use a
  generic JSON payload as the canonical model.
- Store sensitive values as application-encrypted ciphertext with explicit key
  identifiers and encryption-format versions. PostgreSQL, backups, replicas,
  logs, audit rows, and analytics exports must never receive plaintext.
- Keep searchable non-secret metadata separate and narrowly typed (for example
  document type, masked suffix, issuer, validity dates, and verification state).
  Every proposed plaintext projection needs a documented query requirement and
  data-classification review.
- Make every sensitive record tenant-owned, force RLS, include both `USING` and
  `WITH CHECK`, and use composite `(tenant_id, id)` foreign keys for all
  tenant-owned references. Add two-tenant integration coverage before rollout.
- Design key rotation and crypto-shredding before backfill. Ciphertext rows must
  record enough metadata to decrypt with the correct historical key without
  exposing key material in the database.
- Use an expand/backfill/verify/cutover/contract rollout. The backfill must be
  restartable, bounded, observable without logging values, and reconciled by
  counts plus keyed integrity checks. Destructive cleanup belongs in a later,
  separately approved release after backups and rollback windows expire.
- Preserve audit minimization: audit only the action, typed record reference,
  sensitivity class, decision, and correlation metadata—never plaintext,
  ciphertext, keys, document contents, prompts, or before/after secret values.
- Document retention, erasure, legal-hold, access-purpose, and break-glass rules
  for each record type, including how deletion interacts with immutable audit
  evidence.

These are design requirements, not authorization to create the future roadmap
schema. Any later contract changes must be proposed explicitly to the domain
owners rather than inferred in a database migration.
