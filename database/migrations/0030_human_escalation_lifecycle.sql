-- Human Escalation lifecycle (capability #14). Adds durable status
-- transitions, a MANUAL handoff assignment and resolution evidence to
-- professional_review_request, plus an append-only transition history table.
--
-- The assignment is a free-text professional name/contact recorded by a tenant
-- manager for a manual handoff. CareDesk performs NO provider fulfilment and
-- makes no delivery claim: the record is evidence of a manual, human step.

-- 1. Expand the status vocabulary to the canonical lifecycle
--    requested -> acknowledged -> in_review -> resolved | cancelled.
--    Legacy 'draft'/'open' rows become 'requested' (the migration role has
--    BYPASSRLS, so the backfill sees every tenant's rows).
alter table professional_review_request
  drop constraint if exists professional_review_request_status_check;
update professional_review_request
  set status = 'requested'
  where status in ('draft', 'open');
alter table professional_review_request
  add constraint professional_review_request_status_check
  check (status in ('requested', 'acknowledged', 'in_review', 'resolved', 'cancelled'));
alter table professional_review_request
  alter column status set default 'requested';

-- 2. Manual handoff assignment + resolution evidence. The legacy uuid
--    assigned_to column is intentionally left untouched (expand-only release
--    policy); assigned_to_name is the canonical free-text handoff field.
alter table professional_review_request
  add column assigned_to_name text
    constraint review_assigned_to_name_length
    check (assigned_to_name is null or char_length(assigned_to_name) between 2 and 200);
alter table professional_review_request
  add column resolution_note text
    constraint review_resolution_note_length
    check (resolution_note is null or char_length(resolution_note) between 3 and 2000);
-- A resolved review must carry its resolution evidence (fail closed).
alter table professional_review_request
  add constraint review_resolution_note_consistent
  check (status <> 'resolved' or resolution_note is not null);

-- 3. Append-only lifecycle history. One row per accepted transition; the
--    unique (tenant_id, idempotency_key) makes transition replays observable
--    and safe. No update/delete grants: history is evidence.
create table professional_review_transition (
  tenant_id uuid not null,
  id uuid not null default gen_random_uuid(),
  review_id uuid not null,
  from_status text not null
    check (from_status in ('requested', 'acknowledged', 'in_review', 'resolved', 'cancelled')),
  to_status text not null
    check (to_status in ('requested', 'acknowledged', 'in_review', 'resolved', 'cancelled')),
  changed_by uuid not null,
  assigned_to_name text
    check (assigned_to_name is null or char_length(assigned_to_name) between 2 and 200),
  resolution_note text
    check (resolution_note is null or char_length(resolution_note) between 3 and 2000),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, idempotency_key),
  constraint review_transition_same_tenant foreign key (tenant_id, review_id)
    references professional_review_request (tenant_id, id)
);
create index professional_review_transition_review_idx
  on professional_review_transition (tenant_id, review_id, created_at);

alter table professional_review_transition enable row level security;
alter table professional_review_transition force row level security;
create policy professional_review_transition_tenant_isolation on professional_review_transition
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

grant select, insert on professional_review_transition to caredesk_app;
