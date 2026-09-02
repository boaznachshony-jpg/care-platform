/**
 * Every migration version the code in this commit requires the database to
 * have applied.
 *
 * WHY THIS LIST EXISTS
 * --------------------
 * `/ready` used to prove "the database is migrated" by probing six named
 * objects with `to_regclass`. The newest of those six arrived in migration
 * 0021. Everything from 0023 onwards - payroll, month close, automation
 * receipts, escalation, binder exports, regulation rules, leave, scenario
 * expenses, workspace history - was invisible to the gate. A database
 * fourteen migrations behind the deployed code reported `ready: true`, and
 * the first customer to open the payroll screen got a 500.
 *
 * A hand-maintained probe list goes stale the moment someone forgets to
 * extend it. This list cannot: `scripts/check-migration-ledger.mjs` fails the
 * build when it does not match `database/migrations/` exactly, so adding a
 * migration and forgetting this file is a red lint, not a green deploy.
 *
 * The list is the filenames without `.sql`, which is exactly what the runner
 * writes into `schema_migrations`.
 */
export const REQUIRED_MIGRATIONS: readonly string[] = [
  '0001_baseline',
  '0002_identity_tenancy',
  '0003_care_employment_core',
  '0004_force_rls_and_with_check',
  '0005_app_role',
  '0006_organizations_and_contacts',
  '0007_tasks_and_timeline',
  '0008_documents',
  '0009_audit_event',
  '0010_actor_resolution',
  '0011_tenant_workspace',
  '0012_workspace_files',
  '0013_family_access',
  '0014_product_billing',
  '0015_lock_down_supabase_public_schema',
  '0016_restore_actor_resolution_grant',
  '0017_restore_missing_pilot_workspace',
  '0018_self_service_account_bootstrap',
  '0019_backfill_self_service_accounts',
  '0020_sprint_zero_database_hardening',
  '0021_visa_renewal_persistence',
  '0022_remaining_visa_renewal_persistence',
  '0023_monthly_payroll_close',
  '0024_wave4_automation',
  '0025_wave5_collaboration_engagement',
  '0026_canonical_product_intelligence',
  '0026_wave5_worker_authorization',
  '0027_product_differentiation_completion',
  '0028_canonical_payroll_entry',
  '0029_automation_execution_receipt',
  '0030_human_escalation_lifecycle',
  '0031_binder_export_receipt',
  '0032_regulation_rule_lifecycle',
  '0033_governed_leave_ledger',
  '0034_scenario_expense',
  '0035_workspace_version_history',
  '0036_billing_lifecycle_recovery',
  '0037_close_workspace_delete_hole',
  '0038_silent_data_loss_detection',
  '0039_workspace_file_tombstone',
  '0040_idempotency_record_lockable',
  '0041_payroll_total_reconciles',
  '0042_employment_case_legacy_client_link',
  '0043_terms_acceptance',
  '0044_app_role_reads_migration_ledger',
  '0045_money_is_a_model',
  '0046_mvp_local_data_server_migration',
];

/**
 * The required versions absent from `applied`, in migration order.
 *
 * Order matters for the operator: the oldest missing version is the one that
 * explains the failure, so it is reported first.
 */
export function missingMigrations(applied: Iterable<string>): string[] {
  const present = new Set(applied);
  return REQUIRED_MIGRATIONS.filter((version) => !present.has(version));
}
