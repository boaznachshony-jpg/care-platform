-- R5-09, stage 1: a canonical home for the National Insurance report lines.
--
-- Design approved by the owner on 17.10.2026:
-- docs/governance/R5-09-NATIONAL-INSURANCE-REPORT-TABLE.md. This migration is
-- the whole of stage 1's schema change. It is additive: it creates two tables
-- and touches no existing one, so it is safe to apply under the code that is
-- already deployed.
--
-- WHY TWO TABLES
-- --------------
-- The payroll screen reports National Insurance one wage month per line, in
-- the shape of the Institute's own form. Today those lines live with the
-- payment inside the workspace snapshot (ADR-006 amendment 1). A family can
-- hold two payments that cover the same month - the one created from payroll
-- and one entered by hand - so "one row per month" would force the copy in
-- stage 2 to choose between them, i.e. to drop one. A report row per payment,
-- with its lines under it, keeps both exactly as they were saved.
--
-- WHAT IS DELIBERATELY ABSENT
-- ---------------------------
-- No DELETE grant on either table, the 0046/0037 default: a report that was
-- filed is corrected, never removed, and every correction is an audit_event.
-- No timeline rows and no payment fields (amount due, paid/unpaid): the
-- payment itself stays in the workspace until periodic expenses get their
-- own canonical home, which is a separate item.

create table national_insurance_report (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  employment_case_id uuid not null,
  -- First and last wage month the report covers (always the 1st of a month).
  period_start date not null check (extract(day from period_start) = 1),
  period_end date not null check (extract(day from period_end) = 1),
  due_date date not null,
  -- The workspace payment (MvpEmploymentExpense.id) this report was copied
  -- from. Written once, never updated; unique per case, which is what makes a
  -- repeated copy return the existing report instead of creating a second one.
  legacy_expense_id text check (legacy_expense_id is null or length(legacy_expense_id) between 1 and 200),
  sensitivity text not null default 'financial_sensitive'
    check (sensitivity = 'financial_sensitive'),
  created_at timestamptz not null default now(),
  created_by uuid not null,
  updated_at timestamptz not null default now(),
  updated_by uuid not null,
  version integer not null default 1 check (version > 0),
  constraint national_insurance_report_period_order check (period_start <= period_end),
  constraint national_insurance_report_tenant_unique unique (tenant_id, id),
  -- Composite FK: a report can only ever point at a case in its own tenant.
  constraint national_insurance_report_case_same_tenant foreign key (tenant_id, employment_case_id)
    references employment_case (tenant_id, id)
);

create unique index national_insurance_report_legacy_expense_unique
  on national_insurance_report (tenant_id, employment_case_id, legacy_expense_id)
  where legacy_expense_id is not null;

create index national_insurance_report_by_case
  on national_insurance_report (tenant_id, employment_case_id, period_start desc);

alter table national_insurance_report enable row level security;
alter table national_insurance_report force row level security;
create policy national_insurance_report_tenant_isolation on national_insurance_report
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Deliberately no delete grant - see the note at the top.
grant select, insert, update on national_insurance_report to caredesk_app;

create table national_insurance_report_month (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  report_id uuid not null,
  month date not null check (extract(day from month) = 1),
  employed boolean not null,
  -- Whole shekels: the Institute's form is "ללא אגורות".
  wage integer not null check (wage between 0 and 10000000),
  rate_percent numeric(5, 2) not null check (rate_percent between 0 and 100),
  -- wage x rate, to the agora (packages/domain percentOfAgorot); the service
  -- recomputes it and refuses a line that does not match.
  amount numeric(12, 2) not null check (amount between 0 and 10000000),
  created_at timestamptz not null default now(),
  created_by uuid not null,
  updated_at timestamptz not null default now(),
  updated_by uuid not null,
  version integer not null default 1 check (version > 0),
  -- A month the caregiver was not employed carries nothing - exactly what the
  -- payroll screen produces for it.
  constraint national_insurance_report_month_not_employed_is_zero
    check (employed or (wage = 0 and amount = 0)),
  constraint national_insurance_report_month_one_line_per_month unique (report_id, month),
  -- Composite FK: a line can only ever belong to a report in its own tenant.
  constraint national_insurance_report_month_report_same_tenant foreign key (tenant_id, report_id)
    references national_insurance_report (tenant_id, id)
);

create index national_insurance_report_month_by_report
  on national_insurance_report_month (tenant_id, report_id, month);

alter table national_insurance_report_month enable row level security;
alter table national_insurance_report_month force row level security;
create policy national_insurance_report_month_tenant_isolation on national_insurance_report_month
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Deliberately no delete grant - see the note at the top.
grant select, insert, update on national_insurance_report_month to caredesk_app;

insert into schema_migrations (version) values ('0049_national_insurance_report');
