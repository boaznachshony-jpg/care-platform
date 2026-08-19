-- Governed leave ledger: manager-recorded caregiver leave facts (annual /
-- sick / holiday) with an explicit date range. This table stores recorded
-- facts only; it never invents an entitlement balance — a balance may only be
-- derived later by an approved rule (projectSharedLeave keeps returning null
-- until such a rule exists).
create table leave_entry (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  employment_case_id uuid not null,
  caregiver_id uuid not null,
  entry_type text not null check (entry_type in ('annual','sick','holiday')),
  start_date date not null,
  end_date date not null,
  days numeric(5,2) not null check (days > 0 and days <= 366),
  -- Ledger rows are never hard-deleted: a mistaken row is cancelled, keeping
  -- the evidence trail intact (the payroll_entry convention).
  status text not null default 'recorded' check (status in ('recorded','cancelled')),
  note text check (note is null or char_length(note) <= 500),
  version integer not null default 1 check (version > 0),
  created_by uuid not null,
  updated_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leave_entry_valid_range check (start_date <= end_date),
  constraint leave_entry_tenant_unique unique (tenant_id, id),
  constraint leave_entry_case_same_tenant foreign key (tenant_id, employment_case_id)
    references employment_case (tenant_id, id),
  constraint leave_entry_caregiver_same_tenant foreign key (tenant_id, caregiver_id)
    references caregiver (tenant_id, id)
);
create index leave_entry_by_case on leave_entry (tenant_id, employment_case_id, start_date desc);
alter table leave_entry enable row level security;
alter table leave_entry force row level security;
create policy leave_entry_tenant_isolation on leave_entry
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);
grant select, insert, update on leave_entry to caredesk_app;
insert into schema_migrations (version) values ('0033_governed_leave_ledger');
