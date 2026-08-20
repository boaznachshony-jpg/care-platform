-- Evidence-bearing automation execution (gap C: "Evidence-bearing automation
-- execution"). One durable tenant-scoped receipt covers the Action AI
-- checklist confirmation (previously process-memory only) and the Event
-- Wizard plan commit through the canonical Task/Timeline/Audit services.
--
-- Concurrency contract: the executing request claims the receipt row first
-- (insert), so a concurrent duplicate resolves on the unique
-- (tenant_id, operation, idempotency_key) constraint instead of executing the
-- plan twice. `update` is granted only to move a claim to its terminal
-- completed/failed state; completed receipts are immutable evidence and
-- delete is never granted (same append-only stance as payroll_month_close).
create table automation_execution_receipt (
  tenant_id uuid not null references tenant (id),
  id uuid not null default gen_random_uuid(),
  operation text not null
    check (operation in ('checklist_confirmation', 'event_plan_commit')),
  idempotency_key text not null
    check (length(trim(idempotency_key)) between 8 and 200),
  employment_case_id uuid not null,
  request_hash text not null check (length(request_hash) between 16 and 128),
  status text not null default 'in_progress'
    check (status in ('in_progress', 'completed', 'failed')),
  response jsonb,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (tenant_id, id),
  constraint automation_receipt_operation_key_unique
    unique (tenant_id, operation, idempotency_key),
  constraint automation_receipt_completion_consistent
    check ((status = 'completed') = (response is not null and completed_at is not null)),
  constraint automation_receipt_case_same_tenant foreign key
    (tenant_id, employment_case_id) references employment_case (tenant_id, id)
);

create index automation_execution_receipt_by_case on automation_execution_receipt
  (tenant_id, employment_case_id, created_at desc);

alter table automation_execution_receipt enable row level security;
alter table automation_execution_receipt force row level security;
create policy automation_execution_receipt_tenant_isolation on automation_execution_receipt
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);
grant select, insert, update on automation_execution_receipt to caredesk_app;

insert into schema_migrations (version) values ('0029_automation_execution_receipt');
