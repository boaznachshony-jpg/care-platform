-- Identity and tenancy (Database Blueprint §4.1, migration order §10 step 1).
-- ADR-002 accepted for development scope 2026-07-23.
--
-- Tenant context: application sets `app.tenant_id` per connection/transaction
-- (SELECT set_config('app.tenant_id', $1, true)). When Supabase Auth (ADR-001)
-- is wired, policies will be re-derived from JWT claims; the shape stays the
-- same. RLS here is the backstop — the application layer always filters too.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Tenant: the technical isolation boundary. Not tenant-owned itself.
-- ---------------------------------------------------------------------------
create table tenant (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'active'
    check (status in ('active', 'suspended', 'closed')),
  timezone text not null default 'Asia/Jerusalem',
  default_locale text not null default 'he',
  data_region text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- FamilyAccount: household/business profile, one-to-one with Tenant.
-- ---------------------------------------------------------------------------
create table family_account (
  tenant_id uuid primary key references tenant (id),
  display_name text not null,
  account_type text not null default 'family',
  primary_contact_membership_id uuid,
  lifecycle_status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

-- ---------------------------------------------------------------------------
-- User: global authenticated person (blueprint "User"; table name app_user
-- because `user` is reserved in SQL). No credentials stored here — identity
-- lives at the auth provider (ADR-001).
-- ---------------------------------------------------------------------------
create table app_user (
  id uuid primary key default gen_random_uuid(),
  auth_subject text not null unique,
  display_name text not null,
  email text not null unique,
  phone text,
  preferred_locale text not null default 'he',
  status text not null default 'active'
    check (status in ('active', 'invited', 'disabled')),
  last_authenticated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

-- ---------------------------------------------------------------------------
-- TenantMembership: the only path from a User to a Tenant's data.
-- ---------------------------------------------------------------------------
create table tenant_membership (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  user_id uuid not null references app_user (id),
  role text not null,
  status text not null default 'active'
    check (status in ('active', 'revoked')),
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  mfa_required boolean not null default false,
  invited_by uuid references app_user (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

-- Unique ACTIVE membership per (tenant, user); revoked history rows allowed.
create unique index tenant_membership_active_unique
  on tenant_membership (tenant_id, user_id)
  where status = 'active';

create index tenant_membership_by_tenant on tenant_membership (tenant_id, id);
create index tenant_membership_by_user on tenant_membership (user_id);

-- ---------------------------------------------------------------------------
-- PermissionGrant: explicit narrowing / time-bounded access (blueprint §4.1).
-- ---------------------------------------------------------------------------
create table permission_grant (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  membership_id uuid not null references tenant_membership (id),
  case_id uuid,
  resource_type text not null,
  resource_id uuid,
  permission text not null,
  sensitivity_ceiling text not null default 'general'
    check (sensitivity_ceiling in
      ('general', 'employment_sensitive', 'financial_sensitive',
       'identity_sensitive', 'care_sensitive')),
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  granted_by uuid not null references app_user (id),
  reason text not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

create index permission_grant_by_tenant on permission_grant (tenant_id, id);
create index permission_grant_by_membership on permission_grant (membership_id);

-- ---------------------------------------------------------------------------
-- Row Level Security — deny-by-default backstop (ADR-002).
-- app_user and tenant are global; tenant-owned tables are scoped.
-- ---------------------------------------------------------------------------
alter table family_account enable row level security;
alter table tenant_membership enable row level security;
alter table permission_grant enable row level security;

create policy family_account_tenant_isolation on family_account
  using (tenant_id = current_setting('app.tenant_id', true)::uuid);

create policy tenant_membership_tenant_isolation on tenant_membership
  using (tenant_id = current_setting('app.tenant_id', true)::uuid);

create policy permission_grant_tenant_isolation on permission_grant
  using (tenant_id = current_setting('app.tenant_id', true)::uuid);

insert into schema_migrations (version) values ('0002_identity_tenancy');
