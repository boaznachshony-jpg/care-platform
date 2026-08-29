-- Workspace version history — the recovery path that did not exist.
--
-- Until now `tenant_workspace` kept exactly one row per tenant and every save
-- overwrote it in place. A single bad write therefore destroyed the customer's
-- data with no way back: point-in-time recovery is not enabled on this project,
-- and the backup project mirrors documents only, not the workspace.
--
-- This migration keeps every superseded version. It is purely additive: no
-- column is dropped, no value is changed, and `tenant_workspace` itself is
-- untouched. The archive is written by a trigger rather than by application
-- code so that it also captures writes that bypass the API — manual SQL, the
-- re-encryption pass in PgWorkspaceRepository.find, and any future code path.
--
-- The payload is archived exactly as stored, which means it stays encrypted
-- under WORKSPACE_ENCRYPTION_KEY with the tenant id as AAD. Archiving does not
-- widen the blast radius of a database read.

create table tenant_workspace_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  version integer not null check (version > 0),
  schema_version integer not null check (schema_version > 0),
  payload jsonb not null,
  updated_by uuid not null references app_user (id),
  updated_at timestamptz not null,
  archived_at timestamptz not null default now(),
  constraint tenant_workspace_history_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint tenant_workspace_history_unique_version unique (tenant_id, version)
);

create index tenant_workspace_history_tenant_recent
  on tenant_workspace_history (tenant_id, version desc);

alter table tenant_workspace_history enable row level security;
alter table tenant_workspace_history force row level security;

create policy tenant_workspace_history_isolation on tenant_workspace_history
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Deliberately no update and no delete. The application can write new history
-- and read it back; it cannot rewrite or erase it. Pruning, if it is ever
-- needed, is an operator action through the admin role.
grant select, insert on tenant_workspace_history to caredesk_app;

create or replace function archive_tenant_workspace_version()
returns trigger
language plpgsql
as $$
begin
  insert into tenant_workspace_history
    (tenant_id, version, schema_version, payload, updated_by, updated_at)
  values
    (old.tenant_id, old.version, old.schema_version, old.payload, old.updated_by, old.updated_at)
  -- A version is archived once. Re-running a save that did not change the
  -- version must not fail the customer's write.
  on conflict (tenant_id, version) do nothing;
  return new;
end;
$$;

-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default. The trigger
-- is an internal database boundary and must not become a browser-facing
-- executable surface merely because it exists in the public schema.
revoke all on function archive_tenant_workspace_version() from public;

create trigger tenant_workspace_archive_previous
  before update on tenant_workspace
  for each row
  execute function archive_tenant_workspace_version();

-- Seed the archive with the current state of every existing tenant, so the
-- version live right now is recoverable even if the very next write is bad.
insert into tenant_workspace_history
  (tenant_id, version, schema_version, payload, updated_by, updated_at)
select tenant_id, version, schema_version, payload, updated_by, updated_at
  from tenant_workspace
on conflict (tenant_id, version) do nothing;

insert into schema_migrations (version) values ('0035_workspace_version_history');
