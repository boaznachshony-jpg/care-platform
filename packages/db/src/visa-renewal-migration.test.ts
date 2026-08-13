import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const migrationUrl = new URL(
  '../../../database/migrations/0021_visa_renewal_persistence.sql',
  import.meta.url,
);

describe('Visa Renewal persistence migration', () => {
  it('forces RLS and supplies tenant policies for every tenant-owned table', async () => {
    const sql = await readFile(migrationUrl, 'utf8');
    const tables = [
      'employment_authorization',
      'workflow_instance',
      'workflow_rule_evaluation',
      'workflow_evaluation_source',
      'workflow_step',
      'workflow_assignment',
      'workflow_blocker',
      'idempotency_record',
    ];
    for (const table of tables) {
      expect(sql).toContain(`alter table ${table} force row level security;`);
      expect(sql).toContain(`create policy ${table}_tenant_isolation on ${table}`);
      expect(sql).toContain(
        `with check (tenant_id = current_setting('app.tenant_id', true)::uuid)`,
      );
    }
  });

  it('uses same-tenant workflow foreign keys and append-only delivery grants', async () => {
    const sql = await readFile(migrationUrl, 'utf8');
    expect(sql).toMatch(/foreign key\s*\(tenant_id, employment_case_id\)/);
    expect(sql).toMatch(/foreign key\s*\(tenant_id, workflow_instance_id\)/);
    expect(sql).toMatch(/foreign key\s*\(tenant_id, workflow_step_id\)/);
    expect(sql).toContain('grant select, insert on idempotency_record to caredesk_app;');
    expect(sql).not.toMatch(/grant[^;]*update[^;]*idempotency_record/i);
  });
});
