-- Wave 3 durable close receipt. Payroll calculations remain in their existing
-- canonical store; projections (score, analytics and forecast) are not stored.
create table payroll_month_close (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  employment_case_id uuid not null,
  payroll_reference text not null check (length(trim(payroll_reference)) between 1 and 200),
  payroll_month date not null check (payroll_month = date_trunc('month', payroll_month)::date),
  payment_date date not null,
  payment_method text not null check (payment_method in ('bank_transfer', 'cash', 'check', 'other')),
  evidence_document_id uuid,
  timeline_event_id uuid not null,
  audit_event_id uuid not null,
  closed_by uuid not null,
  closed_at timestamptz not null,
  worker_acknowledgement text not null default 'not_supported'
    check (worker_acknowledgement in ('not_supported', 'pending')),
  correlation_id text not null check (length(trim(correlation_id)) between 1 and 200),
  created_at timestamptz not null default now(),
  constraint payroll_month_close_tenant_unique unique (tenant_id, id),
  constraint payroll_month_close_case_month_unique unique (tenant_id, employment_case_id, payroll_month),
  constraint payroll_month_close_case_same_tenant foreign key (tenant_id, employment_case_id)
    references employment_case (tenant_id, id),
  constraint payroll_month_close_document_same_tenant foreign key (tenant_id, evidence_document_id)
    references document (tenant_id, id),
  constraint payroll_month_close_timeline_same_tenant foreign key (tenant_id, timeline_event_id)
    references timeline_event (tenant_id, id)
);

create index payroll_month_close_by_case on payroll_month_close
  (tenant_id, employment_case_id, payroll_month desc);
alter table payroll_month_close enable row level security;
alter table payroll_month_close force row level security;
create policy payroll_month_close_tenant_isolation on payroll_month_close
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);
-- Receipts are append-only. Corrections require new audited evidence; reopening
-- is deliberately unsupported until governance defines it.
grant select, insert on payroll_month_close to caredesk_app;
insert into schema_migrations (version) values ('0023_monthly_payroll_close');
