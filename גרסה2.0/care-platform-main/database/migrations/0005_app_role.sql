-- Creates the least-privilege application role (Constitution §18, ADR-002).
--
-- Why this exists: the live RLS check proved that FORCE ROW LEVEL SECURITY
-- (migration 0004) is still not enough when the connecting role carries the
-- BYPASSRLS attribute. Supabase's `postgres` role has rolbypassrls = true, so
-- every policy was silently skipped. Enforcement only becomes real once the
-- application stops acting as an administrative role.
--
-- `caredesk_app` is NOLOGIN on purpose: application code connects with the
-- existing credentials and then issues `SET LOCAL ROLE caredesk_app` inside
-- the same transaction as the tenant context (see packages/db/src/pool.ts).
-- Because both are transaction-local, a pooled connection can never leak
-- either the role or the tenant to the next borrower.
--
-- Production hardening (tracked, not done here): provision caredesk_app with
-- LOGIN and its own managed-secret password, and connect as it directly so
-- no administrative credential is present in the application at all.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'caredesk_app') then
    create role caredesk_app nologin;
  end if;
end
$$;

-- The role must never be able to bypass the policies it exists to obey.
alter role caredesk_app nobypassrls;

-- Allow the owning role to assume caredesk_app via SET ROLE.
-- Written as an explicit grant inside a DO block rather than
-- `grant caredesk_app to current_user`: the literal `current_user` form makes
-- Supabase's Supavisor pooler drop the connection mid-statement.
do $$
begin
  execute format('grant caredesk_app to %I', current_user);
end
$$;

grant usage on schema public to caredesk_app;

grant select, insert, update, delete on
  family_account,
  tenant_membership,
  permission_grant,
  care_recipient,
  employer,
  caregiver,
  employment_case
to caredesk_app;

-- Tenant is global reference data: readable, not writable by the app role.
grant select on tenant to caredesk_app;

insert into schema_migrations (version) values ('0005_app_role');
