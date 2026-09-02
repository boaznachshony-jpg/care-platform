-- Companion to 0047's task.source_key: the application layer now closes a
-- seeded compliance task (case_health:passport / case_health:visa /
-- case_health:medical_insurance) the moment a currently-valid document of the
-- matching type lands on a case (see
-- packages/application/src/use-cases/manage-case-documents.ts,
-- completeMatchingSeededTask). That trigger only fires on a NEW document
-- upload/import from here on.
--
-- A case opened between 0047 shipping and this change can already hold both a
-- valid document AND its still-open seeded task -- nobody uploaded anything
-- new since, so the trigger never ran for it. Left alone, that family sees a
-- task asking for a document that is already on file: exactly the "list that
-- lies" this whole change exists to fix, just from the other direction.
--
-- Unlike 0047's own backfill decision (which explicitly left task seeding
-- for pre-existing cases as future work, because seeding a task is a product
-- call about historical noise), THIS backfill is not optional in the same
-- way: it only ever CLOSES a task whose stated purpose ("get us a document
-- of type X") is already, verifiably true according to data already in this
-- database (task.source_key + document.compliance_status). There is no
-- judgment call about whether the family wants three new tasks -- there is
-- only a task lying about the case's current state, and this file is the
-- one-time catch-up that stops it.
--
-- Scoped narrowly and safe to run twice:
--   - Only tasks with a source_key this application seeds (the three
--     case_health:* keys), that are still 'open', are touched.
--   - Only when a document of the matching type exists on the SAME case with
--     compliance_status = 'valid' right now.
--   - completed_by is left null: no human completed these, matching
--     AuditEventInput.actorId's null-for-system-actor convention used by the
--     application-layer trigger this backfill mirrors.
--   - A second run matches zero rows, because the first run already moved
--     every eligible task out of 'open'.
--
-- No DELETE, no destructive ALTER -- migration 0037 revoked DELETE on tenant
-- data on purpose, and this migration does not need it. This UPDATE is also
-- exactly the operation task.source_key's partial unique index (0047) exists
-- to make safe: it can never produce a duplicate row, because it only ever
-- transitions the one existing row for a given (tenant, case, source_key).

update task
   set status = 'completed',
       completed_at = now(),
       completed_by = null,
       updated_at = now(),
       updated_by = null,
       version = version + 1
 where status = 'open'
   and source_key in (
     'case_health:passport',
     'case_health:visa',
     'case_health:medical_insurance'
   )
   and exists (
     select 1
       from document d
      where d.tenant_id = task.tenant_id
        and d.employment_case_id = task.employment_case_id
        and d.compliance_status = 'valid'
        -- 'insurance_policy', not 'medical_insurance': the task's source_key
        -- names the fact ("medical insurance"), but document.document_type's
        -- check constraint (migration 0008) has no 'medical_insurance' value
        -- — only 'insurance_policy' does. Same fix applied in
        -- packages/application/src/use-cases/case-health-factors.ts and
        -- apps/api/src/routes/product-differentiation.ts alongside this
        -- migration; a mismatch here would silently backfill zero medical
        -- insurance rows.
        and d.document_type = case task.source_key
              when 'case_health:passport' then 'passport'
              when 'case_health:visa' then 'visa'
              when 'case_health:medical_insurance' then 'insurance_policy'
            end
   );

insert into schema_migrations (version) values ('0048_backfill_seeded_task_completion');
