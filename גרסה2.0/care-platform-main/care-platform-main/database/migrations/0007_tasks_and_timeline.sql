-- Tasks and timeline (Database Blueprint §4.6 and §4.10, migration order §10
-- steps 5 and 9).
--
-- Task titles: the blueprint specifies a "title key" because workflow-generated
-- tasks carry translation keys. Milestone 1 tasks are typed by a user, so free
-- text is what actually exists. Both are modelled: `title_key` for tasks a
-- workflow will generate from Milestone 2 onward, `title` for user-entered
-- ones, with a check constraint requiring exactly one of them.

create table task (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  employment_case_id uuid not null,
  -- Workflow linkage arrives in Milestone 2; nullable until then.
  workflow_instance_id uuid,
  workflow_step_id uuid,
  title text,
  title_key text,
  description text,
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'blocked', 'completed', 'deferred', 'cancelled')),
  priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high', 'urgent')),
  due_at timestamptz,
  deferred_until timestamptz,
  defer_reason text,
  source_type text not null default 'manual'
    check (source_type in ('manual', 'rule', 'workflow')),
  source_id uuid,
  completed_at timestamptz,
  completed_by uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  constraint task_has_exactly_one_title
    check ((title is null) <> (title_key is null)),
  -- A completed task must record when; a non-completed one must not claim to.
  constraint task_completed_at_matches_status
    check ((status = 'completed') = (completed_at is not null)),
  constraint task_deferred_requires_reason
    check (status <> 'deferred' or (deferred_until is not null and defer_reason is not null))
);

-- User-facing case history. Distinct from audit_event: this is what a family
-- member reads, so it holds translation keys and a sensitivity label, never
-- raw sensitive values (blueprint §4.10).
create table timeline_event (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  employment_case_id uuid not null,
  event_type_key text not null,
  summary_key text not null,
  occurred_at timestamptz not null,
  actor_display text,
  source_type text,
  source_id uuid,
  sensitivity text not null default 'general'
    check (sensitivity in (
      'general', 'employment_sensitive', 'financial_sensitive',
      'identity_sensitive', 'care_sensitive'
    )),
  created_at timestamptz not null default now()
);

alter table task
  add constraint task_case_same_tenant
    foreign key (tenant_id, employment_case_id) references employment_case (tenant_id, id);

alter table timeline_event
  add constraint timeline_event_case_same_tenant
    foreign key (tenant_id, employment_case_id) references employment_case (tenant_id, id);

-- Blueprint §8: due tasks, and timeline newest-first per case.
create index task_by_due on task (tenant_id, status, due_at);
create index task_by_case on task (tenant_id, employment_case_id, status);
create index timeline_event_by_case on timeline_event (tenant_id, employment_case_id, occurred_at desc);

alter table task enable row level security;
alter table timeline_event enable row level security;
alter table task force row level security;
alter table timeline_event force row level security;

create policy task_tenant_isolation on task
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

create policy timeline_event_tenant_isolation on timeline_event
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Timeline is append-only for the application: no update, no delete.
grant select, insert, update, delete on task to caredesk_app;
grant select, insert on timeline_event to caredesk_app;

insert into schema_migrations (version) values ('0007_tasks_and_timeline');
