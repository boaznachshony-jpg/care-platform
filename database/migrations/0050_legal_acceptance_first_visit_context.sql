-- A third moment at which a legal acceptance can be collected: 'first-visit'.
--
-- WHAT WAS MISSING
-- ----------------
-- Migration 0043 allowed two contexts, 'onboarding' and 'billing', because
-- those were the two screens that collected an acceptance. Both are screens
-- only the account OWNER ever reaches: an invited manager or viewer signs in
-- through the family-access invitation, lands on the dashboard, and is shown
-- neither. The privacy policy (section 4) states that acceptance by
-- "authorised users" is recorded. Until now nothing recorded it - there was no
-- screen and, had one existed, this check constraint would have rejected its
-- rows.
--
-- The web app now mounts a consent gate on the first authenticated visit of
-- any user who has no acceptance on record at the current document versions
-- (apps/web/src/components/LegalConsentGate.tsx). Rows written by that gate
-- carry context 'first-visit', so a later question about a specific
-- acceptance can still be traced back to a specific screen, which is the only
-- reason the column exists (0043: "Not a legal field").
--
-- WHY THE CONSTRAINT IS REPLACED RATHER THAN DROPPED
-- --------------------------------------------------
-- The enumeration is kept - a free-text context would let a typo become a new
-- category nobody can query for. PostgreSQL cannot alter a check constraint in
-- place, so the constraint is dropped and re-created with the wider set in the
-- same transaction. The constraint name is the one PostgreSQL assigned to the
-- inline `check (context in (...))` in 0043: <table>_<column>_check.
--
-- ADDITIVE
-- --------
-- No table dropped, no column dropped or retyped, no row deleted or rewritten.
-- Every row that satisfied the old constraint satisfies the new one, so the
-- re-created constraint validates against existing data without rejecting
-- anything. The mirror constant is LEGAL_ACCEPTANCE_CONTEXTS in
-- packages/schemas/src/legal-acceptance.ts.

alter table terms_acceptance
  drop constraint terms_acceptance_context_check;

alter table terms_acceptance
  add constraint terms_acceptance_context_check
  check (context in ('onboarding', 'billing', 'first-visit'));

insert into schema_migrations (version) values ('0050_legal_acceptance_first_visit_context');
