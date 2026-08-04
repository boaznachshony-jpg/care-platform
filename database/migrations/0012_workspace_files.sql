-- Private-file metadata for the server-backed pilot workspace. Object bytes
-- live only in a private storage bucket; this table stores the opaque key.

create table workspace_file (
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

create policy workspace_file_isolation on workspace_file
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

grant select, insert, update, delete on workspace_file to caredesk_app;

insert into schema_migrations (version) values ('0012_workspace_files');
