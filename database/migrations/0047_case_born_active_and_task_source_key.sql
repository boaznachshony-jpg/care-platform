-- Product decision, in the product owner's own words (2026-09-02): "the
-- moment a save happens, even with missing details, that IS the file. Filling
-- in critical details, when they are critical, can become an open task on the
-- task board. But saving means an existing case -- the customer decides what
-- they want to record and what not to, exactly like Excel: saving produces a
-- file, the user is responsible for its contents."
--
-- Concretely: `employment_case.status` no longer starts at 'draft' -- see
-- packages/application/src/use-cases/open-employment-case.ts, which now
-- writes 'active' at creation. This migration is the one-time catch-up for
-- rows created before that change shipped. It does two things:
--
--   1. Moves every existing 'draft' case to 'active'. Narrowly scoped (the
--      WHERE clause is the entire predicate) and safe to run twice: a second
--      run matches zero rows because the first run already moved them all.
--      No DELETE, no destructive ALTER -- migration 0037 revoked DELETE on
--      tenant data on purpose, and this migration does not need it.
--
--   2. Adds `task.source_key`, the idempotency key the new case-open task
--      seeding (same use case, "missing critical detail becomes an open
--      task") needs. `task.legacy_local_id` (migration 0046) is the same
--      shape of problem -- an opaque id written once, with a partial unique
--      index scoped per case -- but its column comment ties it explicitly to
--      the browser-store import path ("Opaque id of the browser-only task
--      ... Null for tasks created directly on the server"). A system-seeded
--      compliance task is created directly on the server; reusing
--      legacy_local_id for it would make that comment false for a growing
--      share of rows and would collide in meaning with a real future import
--      of the same case. A second, purpose-named column keeps both
--      idempotency mechanisms honest about what produced the row.
--
-- Backfilling seeded tasks for cases that already existed before this change
-- is deliberately NOT done here. Unlike the status backfill, it would not be
-- narrowly scoped -- it would require re-evaluating every case's current
-- document set against the three health factors and is a product decision
-- about historical noise (do families with years-old cases want three new
-- tasks appearing overnight?) rather than a data-correctness fix. Left as
-- future work; new tasks seed going forward from case creation.

update employment_case
   set status = 'active', updated_at = now()
 where status = 'draft';

alter table task add column if not exists source_key text;
comment on column task.source_key is
  'Deterministic idempotency key for a task the server generated on its own (e.g. case-open compliance seeding: "case_health:passport"), scoped per case. Distinct from legacy_local_id, which names only client-imported rows -- see this migration''s header comment. Null for a manually created or imported task.';

create unique index if not exists task_source_key_unique
  on task (tenant_id, employment_case_id, source_key)
  where source_key is not null;

insert into schema_migrations (version) values ('0047_case_born_active_and_task_source_key');
