-- Emergency Binder export receipts (capability #15 — secure server export).
--
-- A receipt is durable evidence that a specific, explicitly selected manifest
-- was exported for a case: which sections, which document ids, by whom and
-- when, plus a deterministic sha256 fingerprint of the manifest and the
-- document metadata it covered at export time. Like audit_event (0009),
-- receipts are evidence, so `caredesk_app` is granted select and insert only:
-- an export record that can be edited or deleted afterwards is not evidence.
--
-- Deliberately absent: any sharing/link table. Public Binder sharing stays
-- disabled (fail-closed) at launch — a receipt records that an export
-- happened; it is never itself a way to reach the exported content.

create table binder_export_receipt (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  employment_case_id uuid not null,
  -- The explicit manifest exactly as the server validated it:
  -- {"sections": [...], "documentIds": [...]}. Every document id was checked
  -- to belong to this case inside the same transaction that wrote this row.
  manifest jsonb not null check (jsonb_typeof(manifest) = 'object'),
  -- sha256 hex of the canonical manifest + content metadata (never file bytes,
  -- never sensitive values — ids, section names and status metadata only).
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  hash_algorithm text not null default 'sha256' check (hash_algorithm = 'sha256'),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint binder_export_receipt_tenant_unique unique (tenant_id, id),
  -- Composite FK: a receipt can only ever point at a case in its own tenant.
  constraint binder_export_receipt_case_same_tenant foreign key (tenant_id, employment_case_id)
    references employment_case (tenant_id, id)
);

create index binder_export_receipt_by_case
  on binder_export_receipt (tenant_id, employment_case_id, created_at desc);

alter table binder_export_receipt enable row level security;
alter table binder_export_receipt force row level security;
create policy binder_export_receipt_tenant_isolation on binder_export_receipt
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Append-only: select + insert only, mirroring audit_event (0009) and
-- timeline_event (0007). No update, no delete — receipts are immutable.
grant select, insert on binder_export_receipt to caredesk_app;

insert into schema_migrations (version) values ('0031_binder_export_receipt');
