-- Server-side homes for the four data kinds still trapped in the browser
-- (`apps/web/src/storage/mvp-storage.ts`): documents, tasks, medications, and
-- caregiver identity. This migration covers the two genuine schema gaps —
-- idempotent import support on `task`/`document`, and a new `medication`
-- table. Caregiver identity already has a canonical table (`caregiver`,
-- migration 0003) and needs no schema change, only new application code.
--
-- IMPORT IDEMPOTENCY (documents, tasks)
-- --------------------------------------
-- Every current customer's data lives only on their device. The future UI
-- cutover uploads what is on the device to the server, and that upload must be
-- safe to run twice (retry after a dropped connection, two tabs, a user who
-- reopens the app before the first upload finished). `legacy_local_id` is the
-- same provenance-marker idea as `employment_case.legacy_client_id`
-- (migration 0042): an opaque id assigned by the browser store, written once
-- at import and never updated, with a partial unique index so a second import
-- of the same local record cannot create a duplicate row at the database
-- layer — the second line behind the application-level "find first" check
-- (see ImportCaseTask / ImportCaseDocument / ImportMedication).
--
-- Both `task` and `document` predate this need (0007, 0008) and did not carry
-- any client-assigned identifier, so both gain the same nullable column and
-- the same partial unique index, scoped per case so the same local id cannot
-- collide across two different cases in one tenant.

alter table task add column if not exists legacy_local_id text;
comment on column task.legacy_local_id is
  'Opaque id of the browser-only task (caredesk.mvp.tasks.v1) this row was imported from. Written once at import, never updated. Null for tasks created directly on the server.';

create unique index if not exists task_legacy_local_id_unique
  on task (tenant_id, employment_case_id, legacy_local_id)
  where legacy_local_id is not null;

alter table document add column if not exists legacy_local_id text;
comment on column document.legacy_local_id is
  'Opaque id of the browser-only document (caredesk.mvp.documents.v1) this row was imported from. Written once at import, never updated. Null for documents created directly on the server.';

create unique index if not exists document_legacy_local_id_unique
  on document (tenant_id, employment_case_id, legacy_local_id)
  where legacy_local_id is not null;

-- MEDICATIONS — the one genuinely new domain
-- -------------------------------------------
-- Deliberately modelled like `care_recipient` (0003): plain, typed columns
-- with a fixed `sensitivity`, not the encrypted-ciphertext design that
-- sensitive-record-migration-requirements.md gates. That document targets
-- identity credentials and banking/payment details being promoted out of the
-- legacy snapshot into plaintext columns; a medication name, dosage, or note
-- is a descriptive care fact of the same character as
-- `care_recipient.care_level`, which this codebase already stores as plain
-- text under `sensitivity = 'care_sensitive'`. Nothing here is a credential.
--
-- `times_of_day` and `days_of_week` are arrays of the same named-slot/named-day
-- vocabulary the browser store used (MEDICATION_TIMES / MEDICATION_DAYS in
-- mvp-storage.ts, now also packages/domain/src/status.ts) — checked with `<@`
-- array containment so a stray value cannot silently enter the column, without
-- needing a separate join table for what is always a short, fixed list.
--
-- `days_of_week` is nullable (as opposed to defaulting to `'{}'`) to preserve
-- the three-state distinction the client already relies on: absent means "a
-- record saved before this concept existed / not asked", `{}` means "asked,
-- answered with none". Collapsing them would be harmless today but would lose
-- information a later reminder-scheduling migration needs.
--
-- No DELETE grant. Migration 0037 closed the one DELETE hole that existed on
-- `tenant_workspace`; the safer default demonstrated there — an application
-- role that cannot destroy tenant data at all — is applied here from the
-- start rather than granted and revoked later. A medication that is no longer
-- taken is archived (`status = 'archived'`), never removed, matching the
-- product's stance everywhere else that history must stay reconstructable.

create table medication (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  employment_case_id uuid not null,
  name text not null,
  dosage text not null default '',
  times_of_day text[] not null default '{}'
    check (times_of_day <@ array['morning', 'noon', 'evening', 'night']::text[]),
  daily boolean not null default true,
  days_of_week text[]
    check (
      days_of_week is null
      or days_of_week <@ array[
        'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'
      ]::text[]
    ),
  prescribing_doctor text not null default '',
  notes text not null default '',
  status text not null default 'active' check (status in ('active', 'archived')),
  sensitivity text not null default 'care_sensitive'
    check (sensitivity in (
      'general', 'employment_sensitive', 'financial_sensitive',
      'identity_sensitive', 'care_sensitive'
    )),
  legacy_local_id text,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1
);

alter table medication
  add constraint medication_case_same_tenant
    foreign key (tenant_id, employment_case_id) references employment_case (tenant_id, id);

create index medication_by_case on medication (tenant_id, employment_case_id, status);

create unique index medication_legacy_local_id_unique
  on medication (tenant_id, employment_case_id, legacy_local_id)
  where legacy_local_id is not null;

alter table medication enable row level security;
alter table medication force row level security;

create policy medication_tenant_isolation on medication
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Deliberately no delete grant — see the note above.
grant select, insert, update on medication to caredesk_app;

insert into schema_migrations (version) values ('0046_mvp_local_data_server_migration');
