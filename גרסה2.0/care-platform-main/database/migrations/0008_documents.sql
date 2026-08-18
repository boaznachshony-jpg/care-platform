-- Documents (Database Blueprint §4.5, migration order §10 step 6).
--
-- Two tables, deliberately: `document` is the logical container a family
-- member thinks about ("the caregiver's passport"), `document_version` is the
-- immutable record of one uploaded file. Replacing a file never edits a
-- version — it inserts a new one and points `current_version_id` at it, which
-- is why `document_version` is granted select/insert only, exactly as
-- timeline_event is in 0007.
--
-- Files themselves never live here: only a private storage key. There is no
-- public URL anywhere in this design; reads go through a short-lived signed
-- link issued after the authorization check (Constitution §16).

-- `document_version` must reference its parent within the same tenant, so
-- `document` needs a (tenant_id, id) key to be referenced by — the same reason
-- 0006 added employment_case_tenant_unique.

create table document (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  employment_case_id uuid not null,
  document_type text not null
    check (document_type in (
      'passport', 'visa', 'employment_contract', 'insurance_policy',
      'medical', 'payroll', 'other'
    )),
  -- Which party the document is *about*. Not an access grant: authorization
  -- comes from tenant_membership and permission_grant only (Constitution §18).
  owner_type text not null
    check (owner_type in (
      'employment_case', 'care_recipient', 'employer', 'caregiver',
      'organization', 'contact'
    )),
  owner_id uuid,
  -- SYNC_MATRIX.md "Sensitivity classes".
  sensitivity text not null default 'general'
    check (sensitivity in (
      'general', 'employment_sensitive', 'financial_sensitive',
      'identity_sensitive', 'care_sensitive'
    )),
  -- SYNC_MATRIX.md "Document compliance".
  compliance_status text not null default 'missing'
    check (compliance_status in ('missing', 'valid', 'expiring', 'expired', 'not_applicable')),
  -- Set once the first version exists; FK added below, after document_version.
  current_version_id uuid,
  expires_at timestamptz,
  status text not null default 'active'
    check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  -- An expiry-derived compliance status is meaningless without an expiry date.
  constraint document_expiry_required_for_expiry_status
    check (compliance_status not in ('expiring', 'expired') or expires_at is not null)
);

-- Immutable: rows are inserted and never updated or deleted (see grants below).
create table document_version (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  document_id uuid not null,
  version_number integer not null check (version_number >= 1),
  -- Private object-storage key. Never a URL, never logged (Constitution §16).
  storage_key text not null,
  media_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  checksum text,
  upload_source text not null default 'web_upload'
    check (upload_source in ('web_upload', 'email_ingest', 'api', 'migration')),
  -- SYNC_MATRIX.md "DocumentVersion".
  verification_status text not null default 'uploaded'
    check (verification_status in (
      'uploaded', 'pending_verification', 'verified', 'rejected', 'superseded'
    )),
  verified_by uuid,
  verified_at timestamptz,
  supersedes_version_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  -- A verification decision must record who made it and when, or neither.
  constraint document_version_verification_evidence
    check (
      (verification_status in ('verified', 'rejected'))
        = (verified_by is not null and verified_at is not null)
    )
);

alter table document add constraint document_tenant_unique unique (tenant_id, id);
alter table document_version
  add constraint document_version_tenant_unique unique (tenant_id, id);

-- Same-tenant composite foreign keys (ADR-002: a cross-tenant reference must be
-- impossible at the database layer, not merely unlikely).
alter table document
  add constraint document_case_same_tenant
    foreign key (tenant_id, employment_case_id) references employment_case (tenant_id, id);

alter table document_version
  add constraint document_version_document_same_tenant
    foreign key (tenant_id, document_id) references document (tenant_id, id),
  add constraint document_version_supersedes_same_tenant
    foreign key (tenant_id, supersedes_version_id) references document_version (tenant_id, id);

alter table document
  add constraint document_current_version_same_tenant
    foreign key (tenant_id, current_version_id) references document_version (tenant_id, id);

-- Version numbers are dense and unique per document, so "version 3" names
-- exactly one file forever.
alter table document_version
  add constraint document_version_number_unique unique (tenant_id, document_id, version_number);

-- Blueprint §8: documents indexed by (tenant_id, employment_case_id, document_type).
create index document_by_case_type on document (tenant_id, employment_case_id, document_type);
-- Compliance sweeps for documents about to expire.
create index document_by_expiry on document (tenant_id, compliance_status, expires_at);
create index document_version_by_document
  on document_version (tenant_id, document_id, version_number desc);

alter table document enable row level security;
alter table document_version enable row level security;
alter table document force row level security;
alter table document_version force row level security;

create policy document_tenant_isolation on document
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

create policy document_version_tenant_isolation on document_version
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

grant select, insert, update, delete on document to caredesk_app;
-- A file version is evidence: append-only for the application, no update,
-- no delete. Superseding a file inserts a new row instead.
grant select, insert on document_version to caredesk_app;

insert into schema_migrations (version) values ('0008_documents');
