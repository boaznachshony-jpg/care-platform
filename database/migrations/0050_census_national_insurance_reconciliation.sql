-- R5-09, stage 3: the nightly measurement that gates the cutover.
--
-- Design approved by the owner on 17.10.2026:
-- docs/governance/R5-09-NATIONAL-INSURANCE-REPORT-TABLE.md, section 6. The
-- write authority for National Insurance report lines moves from the
-- workspace to the table of migration 0049 only once every report saved in
-- the workspace has an identical copy in the table - measured, not assumed -
-- and the field is removed from the workspace only after 30 days without a
-- gap. These two columns are that measurement, one row per tenant per night,
-- written by the existing data-integrity scan (0038).
--
-- Additive only: two nullable columns. Null means "not measured" (no
-- workspace row, or a workspace that would not decrypt), which is a different
-- answer from zero and must not collapse into it. No existing value changes,
-- and the grants of 0038 (select, insert) already cover new columns.

alter table tenant_data_census
  add column national_insurance_workspace_reports integer
    check (national_insurance_workspace_reports is null or national_insurance_workspace_reports >= 0);

alter table tenant_data_census
  add column national_insurance_unreconciled_reports integer
    check (
      national_insurance_unreconciled_reports is null
      or national_insurance_unreconciled_reports >= 0
    );

comment on column tenant_data_census.national_insurance_workspace_reports is
  'R5-09: saved National Insurance payments that carry report lines in the workspace snapshot.';
comment on column tenant_data_census.national_insurance_unreconciled_reports is
  'R5-09: of those, how many have no identical copy (same months, figures and due date) in national_insurance_report. The stage 3 cutover waits for zero.';

insert into schema_migrations (version) values ('0050_census_national_insurance_reconciliation');
