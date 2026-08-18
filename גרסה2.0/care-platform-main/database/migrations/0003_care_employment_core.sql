-- Care/employment core (Database Blueprint §4.2, migration order §10 step 2).
-- Milestone 1 fields only — sensitive credentials (passport numbers, bank
-- details) are NOT columns here yet; they arrive with the encrypted-field
-- design in the Documents/sensitive-data work, per blueprint §4.2's
-- "protected fields or separate encrypted records" rule.

create table care_recipient (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  full_name text not null,
  care_level text,
  city text,
  sensitivity text not null default 'care_sensitive',
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1
);

create table employer (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  full_name text not null,
  relationship_to_recipient text not null,
  city text,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1
);

create table caregiver (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  legal_name text not null,
  preferred_name text,
  nationality text not null,
  primary_language text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1
);

create table employment_case (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  care_recipient_id uuid not null references care_recipient (id),
  employer_id uuid not null references employer (id),
  caregiver_id uuid not null references caregiver (id),
  start_date date not null,
  end_date date,
  status text not null default 'draft'
    check (status in ('draft', 'active', 'suspended', 'ended', 'cancelled', 'archived')),
  closure_reason text,
  primary_manager_membership_id uuid references tenant_membership (id),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  check (end_date is null or end_date >= start_date)
);

-- Blueprint §4.2 invariant: referenced parties belong to the same tenant.
-- Composite FKs enforce it at the database layer (ADR-002: "compound foreign
-- keys or database checks must prevent cross-tenant references").
alter table care_recipient add constraint care_recipient_tenant_unique unique (tenant_id, id);
alter table employer add constraint employer_tenant_unique unique (tenant_id, id);
alter table caregiver add constraint caregiver_tenant_unique unique (tenant_id, id);

alter table employment_case
  add constraint employment_case_recipient_same_tenant
    foreign key (tenant_id, care_recipient_id) references care_recipient (tenant_id, id),
  add constraint employment_case_employer_same_tenant
    foreign key (tenant_id, employer_id) references employer (tenant_id, id),
  add constraint employment_case_caregiver_same_tenant
    foreign key (tenant_id, caregiver_id) references caregiver (tenant_id, id);

-- Blueprint §4.2 invariant: one non-terminal case per recipient/caregiver pair.
create unique index employment_case_active_pair_unique
  on employment_case (tenant_id, care_recipient_id, caregiver_id)
  where status in ('draft', 'active', 'suspended');

-- Blueprint §8 indexing guidance.
create index care_recipient_by_tenant on care_recipient (tenant_id, id);
create index employer_by_tenant on employer (tenant_id, id);
create index caregiver_by_tenant on caregiver (tenant_id, id);
create index employment_case_by_tenant_status on employment_case (tenant_id, status);

-- RLS backstop (same pattern as 0002).
alter table care_recipient enable row level security;
alter table employer enable row level security;
alter table caregiver enable row level security;
alter table employment_case enable row level security;

create policy care_recipient_tenant_isolation on care_recipient
  using (tenant_id = current_setting('app.tenant_id', true)::uuid);
create policy employer_tenant_isolation on employer
  using (tenant_id = current_setting('app.tenant_id', true)::uuid);
create policy caregiver_tenant_isolation on caregiver
  using (tenant_id = current_setting('app.tenant_id', true)::uuid);
create policy employment_case_tenant_isolation on employment_case
  using (tenant_id = current_setting('app.tenant_id', true)::uuid);

insert into schema_migrations (version) values ('0003_care_employment_core');
