import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const migrationUrl = new URL(
  '../../../database/migrations/0022_remaining_visa_renewal_persistence.sql',
  import.meta.url,
);

describe('remaining Visa Renewal persistence migration', () => {
  it('is additive and creates only the four missing canonical records', async () => {
    const sql = await readFile(migrationUrl, 'utf8');
    expect(sql.match(/create table /g)).toHaveLength(4);
    expect(sql).toContain('create table workflow_contact_activity');
    expect(sql).toContain('create table employment_authorization_link');
    expect(sql).toContain('create table authorization_overlap_review');
    expect(sql).toContain('create table workflow_completion');
    expect(sql).not.toMatch(/\b(drop|truncate|delete\s+from)\b/i);
  });

  it('forces complete tenant policies and same-tenant relationships', async () => {
    const sql = await readFile(migrationUrl, 'utf8');
    const tables = [
      'workflow_contact_activity',
      'employment_authorization_link',
      'authorization_overlap_review',
      'workflow_completion',
    ];
    for (const table of tables) {
      expect(sql).toContain(`alter table ${table} force row level security;`);
      expect(sql).toContain(`create policy ${table}_tenant_isolation on ${table}`);
      expect(sql).toContain(`using (tenant_id = current_setting('app.tenant_id', true)::uuid)`);
      expect(sql).toContain(
        `with check (tenant_id = current_setting('app.tenant_id', true)::uuid)`,
      );
    }
    expect(sql.match(/foreign key\s*\(tenant_id,/g)?.length).toBeGreaterThanOrEqual(17);
  });

  it('protects historical facts as append-only and constrains lifecycle state', async () => {
    const sql = await readFile(migrationUrl, 'utf8');
    expect(sql).toMatch(
      /grant select, insert on workflow_contact_activity, employment_authorization_link,\s*workflow_completion to caredesk_app;/,
    );
    expect(sql).not.toMatch(/grant[^;]*(update|delete)[^;]*workflow_completion/i);
    expect(sql).toContain('employment_authorization_link_distinct');
    expect(sql).toContain('authorization_overlap_review_resolution_consistent');
    expect(sql).toContain('workflow_completion_instance_unique');
    expect(sql).toContain('workflow_contact_activity_follow_up');
    expect(sql).toContain('authorization_overlap_review_open');
  });
});
