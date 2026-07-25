-- Fixes two real RLS defects found by the live isolation check (db:rls-test)
-- against the Supabase database on 2026-07-25:
--
-- 1. ENABLE ROW LEVEL SECURITY does not apply to the table OWNER (or a
--    superuser). Connecting as `postgres` — the owner — bypassed every policy
--    added in 0002/0003, so tenant A could SELECT, UPDATE and DELETE tenant
--    B's rows. FORCE ROW LEVEL SECURITY closes that hole even when the
--    application connects as the owning role.
--
-- 2. The original policies declared only USING, which governs which existing
--    rows are visible/mutable. Without WITH CHECK, an INSERT (or an UPDATE
--    that rewrites tenant_id) could still write a row belonging to another
--    tenant. Each policy is recreated with both clauses.
--
-- ADR-002 calls RLS the backstop behind application-level filtering; before
-- this migration that backstop did not exist in practice.

alter table family_account force row level security;
alter table tenant_membership force row level security;
alter table permission_grant force row level security;
alter table care_recipient force row level security;
alter table employer force row level security;
alter table caregiver force row level security;
alter table employment_case force row level security;

drop policy if exists family_account_tenant_isolation on family_account;
drop policy if exists tenant_membership_tenant_isolation on tenant_membership;
drop policy if exists permission_grant_tenant_isolation on permission_grant;
drop policy if exists care_recipient_tenant_isolation on care_recipient;
drop policy if exists employer_tenant_isolation on employer;
drop policy if exists caregiver_tenant_isolation on caregiver;
drop policy if exists employment_case_tenant_isolation on employment_case;

create policy family_account_tenant_isolation on family_account
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

create policy tenant_membership_tenant_isolation on tenant_membership
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

create policy permission_grant_tenant_isolation on permission_grant
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

create policy care_recipient_tenant_isolation on care_recipient
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

create policy employer_tenant_isolation on employer
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

create policy caregiver_tenant_isolation on caregiver
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

create policy employment_case_tenant_isolation on employment_case
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

insert into schema_migrations (version) values ('0004_force_rls_and_with_check');
