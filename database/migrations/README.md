# Migrations

Naming convention: `NNNN_snake_case_description.sql`, zero-padded to four
digits, applied in ascending numeric order. Never renumber or edit an
applied migration — write a new one.

Milestone 0 contains a single baseline migration
(`0001_baseline.sql`) that proves the migration mechanism end-to-end without
creating any business table. Per
`docs/architecture/repository-bootstrap-plan.md` §M0.6 and
`docs/architecture/database-blueprint.md` §11 (schema readiness gate), the
full business schema — starting with the identity/tenancy tables from
`docs/architecture/database-blueprint.md` §10 migration order — is not
created until ADR-002 is Accepted.

The closed-pilot sequence currently runs through
`0019_backfill_self_service_accounts.sql`.
Applied files are immutable; every later change receives the next number.

## Running locally

Requires Docker (not available in every environment — see
`database/README.md`):

```bash
docker compose -f database/docker-compose.yml up -d
psql "$DATABASE_URL" -f database/migrations/0001_baseline.sql
```

A real migration runner (e.g. `node-pg-migrate`) will replace this manual
`psql` step once schema work begins in Milestone 1 — Milestone 0 intentionally
keeps this to the minimum needed to prove the local Postgres environment
works.
