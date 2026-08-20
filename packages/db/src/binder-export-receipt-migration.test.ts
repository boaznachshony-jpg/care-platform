import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  new URL('../../../database/migrations/0031_binder_export_receipt.sql', import.meta.url),
  'utf8',
);

describe('binder export receipt persistence', () => {
  it('forces tenant RLS with a with-check policy', () => {
    expect(sql).toContain('alter table binder_export_receipt enable row level security');
    expect(sql).toContain('alter table binder_export_receipt force row level security');
    expect(sql).toMatch(
      new RegExp(
        `policy binder_export_receipt_tenant_isolation[\\s\\S]*using \\(tenant_id = current_setting\\('app\\.tenant_id', true\\)::uuid\\)[\\s\\S]*with check \\(tenant_id = current_setting\\('app\\.tenant_id', true\\)::uuid\\)`,
        'i',
      ),
    );
  });

  it('is append-only for the application role — select and insert, never update or delete', () => {
    expect(sql).toContain('grant select, insert on binder_export_receipt to caredesk_app');
    expect(sql).not.toMatch(/grant[^;]*\b(update|delete)\b[^;]*binder_export_receipt/i);
  });

  it('pins receipts to a case in the same tenant', () => {
    expect(sql).toMatch(
      /foreign key \(tenant_id, employment_case_id\)\s*references employment_case \(tenant_id, id\)/,
    );
  });

  it('constrains the evidence columns', () => {
    expect(sql).toContain("check (jsonb_typeof(manifest) = 'object')");
    expect(sql).toContain("check (content_hash ~ '^[0-9a-f]{64}$')");
    expect(sql).toContain("check (hash_algorithm = 'sha256')");
    expect(sql).toContain('created_by uuid not null');
  });

  it('creates no sharing surface — receipts are evidence, not access', () => {
    // The receipt table is the only table this migration introduces: no
    // share-link, token, or bundle tables exist for the Binder (fail-closed).
    const createdTables = [...sql.matchAll(/create table (\w+)/g)].map((match) => match[1]);
    expect(createdTables).toEqual(['binder_export_receipt']);
  });
});
