-- Root 6 (DB-01) - the application role may not lock the one table every
-- idempotent write locks.
--
-- WHAT IS WRONG
-- -------------
-- 0021 created `idempotency_record` and granted `select, insert` and nothing
-- else, on the correct reasoning that a replay receipt is evidence and must
-- never be edited. Seven write paths then implemented durable idempotency the
-- only way that is actually safe under concurrency:
--
--   select request_hash, response from idempotency_record
--    where operation = $1 and idempotency_key = $2 for update
--
-- PostgreSQL requires UPDATE, DELETE or SELECT FOR UPDATE privilege to take a
-- row lock - plain SELECT is not enough. With `select, insert` alone every one
-- of those statements raises `permission denied for table idempotency_record`
-- at runtime. The call sites are:
--
--   apps/api/src/payroll-entry-service.ts
--   apps/api/src/leave-entry-service.ts
--   apps/api/src/scenario-expense-service.ts
--   apps/api/src/collaboration/wave5-service.ts
--   apps/api/src/binder-export-service.ts
--   apps/api/src/regulation-rule-service.ts
--   apps/api/src/product-intelligence/canonical-intelligence-service.ts
--
-- Every one of them is a money-adjacent or evidence-producing mutation, and
-- every one of them is the retry path - the path a user reaches by pressing
-- Save twice on a slow connection. It fails inside the transaction, so the
-- whole write rolls back and the user is told the save failed. The double-tap
-- protection that root 5 depends on has never once executed successfully in
-- production.
--
-- WHY THIS SHAPE
-- --------------
-- There is no grantable "may lock but not modify" privilege in PostgreSQL, so
-- the lock has to be bought with UPDATE. Granting UPDATE alone would silently
-- undo 0021's actual intent: a receipt could then be rewritten, and a rewritten
-- receipt makes a replayed request return a different answer than the original
-- - the exact failure durable idempotency exists to prevent.
--
-- So the grant is paired with a trigger that rejects the UPDATE itself. The
-- privilege buys the row lock; the trigger keeps the row immutable. Both
-- properties are then enforced by the database rather than by the discipline of
-- seven separate call sites.
--
-- DELETE is deliberately NOT granted. It would also satisfy the lock
-- requirement, and it would let a receipt be destroyed rather than merely
-- rewritten - strictly worse.
--
-- Additive: no column dropped, no row deleted, no existing value rewritten.
-- The trigger only ever raises; it cannot modify a row on its way past.

grant update on idempotency_record to caredesk_app;

create or replace function reject_idempotency_record_update()
returns trigger
language plpgsql
as $$
begin
  -- Named explicitly so the failure reads as a design decision in the log
  -- rather than as a mystery constraint violation. 55000 is
  -- object_not_in_prerequisite_state, the closest standard class to "this row
  -- is not in a state that permits modification".
  raise exception
    'idempotency_record is append-only; UPDATE is granted only so that '
    'SELECT ... FOR UPDATE can take a row lock (migration 0040, DB-01)'
    using errcode = '55000';
end;
$$;

-- Postgres grants EXECUTE on a new function to PUBLIC by default, which on
-- Supabase means the browser-facing anon and authenticated roles. This has bitten
-- this schema three times (0035, 0037, 0038); it is revoked here for the same
-- reason. A trigger needs no EXECUTE grant to fire.
revoke all privileges on function reject_idempotency_record_update() from public;

create trigger idempotency_record_reject_update
  before update on idempotency_record
  for each row
  execute function reject_idempotency_record_update();

insert into schema_migrations (version) values ('0040_idempotency_record_lockable');
