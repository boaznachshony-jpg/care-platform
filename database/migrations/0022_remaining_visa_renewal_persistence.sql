-- Minimal canonical persistence needed to finish the Wave 2 Visa Renewal
-- workflow. This migration stores workflow facts only; it does not encode
-- legal deadlines, validity decisions, or communication delivery.

-- These composite keys let the completion record prove that its task and
-- Timeline row belong to the same tenant.
alter table task add constraint task_tenant_unique unique (tenant_id, id);
alter table timeline_event
  add constraint timeline_event_tenant_unique unique (tenant_id, id);

-- An immutable record of a communication attempt. `outcome` and `purpose`
-- are bounded operational summaries and must not contain document contents or
-- identity numbers. MVP records the attempt; it does not send a message.
create table workflow_contact_activity (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  employment_case_id uuid not null,
  workflow_instance_id uuid not null,
  workflow_step_id uuid,
  organization_id uuid,
  contact_id uuid,
  channel text not null check
    (channel in ('phone', 'email', 'whatsapp', 'meeting', 'letter', 'sms', 'portal')),
  occurred_at timestamptz not null,
  purpose text not null check (length(trim(purpose)) between 1 and 240),
  outcome text not null check (length(trim(outcome)) between 1 and 1000),
  follow_up_at timestamptz,
  confirmation_status text not null default 'not_requested'
    check (confirmation_status in ('not_requested', 'pending', 'confirmed')),
  sensitivity text not null default 'employment_sensitive'
    check (sensitivity in ('general', 'employment_sensitive', 'identity_sensitive',
      'care_sensitive', 'financial_sensitive')),
  visibility text not null default 'case'
    check (visibility in ('tenant', 'case')),
  recorded_by uuid not null,
  created_at timestamptz not null default now(),
  constraint workflow_contact_activity_target_present
    check (organization_id is not null or contact_id is not null),
  constraint workflow_contact_activity_tenant_unique unique (tenant_id, id),
  constraint workflow_contact_activity_case_same_tenant foreign key
    (tenant_id, employment_case_id) references employment_case (tenant_id, id),
  constraint workflow_contact_activity_instance_same_tenant foreign key
    (tenant_id, workflow_instance_id) references workflow_instance (tenant_id, id),
  constraint workflow_contact_activity_step_same_tenant foreign key
    (tenant_id, workflow_step_id) references workflow_step (tenant_id, id),
  constraint workflow_contact_activity_organization_same_tenant foreign key
    (tenant_id, organization_id) references organization (tenant_id, id),
  constraint workflow_contact_activity_contact_same_tenant foreign key
    (tenant_id, contact_id) references contact (tenant_id, id)
);

-- The renewal relationship is history, not mutable state on the old
-- authorization. Both authorization rows and their validity dates remain
-- independently preserved.
create table employment_authorization_link (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  employment_case_id uuid not null,
  workflow_instance_id uuid not null,
  prior_authorization_id uuid not null,
  renewed_authorization_id uuid not null,
  document_version_id uuid not null,
  linked_by uuid not null,
  linked_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint employment_authorization_link_distinct
    check (prior_authorization_id <> renewed_authorization_id),
  constraint employment_authorization_link_tenant_unique unique (tenant_id, id),
  constraint employment_authorization_link_workflow_unique
    unique (tenant_id, workflow_instance_id),
  constraint employment_authorization_link_renewed_unique
    unique (tenant_id, renewed_authorization_id),
  constraint employment_authorization_link_case_same_tenant foreign key
    (tenant_id, employment_case_id) references employment_case (tenant_id, id),
  constraint employment_authorization_link_instance_same_tenant foreign key
    (tenant_id, workflow_instance_id) references workflow_instance (tenant_id, id),
  constraint employment_authorization_link_prior_same_tenant foreign key
    (tenant_id, prior_authorization_id) references employment_authorization (tenant_id, id),
  constraint employment_authorization_link_renewed_same_tenant foreign key
    (tenant_id, renewed_authorization_id) references employment_authorization (tenant_id, id),
  constraint employment_authorization_link_document_same_tenant foreign key
    (tenant_id, document_version_id) references document_version (tenant_id, id)
);

-- A generic review lifecycle records an observed overlap without deciding
-- whether it is legally acceptable. The resolution is a bounded code supplied
-- by the application after human review.
create table authorization_overlap_review (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  employment_case_id uuid not null,
  workflow_instance_id uuid not null,
  first_authorization_id uuid not null,
  second_authorization_id uuid not null,
  status text not null default 'pending'
    check (status in ('pending', 'in_review', 'resolved')),
  resolution_code text check
    (resolution_code is null or length(trim(resolution_code)) between 1 and 100),
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  constraint authorization_overlap_review_distinct
    check (first_authorization_id <> second_authorization_id),
  constraint authorization_overlap_review_resolution_consistent check (
    (status = 'resolved') =
      (resolution_code is not null and reviewed_by is not null and reviewed_at is not null)
  ),
  constraint authorization_overlap_review_tenant_unique unique (tenant_id, id),
  constraint authorization_overlap_review_pair_unique unique
    (tenant_id, workflow_instance_id, first_authorization_id, second_authorization_id),
  constraint authorization_overlap_review_case_same_tenant foreign key
    (tenant_id, employment_case_id) references employment_case (tenant_id, id),
  constraint authorization_overlap_review_instance_same_tenant foreign key
    (tenant_id, workflow_instance_id) references workflow_instance (tenant_id, id),
  constraint authorization_overlap_review_first_same_tenant foreign key
    (tenant_id, first_authorization_id) references employment_authorization (tenant_id, id),
  constraint authorization_overlap_review_second_same_tenant foreign key
    (tenant_id, second_authorization_id) references employment_authorization (tenant_id, id)
);

-- One immutable completion receipt names the exact task and Timeline/Audit
-- events written by the completion transaction. Audit remains intentionally
-- free of a tenant FK as documented by migration 0009.
create table workflow_completion (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  employment_case_id uuid not null,
  workflow_instance_id uuid not null,
  completed_task_id uuid not null,
  timeline_event_id uuid not null,
  audit_event_id uuid not null,
  completed_by uuid not null,
  completed_at timestamptz not null,
  correlation_id text not null check (length(trim(correlation_id)) between 1 and 200),
  created_at timestamptz not null default now(),
  constraint workflow_completion_tenant_unique unique (tenant_id, id),
  constraint workflow_completion_instance_unique unique (tenant_id, workflow_instance_id),
  constraint workflow_completion_task_unique unique (tenant_id, completed_task_id),
  constraint workflow_completion_timeline_unique unique (tenant_id, timeline_event_id),
  constraint workflow_completion_audit_unique unique (tenant_id, audit_event_id),
  constraint workflow_completion_case_same_tenant foreign key
    (tenant_id, employment_case_id) references employment_case (tenant_id, id),
  constraint workflow_completion_instance_same_tenant foreign key
    (tenant_id, workflow_instance_id) references workflow_instance (tenant_id, id),
  constraint workflow_completion_task_same_tenant foreign key
    (tenant_id, completed_task_id) references task (tenant_id, id),
  constraint workflow_completion_timeline_same_tenant foreign key
    (tenant_id, timeline_event_id) references timeline_event (tenant_id, id)
);

create index workflow_contact_activity_by_workflow on workflow_contact_activity
  (tenant_id, workflow_instance_id, occurred_at desc);
create index workflow_contact_activity_follow_up on workflow_contact_activity
  (tenant_id, follow_up_at) where follow_up_at is not null;
create index employment_authorization_link_by_case on employment_authorization_link
  (tenant_id, employment_case_id, linked_at desc);
create index authorization_overlap_review_open on authorization_overlap_review
  (tenant_id, employment_case_id, status, updated_at)
  where status <> 'resolved';
create index workflow_completion_by_case on workflow_completion
  (tenant_id, employment_case_id, completed_at desc);

alter table workflow_contact_activity enable row level security;
alter table employment_authorization_link enable row level security;
alter table authorization_overlap_review enable row level security;
alter table workflow_completion enable row level security;
alter table workflow_contact_activity force row level security;
alter table employment_authorization_link force row level security;
alter table authorization_overlap_review force row level security;
alter table workflow_completion force row level security;

create policy workflow_contact_activity_tenant_isolation on workflow_contact_activity
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);
create policy employment_authorization_link_tenant_isolation on employment_authorization_link
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);
create policy authorization_overlap_review_tenant_isolation on authorization_overlap_review
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);
create policy workflow_completion_tenant_isolation on workflow_completion
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Contact, authorization-link, and completion facts are append-only. Overlap
-- review alone is mutable because it has an explicit review lifecycle.
grant select, insert on workflow_contact_activity, employment_authorization_link,
  workflow_completion to caredesk_app;
grant select, insert, update on authorization_overlap_review to caredesk_app;

insert into schema_migrations (version)
values ('0022_remaining_visa_renewal_persistence');
