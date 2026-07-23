-- Baseline smoke-test migration (Milestone 0).
-- Proves the migration mechanism works end-to-end. Intentionally creates no
-- business table — see database/migrations/README.md and
-- docs/architecture/database-blueprint.md §11 (schema readiness gate).

create table if not exists schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);

insert into schema_migrations (version)
values ('0001_baseline')
on conflict (version) do nothing;
