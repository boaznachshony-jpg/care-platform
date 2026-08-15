-- Durable review/confirmation evidence only. Raw OCR, prompts, document content,
-- and provider responses are deliberately excluded.
create table document_intake_review (
  tenant_id uuid not null,
  id uuid not null default gen_random_uuid(),
  employment_case_id uuid not null,
  document_id uuid not null,
  document_version_id uuid not null,
  classification text not null,
  review_state text not null check (review_state in ('ai_suggested','validated','user_confirmed','cancelled')),
  confirmed_fields jsonb not null default '{}'::jsonb,
  provider_name text,
  provider_request_id text,
  confirmed_by uuid,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  constraint intake_case_same_tenant foreign key (tenant_id, employment_case_id) references employment_case (tenant_id, id),
  constraint intake_document_same_tenant foreign key (tenant_id, document_id) references document (tenant_id, id),
  constraint intake_version_same_tenant foreign key (tenant_id, document_version_id) references document_version (tenant_id, id),
  constraint intake_confirmation_consistent check ((review_state = 'user_confirmed') = (confirmed_at is not null and confirmed_by is not null))
);

create table event_action_plan (
  tenant_id uuid not null,
  id uuid not null default gen_random_uuid(),
  employment_case_id uuid not null,
  event_type text not null,
  event_date date,
  status text not null check (status in ('confirmed','cancelled')),
  answers jsonb not null,
  committed_items jsonb not null default '[]'::jsonb,
  idempotency_key text not null,
  confirmed_by uuid,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, idempotency_key),
  constraint event_plan_case_same_tenant foreign key (tenant_id, employment_case_id) references employment_case (tenant_id, id)
);

alter table document_intake_review enable row level security;
alter table document_intake_review force row level security;
create policy document_intake_review_tenant_isolation on document_intake_review
  using (tenant_id = app.current_tenant_id()) with check (tenant_id = app.current_tenant_id());
alter table event_action_plan enable row level security;
alter table event_action_plan force row level security;
create policy event_action_plan_tenant_isolation on event_action_plan
  using (tenant_id = app.current_tenant_id()) with check (tenant_id = app.current_tenant_id());
grant select, insert, update on document_intake_review to caredesk_app;
grant select, insert on event_action_plan to caredesk_app;
