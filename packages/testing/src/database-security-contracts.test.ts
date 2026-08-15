import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = (name: string) =>
  readFile(fileURLToPath(new URL(`../../../database/migrations/${name}`, import.meta.url)), 'utf8');

describe('database security migration contracts', () => {
  it('keeps tenant isolation fail-closed with forced RLS and WITH CHECK policies', async () => {
    const tenancy = await migration('0004_force_rls_and_with_check.sql');
    expect(tenancy).toMatch(/force row level security/iu);
    expect(tenancy).toMatch(/current_setting\('app\.tenant_id', true\)/u);
    expect(tenancy).toMatch(/with check\s*\(/iu);
  });

  it('keeps audit events append-only for the application role', async () => {
    const audit = await migration('0009_audit_event.sql');
    expect(audit).toMatch(/grant select, insert on audit_event to caredesk_app/iu);
    expect(audit).not.toMatch(/grant[^;]*(?:update|delete)[^;]*on audit_event/iu);
  });

  it('protects document reads and writes with RLS and same-tenant foreign keys', async () => {
    const documents = await migration('0008_documents.sql');
    expect(documents).toMatch(/document_tenant_isolation[\s\S]*?with check\s*\(/iu);
    expect(documents).toMatch(/document_version_tenant_isolation[\s\S]*?with check\s*\(/iu);
    expect(documents).toMatch(/document_case_same_tenant/iu);
    expect(documents).toMatch(/document_version_document_same_tenant/iu);
    expect(documents).toMatch(/document_current_version_same_tenant/iu);
  });

  it('prevents cross-tenant references in the employment case graph', async () => {
    const core = await migration('0003_care_employment_core.sql');
    expect(core).toMatch(/employment_case_recipient_same_tenant/iu);
    expect(core).toMatch(/employment_case_employer_same_tenant/iu);
    expect(core).toMatch(/employment_case_caregiver_same_tenant/iu);
  });

  it('keeps the application role unable to bypass authorization policies', async () => {
    const role = await migration('0005_app_role.sql');
    expect(role).toMatch(/alter role caredesk_app nobypassrls/iu);
    expect(role).not.toMatch(/alter role caredesk_app bypassrls/iu);
  });

  it('makes monthly-close evidence tenant-scoped, same-tenant and append-only', async () => {
    const close = await migration('0023_monthly_payroll_close.sql');
    expect(close).toMatch(/payroll_month_close_case_same_tenant/iu);
    expect(close).toMatch(/force row level security/iu);
    expect(close).toMatch(/using[\s\S]*with check/iu);
    expect(close).toMatch(/grant select, insert on payroll_month_close/iu);
    expect(close).not.toMatch(/grant[^;]*(?:update|delete)[^;]*on payroll_month_close/iu);
  });

  it('protects every Wave 5 fact with canonical RLS and same-tenant relationships', async () => {
    const wave5 = await migration('0025_wave5_collaboration_engagement.sql');
    for (const table of [
      'case_responsibility_assignment',
      'worker_portal_access',
      'worker_portal_invitation',
      'worker_payment_acknowledgement',
      'worker_request',
      'communication_preference',
      'notification_intent',
      'notification_delivery_attempt',
    ]) {
      expect(wave5).toContain(`'${table}'`);
    }
    expect(wave5).toMatch(/enable row level security/iu);
    expect(wave5).toMatch(/force row level security/iu);
    expect(wave5).toContain("current_setting(''app.tenant_id'', true)::uuid");
    expect(wave5).toMatch(/worker_ack_access_fk/iu);
    expect(wave5).toMatch(/grant select, insert on worker_payment_acknowledgement/iu);
    expect(wave5).not.toMatch(
      /grant[^;]*(?:update|delete)[^;]*on worker_payment_acknowledgement/iu,
    );
  });
});
