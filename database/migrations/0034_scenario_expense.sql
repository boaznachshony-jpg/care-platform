-- Planning-only Future Cost scenario/employment expenses. These rows feed the
-- 12-month projection as a FORECAST layer; they never assert that a payment
-- happened and never modify canonical payroll records.
create table scenario_expense (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  employment_case_id uuid not null,
  label text not null check (length(trim(label)) between 1 and 120),
  amount numeric(12,2) not null check (amount between 0 and 10000000),
  kind text not null check (kind in ('recurring','one_time')),
  start_month date not null check (start_month = date_trunc('month', start_month)::date),
  end_month date check (end_month = date_trunc('month', end_month)::date),
  status text not null default 'active' check (status in ('active','deleted')),
  version integer not null default 1 check (version > 0),
  created_by uuid not null,
  updated_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scenario_expense_window check (end_month is null or end_month >= start_month),
  constraint scenario_expense_one_time_has_no_window check (kind = 'recurring' or end_month is null),
  constraint scenario_expense_tenant_unique unique (tenant_id, id),
  constraint scenario_expense_case_same_tenant foreign key (tenant_id, employment_case_id)
    references employment_case (tenant_id, id)
);
create index scenario_expense_by_case on scenario_expense (tenant_id, employment_case_id, start_month desc);
alter table scenario_expense enable row level security;
alter table scenario_expense force row level security;
create policy scenario_expense_tenant_isolation on scenario_expense
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);
-- No delete grant: removal is a soft status change so planning history stays auditable.
grant select, insert, update on scenario_expense to caredesk_app;
insert into schema_migrations (version) values ('0034_scenario_expense');
