-- Completion Wave durable facts. Derived scores and assistant responses are intentionally absent.
create table professional_review_request (
  tenant_id uuid not null,
  id uuid not null default gen_random_uuid(),
  employment_case_id uuid not null,
  created_by uuid not null,
  category text not null check (category in ('payroll','employment','visa_authorization','document','termination','general')),
  reason text not null check (char_length(reason) between 3 and 500),
  summary text not null check (char_length(summary) between 3 and 1000),
  source text not null check (source in ('case_ai','event_wizard','regulation_engine','caredesk_score','manual')),
  related_entity_type text,
  related_entity_id uuid,
  status text not null default 'open' check (status in ('draft','open','in_review','resolved','cancelled')),
  assigned_to uuid,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  primary key (tenant_id, id),
  unique (tenant_id, idempotency_key),
  constraint review_case_same_tenant foreign key (tenant_id, employment_case_id)
    references employment_case (tenant_id, id),
  constraint review_resolution_consistent check ((status = 'resolved') = (resolved_at is not null))
);

create table ai_action_confirmation (
  tenant_id uuid not null,
  id uuid not null default gen_random_uuid(),
  employment_case_id uuid not null,
  confirmed_by uuid not null,
  action_type text not null check (action_type in ('create_task','create_checklist','request_professional_review')),
  item_count integer not null check (item_count between 1 and 25),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, idempotency_key),
  constraint ai_confirmation_case_same_tenant foreign key (tenant_id, employment_case_id)
    references employment_case (tenant_id, id)
);

alter table professional_review_request enable row level security;
alter table professional_review_request force row level security;
create policy professional_review_request_tenant_isolation on professional_review_request
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);
alter table ai_action_confirmation enable row level security;
alter table ai_action_confirmation force row level security;
create policy ai_action_confirmation_tenant_isolation on ai_action_confirmation
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

grant select, insert, update on professional_review_request to caredesk_app;
grant select, insert on ai_action_confirmation to caredesk_app;
