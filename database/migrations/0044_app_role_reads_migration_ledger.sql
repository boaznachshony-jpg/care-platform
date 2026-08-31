-- `/ready` asks the ledger a question the app role was never allowed to ask.
--
-- WHAT HAPPENED
-- -------------
-- On 2026-08-31 production reported `Database is unreachable` for most of a
-- working day. The database was reachable throughout. The readiness probe runs
--
--   select version from schema_migrations
--
-- as `caredesk_app`, and no migration ever granted that role SELECT on the
-- table, so every probe raised 42501 and the catch around it reported the one
-- failure mode it could name. The check that exists to say "this database is
-- behind the code" was itself the reason the deployment looked dead.
--
-- The comparison is deliberate and worth keeping - REL-05 was a database
-- fourteen migrations behind an API that reported ready - so the fix is the
-- grant, not the removal of the check.
--
-- WHY THIS IS SAFE
-- ----------------
-- `schema_migrations` holds one text column: the filename of each applied
-- migration. No tenant_id, no customer data, nothing derived from customer
-- data. It is deployment metadata, and it is the one table in this schema that
-- is deliberately not tenant-scoped (see the db-path-exception comment in
-- apps/api/src/container.ts). SELECT is granted; INSERT is not, because the
-- runner writes the ledger through the owner connection (DATABASE_ADMIN_URL)
-- and an application role that can forge a ledger row can make a database
-- claim to be newer than it is - the exact failure 0038's runner work removed.
--
-- Additive: no column dropped, no row deleted, no existing value rewritten.

grant select on public.schema_migrations to caredesk_app;

insert into schema_migrations (version) values ('0044_app_role_reads_migration_ledger');
