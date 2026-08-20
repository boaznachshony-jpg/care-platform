import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const sql = readFileSync(
  new URL('../../../database/migrations/0029_automation_execution_receipt.sql', import.meta.url),
  'utf8',
);
describe('automation execution receipt persistence', () => {
  it('forces tenant RLS for automation_execution_receipt', () => {
    expect(sql).toContain('alter table automation_execution_receipt enable row level security');
    expect(sql).toContain('alter table automation_execution_receipt force row level security');
    expect(sql).toMatch(
      new RegExp(
        `policy automation_execution_receipt_tenant_isolation[\\s\\S]*using \\(tenant_id = current_setting\\('app\\.tenant_id', true\\)::uuid\\)[\\s\\S]*with check \\(tenant_id = current_setting\\('app\\.tenant_id', true\\)::uuid\\)`,
        'i',
      ),
    );
  });
  it('guarantees replay uniqueness per tenant, operation and idempotency key', () => {
    expect(sql).toMatch(/unique \(tenant_id, operation, idempotency_key\)/);
  });
  it('binds the receipt to a same-tenant employment case', () => {
    expect(sql).toMatch(
      /foreign key[\s\S]*\(tenant_id, employment_case_id\) references employment_case \(tenant_id, id\)/,
    );
  });
  it('keeps completed receipts evidence-consistent and never grants delete', () => {
    expect(sql).toMatch(
      /check \(\(status = 'completed'\) = \(response is not null and completed_at is not null\)\)/,
    );
    expect(sql).toContain(
      'grant select, insert, update on automation_execution_receipt to caredesk_app',
    );
    expect(sql).not.toMatch(/grant[^;]*delete[^;]*automation_execution_receipt/i);
  });
  it('covers both automation operations', () => {
    expect(sql).toContain("operation in ('checklist_confirmation', 'event_plan_commit')");
  });
});
