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
});
