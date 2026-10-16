-- 0044 granted SELECT on the ledger; forced RLS with no policy took it back.
--
-- WHAT HAPPENED
-- -------------
-- Migration 0044 gave `caredesk_app` SELECT on `schema_migrations` so `/ready`
-- could compare the live ledger against REQUIRED_MIGRATIONS. The table also
-- carries `enable row level security` and `force row level security` (the
-- rls-check asserts that for every control table), and a table with RLS
-- forced and no policy returns zero rows to everyone but its owner. The grant
-- therefore stopped the 42501 and replaced it with an empty result: on any
-- database built purely from these migrations, `/ready` reports every
-- migration as missing (SEC-DB-02).
--
-- WHAT THIS DOES
-- --------------
-- A read-only policy for the application role. `using (true)` is correct
-- here because the ledger is deployment metadata with no tenant_id and no
-- customer data - the one table in this schema that is deliberately not
-- tenant-scoped (see the db-path-exception comment in
-- apps/api/src/container.ts). INSERT stays owner-only per 0044: an
-- application role that can forge a ledger row can make a database claim to
-- be newer than it is.
--
-- `drop policy if exists` first, matching 0015's idiom, in case production
-- already carries a hand-made policy of this name from the 2026-08-31
-- recovery. Dropping a policy removes no data.
--
-- Additive: no column dropped, no row deleted, no existing value rewritten.

drop policy if exists schema_migrations_app_read on public.schema_migrations;

create policy schema_migrations_app_read
  on public.schema_migrations
  for select
  to caredesk_app
  using (true);

insert into schema_migrations (version) values ('0049_schema_migrations_app_read_policy');
