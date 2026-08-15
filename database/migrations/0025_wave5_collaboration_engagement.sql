-- Wave 5: additive collaboration, explicit worker access and transactional
-- engagement facts. Projections remain application-layer and are not stored.

alter table task add column assignee_membership_id uuid;
alter table task add constraint task_assignee_same_tenant foreign key
  (tenant_id, assignee_membership_id) references tenant_membership (tenant_id, id);
create index task_by_assignee on task (tenant_id, assignee_membership_id, status, due_at);

alter table document add column worker_visibility text not null default 'employer_only'
  check (worker_visibility in ('employer_only', 'worker_view', 'worker_action'));

create table case_responsibility_assignment (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  employment_case_id uuid not null,
  responsibility text not null check (responsibility in
    ('case_management','payroll','documents_compliance','visa_authorization','insurance','general_administration')),
  assignee_membership_id uuid,
  assigned_by uuid not null,
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  created_at timestamptz not null default now(),
  constraint case_responsibility_tenant_unique unique (tenant_id, id),
  constraint case_responsibility_case_fk foreign key (tenant_id, employment_case_id)
    references employment_case (tenant_id, id),
  constraint case_responsibility_assignee_fk foreign key (tenant_id, assignee_membership_id)
    references tenant_membership (tenant_id, id),
  constraint case_responsibility_dates check (effective_to is null or effective_to >= effective_from)
);
create unique index case_responsibility_current on case_responsibility_assignment
  (tenant_id, employment_case_id, responsibility) where effective_to is null;

create table worker_portal_access (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  employment_case_id uuid not null,
  caregiver_id uuid not null,
  user_id uuid,
  status text not null default 'invited' check (status in ('invited','active','revoked','expired')),
  activated_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint worker_access_tenant_unique unique (tenant_id, id),
  constraint worker_access_case_fk foreign key (tenant_id, employment_case_id)
    references employment_case (tenant_id, id),
  constraint worker_access_caregiver_fk foreign key (tenant_id, caregiver_id)
    references caregiver (tenant_id, id),
  constraint worker_access_user_fk foreign key (user_id) references app_user (id),
  constraint worker_access_state check (
    (status = 'active' and user_id is not null and activated_at is not null and revoked_at is null)
    or status = 'invited'
    or (status = 'revoked' and revoked_at is not null)
    or status = 'expired')
);
create unique index worker_access_active_case on worker_portal_access
  (tenant_id, employment_case_id, caregiver_id) where status in ('invited','active');

create table worker_portal_invitation (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  worker_portal_access_id uuid not null,
  destination_hint text not null check (length(destination_hint) between 3 and 254),
  token_hash text not null unique check (length(token_hash) >= 32),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  revoked_at timestamptz,
  invited_by uuid not null,
  created_at timestamptz not null default now(),
  constraint worker_invitation_tenant_unique unique (tenant_id, id),
  constraint worker_invitation_access_fk foreign key (tenant_id, worker_portal_access_id)
    references worker_portal_access (tenant_id, id),
  constraint worker_invitation_expiry check (expires_at > created_at),
  constraint worker_invitation_single_use check (consumed_at is null or revoked_at is null)
);

create table worker_payment_acknowledgement (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  payroll_month_close_id uuid not null,
  worker_portal_access_id uuid not null,
  acknowledgement_version integer not null default 1 check (acknowledgement_version > 0),
  wording_key text not null default 'worker.payment.acknowledgement.receipt_only',
  acknowledged_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint worker_ack_tenant_unique unique (tenant_id, id),
  constraint worker_ack_idempotent unique (tenant_id, payroll_month_close_id, worker_portal_access_id, acknowledgement_version),
  constraint worker_ack_close_fk foreign key (tenant_id, payroll_month_close_id)
    references payroll_month_close (tenant_id, id),
  constraint worker_ack_access_fk foreign key (tenant_id, worker_portal_access_id)
    references worker_portal_access (tenant_id, id)
);

create table worker_request (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  employment_case_id uuid not null,
  worker_portal_access_id uuid not null,
  request_type text not null check (request_type in ('vacation','document','payment_question','general')),
  message text not null check (length(trim(message)) between 1 and 1000),
  start_date date,
  end_date date,
  status text not null default 'submitted' check (status in ('submitted','in_review','approved','rejected','resolved','cancelled')),
  assigned_membership_id uuid,
  resolution_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint worker_request_tenant_unique unique (tenant_id, id),
  constraint worker_request_case_fk foreign key (tenant_id, employment_case_id)
    references employment_case (tenant_id, id),
  constraint worker_request_access_fk foreign key (tenant_id, worker_portal_access_id)
    references worker_portal_access (tenant_id, id),
  constraint worker_request_assignee_fk foreign key (tenant_id, assigned_membership_id)
    references tenant_membership (tenant_id, id),
  constraint worker_request_dates check ((start_date is null and end_date is null) or
    (request_type = 'vacation' and start_date is not null and end_date is not null and start_date <= end_date))
);

create table communication_preference (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  participant_type text not null check (participant_type in ('family_member','worker')),
  participant_id uuid not null,
  email_enabled boolean not null default true,
  whatsapp_enabled boolean not null default false,
  sms_enabled boolean not null default false,
  preferred_channel text not null default 'email' check (preferred_channel in ('email','whatsapp','sms')),
  preferred_locale text not null default 'he' check (preferred_locale in ('he','en')),
  whatsapp_consent text not null default 'unknown' check (whatsapp_consent in ('unknown','granted','revoked')),
  sms_consent text not null default 'unknown' check (sms_consent in ('unknown','granted','revoked')),
  consent_source text,
  consent_recorded_at timestamptz,
  revoked_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint communication_preference_tenant_unique unique (tenant_id, id),
  constraint communication_preference_participant unique (tenant_id, participant_type, participant_id),
  constraint communication_phone_consent check (
    (whatsapp_consent = 'unknown' and sms_consent = 'unknown') or consent_recorded_at is not null)
);

create table notification_intent (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  recipient_type text not null check (recipient_type in ('family_member','worker')),
  recipient_id uuid not null,
  event_type text not null,
  template_key text not null,
  template_version integer not null check (template_version > 0),
  locale text not null check (locale in ('he','en')),
  authenticated_path text not null check (authenticated_path like '/%'),
  idempotency_key text not null,
  status text not null default 'pending' check (status in ('pending','processing','delivered','failed','suppressed')),
  created_at timestamptz not null default now(),
  constraint notification_intent_tenant_unique unique (tenant_id, id),
  constraint notification_intent_idempotent unique (tenant_id, idempotency_key)
);

create table notification_delivery_attempt (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  notification_intent_id uuid not null,
  channel text not null check (channel in ('email','whatsapp','sms')),
  template_key text not null,
  template_version integer not null check (template_version > 0),
  provider text not null,
  provider_message_id text,
  status text not null check (status in ('attempting','accepted','delivered','failed','disabled')),
  attempted_at timestamptz not null default now(),
  delivered_at timestamptz,
  failure_category text,
  retry_count integer not null default 0 check (retry_count >= 0),
  constraint notification_attempt_tenant_unique unique (tenant_id, id),
  constraint notification_attempt_intent_fk foreign key (tenant_id, notification_intent_id)
    references notification_intent (tenant_id, id),
  constraint notification_attempt_delivery check (delivered_at is null or status = 'delivered')
);

create index worker_request_attention on worker_request (tenant_id, employment_case_id, status, created_at);
create index notification_pending on notification_intent (tenant_id, status, created_at);
create index notification_attempt_intent on notification_delivery_attempt (tenant_id, notification_intent_id, attempted_at);

do $$ declare table_name text; begin
  foreach table_name in array array['case_responsibility_assignment','worker_portal_access',
    'worker_portal_invitation','worker_payment_acknowledgement','worker_request',
    'communication_preference','notification_intent','notification_delivery_attempt']
  loop
    execute format('alter table %I enable row level security', table_name);
    execute format('alter table %I force row level security', table_name);
    execute format('create policy %I on %I using (tenant_id = current_setting(''app.tenant_id'', true)::uuid) with check (tenant_id = current_setting(''app.tenant_id'', true)::uuid)', table_name || '_tenant_isolation', table_name);
  end loop;
end $$;

grant select, insert, update on case_responsibility_assignment, worker_portal_access,
  worker_portal_invitation, worker_request, communication_preference, notification_intent,
  notification_delivery_attempt to caredesk_app;
-- Acknowledgements and invitations are evidence: corrections append; they are never edited/deleted.
grant select, insert on worker_payment_acknowledgement to caredesk_app;

insert into schema_migrations (version) values ('0025_wave5_collaboration_engagement');
