-- workspace_file is the only map from a tenant to its private storage objects.
--
-- `PgWorkspaceFileRepository.delete` issued a hard `delete ... returning`, and
-- the caller then asked object storage to remove the blob. Between those two
-- statements there is a network, a permission check and a process that can die.
-- If the row is gone and the object delete fails, the bytes stay in the private
-- bucket with nothing anywhere recording which tenant they belong to or that
-- they exist: they cannot be found, cannot be included in an erasure request,
-- and cannot be reconciled. A permanent orphaned copy of a passport scan
-- outside the schema's reach is a worse outcome than a row that outlives its
-- object.
--
-- The house convention already answers this. `scenario_expense` (0034:13) -
-- "No delete grant: removal is a soft status change". `leave_entry` (0033:15)
-- - "Ledger rows are never hard-deleted". This table now follows it.
--
-- The tombstone keeps `storage_key`, which is the whole point: it is the only
-- record of the object, so it is the one column that must survive the delete.
-- Reconciliation sweeps `status = 'deleted'` and removes the row only once the
-- object is confirmed gone.
--
-- The DELETE grant is revoked because after this change nothing needs it, and a
-- grant that nothing needs is only a way for a future code path to reopen the
-- hole. Operator-level cleanup runs as the owner and is unaffected.
--
-- Additive: the column is added with a default, so every existing row becomes
-- 'active' without any value being rewritten. No row is deleted.

alter table workspace_file
  add column if not exists status text not null default 'active'
    check (status in ('active', 'deleted'));

alter table workspace_file
  add column if not exists deleted_at timestamptz;

-- Reconciliation reads exactly this: the tombstones, oldest first.
create index if not exists workspace_file_deleted_pending
  on workspace_file (tenant_id, deleted_at)
  where status = 'deleted';

revoke delete on workspace_file from caredesk_app;

insert into schema_migrations (version) values ('0039_workspace_file_tombstone');
