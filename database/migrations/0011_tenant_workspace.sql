-- Transitional server-backed workspace for the closed pilot. This moves the
-- complete, typed MVP state out of browser-only storage while normalized
-- payroll/settings tables are introduced behind the same API boundary.

create table tenant_workspace (
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

create policy tenant_workspace_isolation on tenant_workspace
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

grant select, insert, update, delete on tenant_workspace to caredesk_app;

insert into schema_migrations (version) values ('0011_tenant_workspace');
