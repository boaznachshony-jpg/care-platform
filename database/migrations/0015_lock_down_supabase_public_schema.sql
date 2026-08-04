-- Supabase grants anon/authenticated broad privileges on new objects in the
-- exposed `public` schema by default. CareDesk never reads business data
-- through PostgREST: the browser uses Supabase for identity only and the API
-- connects as the least-privilege caredesk_app role. Remove those implicit
-- grants and make the three global/control tables deny by default as well.

revoke all privileges on all tables in schema public from anon, authenticated;
revoke all privileges on all sequences in schema public from anon, authenticated;
revoke all privileges on all functions in schema public from public, anon, authenticated;

-- Prevent later migrations from silently reintroducing direct browser access.
alter default privileges for role postgres in schema public
  revoke all privileges on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all privileges on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

-- These tables are not tenant-owned in the same way as the business tables,
-- but they still sit in Supabase's exposed schema. FORCE keeps the invariant
-- explicit. The administrative migration role has BYPASSRLS; SECURITY DEFINER
-- functions continue to work, while untrusted roles have no policy at all.
alter table tenant enable row level security;
alter table tenant force row level security;
alter table app_user enable row level security;
alter table app_user force row level security;
alter table schema_migrations enable row level security;
alter table schema_migrations force row level security;

-- Runtime code needs read-only access to the current tenant reference row.
-- It cannot enumerate any other tenant and still cannot insert/update/delete.
drop policy if exists tenant_current_reference on tenant;
create policy tenant_current_reference on tenant
  for select
  to caredesk_app
  using (id = nullif(current_setting('app.tenant_id', true), '')::uuid);

insert into schema_migrations (version)
values ('0015_lock_down_supabase_public_schema');
