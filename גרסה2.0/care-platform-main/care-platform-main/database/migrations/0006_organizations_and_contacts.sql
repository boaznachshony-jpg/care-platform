-- Organizations and contacts (Database Blueprint §4.4, migration order §10 step 3).
--
-- A Contact is a person in the case ecosystem and is NOT a system user
-- (Constitution §18: "a social worker contact does not receive access merely
-- because they are listed as a contact"). Nothing here grants any access —
-- access comes only from tenant_membership and permission_grant.

-- employment_case gained composite FKs *to* its parties in 0003 but never a
-- (tenant_id, id) key of its own, so nothing could reference it back. Added
-- here because case_contact_role is the first table that needs to.
alter table employment_case
  add constraint employment_case_tenant_unique unique (tenant_id, id);

create table organization (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  name text not null,
  organization_type text not null
    check (organization_type in (
      'nursing_office', 'licensed_bureau', 'insurer', 'payroll_office',
      'legal_office', 'public_authority', 'independent_professional', 'other'
    )),
  phone text,
  email text,
  emergency_channel text,
  service_hours text,
  status text not null default 'active'
    check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1
);

create table contact (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  organization_id uuid,
  full_name text not null,
  title text,
  languages text,
  preferred_channel text
    check (preferred_channel is null or preferred_channel in
      ('phone', 'email', 'whatsapp', 'office', 'portal')),
  availability text,
  status text not null default 'active'
    check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1
);

-- Typed contact channels. `is_sensitive` drives masking in list projections
-- (Constitution §16: mask sensitive values by default).
create table contact_channel (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  contact_id uuid not null,
  channel_type text not null
    check (channel_type in ('phone', 'email', 'whatsapp', 'office', 'portal')),
  value text not null,
  is_sensitive boolean not null default false,
  verification_status text not null default 'unverified'
    check (verification_status in ('unverified', 'verified', 'invalid')),
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

-- One contact may hold several roles on a case; each is separately
-- time-bounded (blueprint §4.4).
create table case_contact_role (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  employment_case_id uuid not null,
  contact_id uuid not null,
  role_type text not null,
  responsibility_domains text,
  is_primary boolean not null default false,
  is_backup boolean not null default false,
  is_emergency boolean not null default false,
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  status text not null default 'active'
    check (status in ('active', 'ended')),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1
);

-- Same-tenant composite foreign keys (ADR-002: cross-tenant references must be
-- impossible at the database layer, not merely unlikely).
alter table organization add constraint organization_tenant_unique unique (tenant_id, id);
alter table contact add constraint contact_tenant_unique unique (tenant_id, id);

alter table contact
  add constraint contact_organization_same_tenant
    foreign key (tenant_id, organization_id) references organization (tenant_id, id);

alter table contact_channel
  add constraint contact_channel_contact_same_tenant
    foreign key (tenant_id, contact_id) references contact (tenant_id, id);

alter table case_contact_role
  add constraint case_contact_role_case_same_tenant
    foreign key (tenant_id, employment_case_id) references employment_case (tenant_id, id),
  add constraint case_contact_role_contact_same_tenant
    foreign key (tenant_id, contact_id) references contact (tenant_id, id);

-- At most one active primary holder per (case, role_type).
create unique index case_contact_role_single_primary
  on case_contact_role (tenant_id, employment_case_id, role_type)
  where is_primary and status = 'active';

create index organization_by_tenant on organization (tenant_id, id);
create index contact_by_tenant on contact (tenant_id, id);
create index contact_channel_by_contact on contact_channel (tenant_id, contact_id);
create index case_contact_role_by_case on case_contact_role (tenant_id, employment_case_id, status);

alter table organization enable row level security;
alter table contact enable row level security;
alter table contact_channel enable row level security;
alter table case_contact_role enable row level security;

alter table organization force row level security;
alter table contact force row level security;
alter table contact_channel force row level security;
alter table case_contact_role force row level security;

create policy organization_tenant_isolation on organization
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

create policy contact_tenant_isolation on contact
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

create policy contact_channel_tenant_isolation on contact_channel
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

create policy case_contact_role_tenant_isolation on case_contact_role
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

grant select, insert, update, delete on
  organization, contact, contact_channel, case_contact_role
to caredesk_app;

insert into schema_migrations (version) values ('0006_organizations_and_contacts');
