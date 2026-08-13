-- Canonical normalized persistence for the Visa Renewal workflow. No legal
-- deadlines or outcomes are seeded here: templates and rule evidence are
-- versioned facts supplied only after professional approval.

create table workflow_template (
  id uuid primary key default gen_random_uuid(),
  template_key text not null,
  name_key text not null,
  created_at timestamptz not null default now(),
  constraint workflow_template_key_unique unique (template_key)
);

create table workflow_template_version (
  id uuid primary key default gen_random_uuid(),
  workflow_template_id uuid not null references workflow_template (id),
  version integer not null check (version > 0),
  status text not null check (status in ('draft', 'approved', 'active', 'retired')),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint workflow_template_version_unique unique (workflow_template_id, version),
  constraint workflow_template_approval_consistent
    check ((status in ('approved', 'active', 'retired')) = (approved_at is not null))
);

create table workflow_template_step (
  id uuid primary key default gen_random_uuid(),
  workflow_template_version_id uuid not null references workflow_template_version (id),
  step_key text not null,
  title_key text not null,
  position integer not null check (position > 0),
  required boolean not null default true,
  constraint workflow_template_step_key_unique
    unique (workflow_template_version_id, step_key),
  constraint workflow_template_step_position_unique
    unique (workflow_template_version_id, position)
);

create table visa_rule_definition (
  id uuid primary key default gen_random_uuid(),
  rule_key text not null unique,
  description_key text not null,
  created_at timestamptz not null default now()
);

create table visa_rule_version (
  id uuid primary key default gen_random_uuid(),
  rule_definition_id uuid not null references visa_rule_definition (id),
  version integer not null check (version > 0),
  status text not null check (status in
    ('draft', 'under_review', 'approved', 'active', 'suspended', 'superseded', 'retired')),
  effective_from date,
  effective_to date,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint visa_rule_version_unique unique (rule_definition_id, version),
  constraint visa_rule_version_definition_id_unique unique (rule_definition_id, id),
  constraint visa_rule_version_dates check
    (effective_to is null or effective_from is null or effective_to >= effective_from)
);

create table visa_rule_source (
  id uuid primary key default gen_random_uuid(),
  rule_version_id uuid not null references visa_rule_version (id),
  source_reference text not null,
  retrieved_at timestamptz not null,
  checksum text,
  created_at timestamptz not null default now(),
  constraint visa_rule_source_unique unique (rule_version_id, source_reference)
);

create table employment_authorization (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  employment_case_id uuid not null,
  status text not null check (status in ('current', 'renewed', 'expired', 'cancelled')),
  valid_from date,
  valid_until date,
  created_at timestamptz not null default now(),
  constraint employment_authorization_tenant_unique unique (tenant_id, id),
  constraint employment_authorization_dates check
    (valid_until is null or valid_from is null or valid_until >= valid_from),
  constraint employment_authorization_case_same_tenant foreign key
    (tenant_id, employment_case_id) references employment_case (tenant_id, id)
);

create table workflow_instance (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  employment_case_id uuid not null,
  template_version_id uuid not null references workflow_template_version (id),
  current_authorization_id uuid not null,
  linked_renewed_authorization_id uuid,
  linked_document_version_id uuid,
  status text not null default 'active'
    check (status in ('not_started', 'active', 'blocked', 'completed', 'cancelled')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  constraint workflow_instance_tenant_unique unique (tenant_id, id),
  constraint workflow_instance_completion_consistent
    check ((status = 'completed') = (completed_at is not null)),
  constraint workflow_instance_case_same_tenant foreign key
    (tenant_id, employment_case_id) references employment_case (tenant_id, id),
  constraint workflow_instance_current_authorization_same_tenant foreign key
    (tenant_id, current_authorization_id) references employment_authorization (tenant_id, id),
  constraint workflow_instance_renewed_authorization_same_tenant foreign key
    (tenant_id, linked_renewed_authorization_id) references employment_authorization (tenant_id, id),
  constraint workflow_instance_document_version_same_tenant foreign key
    (tenant_id, linked_document_version_id) references document_version (tenant_id, id)
);

create table workflow_rule_evaluation (
  workflow_instance_id uuid primary key,
  tenant_id uuid not null references tenant (id),
  rule_definition_id uuid not null references visa_rule_definition (id),
  rule_version_id uuid not null references visa_rule_version (id),
  status text not null check (status in ('active', 'unverified', 'conflicting', 'unavailable')),
  evaluated_as_of timestamptz not null,
  due_date date,
  priority text check (priority in ('low', 'normal', 'high', 'urgent')),
  explanation_key text not null,
  review_required boolean not null,
  constraint workflow_rule_evaluation_tenant_unique unique (tenant_id, workflow_instance_id),
  constraint workflow_rule_evaluation_instance_same_tenant foreign key
    (tenant_id, workflow_instance_id) references workflow_instance (tenant_id, id),
  constraint workflow_rule_evaluation_rule_version_matches_definition foreign key
    (rule_definition_id, rule_version_id) references visa_rule_version (rule_definition_id, id)
);

create table workflow_evaluation_source (
  tenant_id uuid not null references tenant (id),
  workflow_instance_id uuid not null,
  rule_source_id uuid not null references visa_rule_source (id),
  primary key (tenant_id, workflow_instance_id, rule_source_id),
  constraint workflow_evaluation_source_instance_same_tenant foreign key
    (tenant_id, workflow_instance_id) references workflow_instance (tenant_id, id)
);

create table workflow_step (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  workflow_instance_id uuid not null,
  template_step_id uuid not null references workflow_template_step (id),
  step_key text not null,
  position integer not null check (position > 0),
  status text not null default 'not_started'
    check (status in ('not_started', 'active', 'blocked', 'completed', 'cancelled')),
  completed_at timestamptz,
  constraint workflow_step_tenant_unique unique (tenant_id, id),
  constraint workflow_step_key_unique unique (tenant_id, workflow_instance_id, step_key),
  constraint workflow_step_position_unique unique (tenant_id, workflow_instance_id, position),
  constraint workflow_step_instance_same_tenant foreign key
    (tenant_id, workflow_instance_id) references workflow_instance (tenant_id, id),
  constraint workflow_step_completion_consistent
    check ((status = 'completed') = (completed_at is not null))
);

create table workflow_assignment (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  workflow_step_id uuid not null,
  raci_role text not null check (raci_role in ('responsible', 'accountable', 'consulted', 'informed')),
  assignee_type text not null check (assignee_type in ('user', 'contact')),
  assignee_membership_id uuid,
  assignee_contact_id uuid,
  created_at timestamptz not null default now(),
  constraint workflow_assignment_unique unique nulls not distinct
    (tenant_id, workflow_step_id, raci_role, assignee_type,
      assignee_membership_id, assignee_contact_id),
  constraint workflow_assignment_assignee_consistent check (
    (assignee_type = 'user' and assignee_membership_id is not null and assignee_contact_id is null)
    or (assignee_type = 'contact' and assignee_contact_id is not null and assignee_membership_id is null)
  ),
  constraint workflow_assignment_step_same_tenant foreign key
    (tenant_id, workflow_step_id) references workflow_step (tenant_id, id),
  constraint workflow_assignment_membership_same_tenant foreign key
    (tenant_id, assignee_membership_id) references tenant_membership (tenant_id, id),
  constraint workflow_assignment_contact_same_tenant foreign key
    (tenant_id, assignee_contact_id) references contact (tenant_id, id),
  constraint workflow_assignment_tenant_id_unique unique (tenant_id, id)
);

create table workflow_blocker (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  workflow_step_id uuid not null,
  code text not null check (code in ('missing_primary_licensed_bureau_contact',
    'overlapping_authorization', 'unverified_evidence', 'professional_review_required')),
  owner_assignment_id uuid,
  next_review_at timestamptz,
  resolved_at timestamptz,
  constraint workflow_blocker_step_same_tenant foreign key
    (tenant_id, workflow_step_id) references workflow_step (tenant_id, id),
  constraint workflow_blocker_owner_same_tenant foreign key
    (tenant_id, owner_assignment_id) references workflow_assignment (tenant_id, id)
);

create table idempotency_record (
  tenant_id uuid not null references tenant (id),
  operation text not null,
  idempotency_key text not null,
  request_hash text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  primary key (tenant_id, operation, idempotency_key)
);

create index workflow_instance_by_case on workflow_instance
  (tenant_id, employment_case_id, created_at desc);
create index workflow_instance_active on workflow_instance
  (tenant_id, status, id) where status in ('active', 'blocked');
create index workflow_step_by_instance on workflow_step
  (tenant_id, workflow_instance_id, position);
create index workflow_assignment_by_assignee on workflow_assignment
  (tenant_id, assignee_type, assignee_membership_id, assignee_contact_id);
create index workflow_blocker_open on workflow_blocker
  (tenant_id, next_review_at) where resolved_at is null;
create index idempotency_record_expiry on idempotency_record (expires_at)
  where expires_at is not null;

alter table task add constraint task_workflow_instance_same_tenant foreign key
  (tenant_id, workflow_instance_id) references workflow_instance (tenant_id, id) not valid;
alter table task add constraint task_workflow_step_same_tenant foreign key
  (tenant_id, workflow_step_id) references workflow_step (tenant_id, id) not valid;
alter table task validate constraint task_workflow_instance_same_tenant;
alter table task validate constraint task_workflow_step_same_tenant;

alter table employment_authorization enable row level security;
alter table workflow_instance enable row level security;
alter table workflow_rule_evaluation enable row level security;
alter table workflow_evaluation_source enable row level security;
alter table workflow_step enable row level security;
alter table workflow_assignment enable row level security;
alter table workflow_blocker enable row level security;
alter table idempotency_record enable row level security;
alter table employment_authorization force row level security;
alter table workflow_instance force row level security;
alter table workflow_rule_evaluation force row level security;
alter table workflow_evaluation_source force row level security;
alter table workflow_step force row level security;
alter table workflow_assignment force row level security;
alter table workflow_blocker force row level security;
alter table idempotency_record force row level security;

create policy employment_authorization_tenant_isolation on employment_authorization
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);
create policy workflow_instance_tenant_isolation on workflow_instance
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);
create policy workflow_rule_evaluation_tenant_isolation on workflow_rule_evaluation
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);
create policy workflow_evaluation_source_tenant_isolation on workflow_evaluation_source
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);
create policy workflow_step_tenant_isolation on workflow_step
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);
create policy workflow_assignment_tenant_isolation on workflow_assignment
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);
create policy workflow_blocker_tenant_isolation on workflow_blocker
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);
create policy idempotency_record_tenant_isolation on idempotency_record
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

grant select, insert, update, delete on employment_authorization, workflow_instance,
  workflow_rule_evaluation, workflow_evaluation_source, workflow_step,
  workflow_assignment, workflow_blocker to caredesk_app;
grant select, insert on idempotency_record to caredesk_app;
grant select on workflow_template, workflow_template_version, workflow_template_step,
  visa_rule_definition, visa_rule_version, visa_rule_source to caredesk_app;

insert into schema_migrations (version) values ('0021_visa_renewal_persistence');
