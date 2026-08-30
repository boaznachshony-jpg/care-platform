-- Detection. Until this migration the customer was the monitor.
--
-- On 2026-08-29 a browser cache key died while the encrypted data survived, the
-- client published a snapshot of empty strings, and the server accepted it. It
-- was found because a person noticed a named care recipient was missing from
-- the screen. 0035 and 0037 made that loss recoverable; nothing makes it
-- noticeable. Backup retention is seven rolling days and PITR is off, so loss
-- that is not seen within a week is permanent no matter how good the restore
-- procedure is. Detection latency is therefore not a nice-to-have next to the
-- recovery controls - it is what decides whether they can be used at all.
--
-- Two objects, and a deliberate split between them:
--
--   `tenant_data_census` is the memory. Nothing else in the schema records what
--   a tenant looked like yesterday, so there is nothing to compare today
--   against. tenant_workspace_history covers the legacy blob and only the blob;
--   the canonical tables (employment_case, document, task, payroll_entry,
--   workspace_file) have no history at all, and a census row is the cheapest
--   thing that gives them one. It is a measurement, not a copy: counts and byte
--   sizes only, never a payload, never a storage key, never a name.
--
--   `caredesk_tenant_data_census()` is the reading. It must cross tenants -
--   scanning one tenant at a time cannot see a tenant whose rows have all gone -
--   and `caredesk_app` deliberately cannot: policy `tenant_current_reference`
--   (0015) scopes even `select on tenant` to the current `app.tenant_id`. So the
--   scan is a narrow SECURITY DEFINER function in the same style as
--   `resolve_caredesk_actor` (0010): it elevates for exactly one question and
--   returns exactly numbers. There is no argument to inject and no column
--   through which customer content can leave.
--
-- The workspace signal is measured on the ciphertext on purpose. Payload bytes
-- collapsing from 17KB to a few hundred is the empty-string incident, and
-- AES-256-GCM preserves plaintext length, so the size signal needs no key. That
-- matters twice: the detector keeps working if WORKSPACE_ENCRYPTION_KEY is lost
-- (DR-13), and a nightly job never has to hold the key to do its job. The
-- application layer adds a decrypted populated-entry count on top, and a
-- decryption failure there is itself the signal that the key no longer fits.
--
-- Additive: no column dropped, no row deleted, no existing value rewritten.

create table tenant_data_census (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  observed_at timestamptz not null default now(),
  -- Null when tenant_workspace holds no row for this tenant at all. That is a
  -- distinct state from "holds an empty one" and the two must not collapse.
  workspace_version integer check (workspace_version is null or workspace_version > 0),
  workspace_payload_bytes bigint check (workspace_payload_bytes is null or workspace_payload_bytes >= 0),
  -- Written by the application after decryption. Null means "not readable
  -- under the current key", which is a finding, not a missing measurement.
  workspace_populated_entries integer check (workspace_populated_entries is null or workspace_populated_entries >= 0),
  workspace_history_versions integer not null default 0 check (workspace_history_versions >= 0),
  workspace_file_rows integer not null default 0 check (workspace_file_rows >= 0),
  document_rows integer not null default 0 check (document_rows >= 0),
  task_rows integer not null default 0 check (task_rows >= 0),
  employment_case_rows integer not null default 0 check (employment_case_rows >= 0),
  payroll_entry_rows integer not null default 0 check (payroll_entry_rows >= 0)
);

-- The only query this table serves: the previous observation for one tenant.
create index tenant_data_census_tenant_recent
  on tenant_data_census (tenant_id, observed_at desc);

alter table tenant_data_census enable row level security;
alter table tenant_data_census force row level security;

create policy tenant_data_census_isolation on tenant_data_census
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Same shape as tenant_workspace_history (0035): the evidence of what was
-- there yesterday must not be rewritable by the code that might have destroyed
-- it. Pruning is an operator action through the owner role.
grant select, insert on tenant_data_census to caredesk_app;

create or replace function caredesk_tenant_data_census()
returns table (
  tenant_id uuid,
  workspace_version integer,
  workspace_payload_bytes bigint,
  workspace_history_versions integer,
  workspace_file_rows integer,
  document_rows integer,
  task_rows integer,
  employment_case_rows integer,
  payroll_entry_rows integer
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    t.id,
    w.version,
    -- octet_length over the rendered jsonb, not over the ciphertext field
    -- alone, so a plaintext row left over from before encryption is measured
    -- on the same scale as an encrypted one.
    octet_length(w.payload::text)::bigint,
    (select count(*) from public.tenant_workspace_history h where h.tenant_id = t.id)::integer,
    (select count(*) from public.workspace_file f where f.tenant_id = t.id)::integer,
    (select count(*) from public.document d where d.tenant_id = t.id)::integer,
    (select count(*) from public.task k where k.tenant_id = t.id)::integer,
    (select count(*) from public.employment_case c where c.tenant_id = t.id)::integer,
    (select count(*) from public.payroll_entry p where p.tenant_id = t.id)::integer
  from public.tenant t
  -- A left join, because a tenant whose workspace row has vanished is the most
  -- important row this function can return. An inner join would hide it.
  left join public.tenant_workspace w on w.tenant_id = t.id
  where t.status <> 'closed'
  order by t.id
$$;

-- Postgres grants EXECUTE on a new function to PUBLIC by default, which on
-- Supabase means the browser-facing anon and authenticated roles. A
-- SECURITY DEFINER function that reads across every tenant must never be one
-- of those. Same reason as 0035 and 0037.
revoke all privileges on function caredesk_tenant_data_census() from public;
grant execute on function caredesk_tenant_data_census() to caredesk_app;

insert into schema_migrations (version) values ('0038_silent_data_loss_detection');
