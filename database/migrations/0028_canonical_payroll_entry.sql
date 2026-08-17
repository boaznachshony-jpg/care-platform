-- User-entered payroll facts. This table stores inputs and totals; it does not
-- assert that any calculation is legally correct.
create table payroll_entry (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  employment_case_id uuid not null,
  payroll_month date not null check (payroll_month = date_trunc('month', payroll_month)::date),
  base_salary numeric(12,2) not null check (base_salary between 0 and 10000000),
  work_days numeric(5,2) not null default 0 check (work_days between 0 and 31),
  paid_rest_days numeric(5,2) not null default 0 check (paid_rest_days between 0 and 6),
  rest_day_rate numeric(12,2) not null default 0 check (rest_day_rate between 0 and 10000000),
  paid_holidays numeric(5,2) not null default 0 check (paid_holidays between 0 and 10),
  holiday_pay numeric(12,2) not null default 0 check (holiday_pay between 0 and 10000000),
  vacation_days numeric(5,2) not null default 0 check (vacation_days between 0 and 31),
  vacation_pay numeric(12,2) not null default 0 check (vacation_pay between 0 and 10000000),
  sick_days numeric(5,2) not null default 0 check (sick_days between 0 and 31),
  sick_pay numeric(12,2) not null default 0 check (sick_pay between 0 and 10000000),
  other_absence_days numeric(5,2) not null default 0 check (other_absence_days between 0 and 31),
  employer_contributions numeric(12,2) not null default 0 check (employer_contributions between 0 and 10000000),
  additional_payments jsonb not null default '[]'::jsonb check (jsonb_typeof(additional_payments) = 'array'),
  pocket_money numeric(12,2) not null default 0 check (pocket_money between 0 and 10000000),
  deductions numeric(12,2) not null default 0 check (deductions between 0 and 10000000),
  advances numeric(12,2) not null default 0 check (advances between 0 and 10000000),
  agreed_deductions numeric(12,2) not null default 0 check (agreed_deductions between 0 and 10000000),
  total numeric(12,2) not null check (total between -10000000 and 10000000),
  status text not null default 'draft' check (status in ('draft','final')),
  version integer not null default 1 check (version > 0),
  created_by uuid not null,
  updated_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payroll_entry_tenant_unique unique (tenant_id, id),
  constraint payroll_entry_case_month_unique unique (tenant_id, employment_case_id, payroll_month),
  constraint payroll_entry_case_same_tenant foreign key (tenant_id, employment_case_id)
    references employment_case (tenant_id, id)
);
create index payroll_entry_by_case on payroll_entry (tenant_id, employment_case_id, payroll_month desc);
alter table payroll_entry enable row level security;
alter table payroll_entry force row level security;
create policy payroll_entry_tenant_isolation on payroll_entry
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);
grant select, insert, update on payroll_entry to caredesk_app;
insert into schema_migrations (version) values ('0028_canonical_payroll_entry');
