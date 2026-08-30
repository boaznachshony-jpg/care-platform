-- Close the one verb the 0035 archive trigger does not cover.
--
-- 0035 added `before update` archiving so a bad write always leaves the previous
-- version recoverable. It did not cover DELETE, and `caredesk_app` still holds a
-- delete grant from 0011 (re-granted by 0017). A single
-- `delete from tenant_workspace where tenant_id = ...` therefore destroys the
-- live version with no archive row behind it and no point-in-time recovery to
-- fall back on - exactly the unrecoverable loss 0035 was written to prevent,
-- reachable through the one statement it never guarded.
--
-- No repository method issues that DELETE today. The grant being live is the
-- problem: a future code path, an ORM-style "replace the row", or an operator
-- running a query through the app role all reach it, and nothing at the schema
-- level objects because tenant_workspace_history carries no foreign key back.
--
-- Two independent measures, because one of them being enough is an assumption:
--   1. Remove the grant, so the application role simply cannot delete.
--   2. Archive on delete anyway, so an operator connecting as the owner - who is
--      unaffected by grants - still leaves the last version recoverable.
--
-- Additive: no column dropped, no row deleted, no existing value rewritten.

revoke delete on tenant_workspace from caredesk_app;

-- The update trigger returns NEW; a BEFORE DELETE trigger must return OLD or the
-- delete is silently cancelled. Rather than branch inside one function on
-- TG_OP - which risks the update path returning the wrong record - the delete
-- path gets its own small function that shares the same insert.
create or replace function archive_tenant_workspace_on_delete()
returns trigger
language plpgsql
as $$
begin
  insert into tenant_workspace_history
    (tenant_id, version, schema_version, payload, updated_by, updated_at)
  values
    (old.tenant_id, old.version, old.schema_version, old.payload, old.updated_by, old.updated_at)
  -- The version may already be archived if an update preceded the delete in the
  -- same session. Archiving is idempotent; the delete must not fail on it.
  on conflict (tenant_id, version) do nothing;
  return old;
end;
$$;

-- Postgres grants EXECUTE on a new function to PUBLIC by default, which on
-- Supabase means the browser-facing anon and authenticated roles. The RLS
-- integration check caught exactly this on 0035; it is revoked here for the same
-- reason. A trigger needs no EXECUTE grant to fire.
revoke all privileges on function archive_tenant_workspace_on_delete() from public;

create trigger tenant_workspace_archive_before_delete
  before delete on tenant_workspace
  for each row
  execute function archive_tenant_workspace_on_delete();

insert into schema_migrations (version) values ('0037_close_workspace_delete_hole');
