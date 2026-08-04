-- Repair an early closed-pilot database that skipped migrations 0010-0012
-- before family access and billing were installed. Fresh databases already
-- contain these objects, so every statement remains safe to re-run there.
--
-- Migration 0013 supersedes the actor resolver introduced in 0010. We record
-- 0010 as satisfied without replacing the newer invitation-aware function.

create table if not exists tenant_workspace (
  tenant_id uuid primary key references tenant (id),
  schema_version integer not null check (schema_version > 0),
  payload jsonb not null default '{}'::jsonb,
  version integer not null default 1 check (version > 0),
  updated_by uuid not null references app_user (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_workspace_payload_object check (jsonb_typeof(payload) = 'object')
);

alter table tenant_workspace enable row level security;
alter table tenant_workspace force row level security;

drop policy if exists tenant_workspace_isolation on tenant_workspace;
create policy tenant_workspace_isolation on tenant_workspace
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

grant select, insert, update, delete on tenant_workspace to caredesk_app;
revoke all privileges on tenant_workspace from anon, authenticated;

create table if not exists workspace_file (
  tenant_id uuid not null references tenant (id),
  client_id uuid not null,
  document_id uuid not null,
  storage_key text not null,
  media_type text not null,
  size_bytes bigint not null check (size_bytes >= 0 and size_bytes <= 10000000),
  version integer not null default 1 check (version > 0),
  updated_by uuid not null references app_user (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, client_id, document_id),
  unique (tenant_id, storage_key)
);

alter table workspace_file enable row level security;
alter table workspace_file force row level security;

drop policy if exists workspace_file_isolation on workspace_file;
create policy workspace_file_isolation on workspace_file
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

grant select, insert, update, delete on workspace_file to caredesk_app;
revoke all privileges on workspace_file from anon, authenticated;

insert into schema_migrations (version)
values
  ('0010_actor_resolution'),
  ('0011_tenant_workspace'),
  ('0012_workspace_files')
on conflict (version) do nothing;

insert into schema_migrations (version)
values ('0017_restore_missing_pilot_workspace');
