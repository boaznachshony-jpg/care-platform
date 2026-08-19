import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  new URL('../../../database/migrations/0032_regulation_rule_lifecycle.sql', import.meta.url),
  'utf8',
);

describe('regulation rule lifecycle persistence', () => {
  it('forces tenant RLS with a with-check policy on both tables', () => {
    for (const table of ['regulation_rule', 'regulation_rule_transition']) {
      expect(sql).toContain(`alter table ${table} enable row level security`);
      expect(sql).toContain(`alter table ${table} force row level security`);
      expect(sql).toMatch(
        new RegExp(
          `policy ${table}_tenant_isolation[\\s\\S]*?using \\(tenant_id = current_setting\\('app\\.tenant_id', true\\)::uuid\\)[\\s\\S]*?with check \\(tenant_id = current_setting\\('app\\.tenant_id', true\\)::uuid\\)`,
          'i',
        ),
      );
    }
  });

  it('constrains the lifecycle to draft/in_review/approved/active/retired', () => {
    expect(sql).toContain(
      "check (status in ('draft', 'in_review', 'approved', 'active', 'retired'))",
    );
  });

  it('requires review, activation and retirement evidence to be consistent', () => {
    expect(sql).toMatch(
      /regulation_rule_review_consistent check[\s\S]*?reviewed_by is not null and reviewed_at is not null/,
    );
    expect(sql).toMatch(
      /regulation_rule_activation_consistent check[\s\S]*?activated_at is not null/,
    );
    expect(sql).toMatch(
      /regulation_rule_retirement_consistent check[\s\S]*?retired_at is not null/,
    );
    // Activation always presupposes a known effective start date.
    expect(sql).toMatch(/regulation_rule_active_effective check[\s\S]*?effective_from is not null/);
  });

  it('keeps transition history append-only and idempotency observable', () => {
    expect(sql).toContain('grant select, insert on regulation_rule_transition to caredesk_app');
    expect(sql).not.toMatch(/grant[^;]*\b(update|delete)\b[^;]*regulation_rule_transition/i);
    expect(sql).toMatch(/unique \(tenant_id, idempotency_key\)/);
    expect(sql).not.toMatch(/grant[^;]*\bdelete\b[^;]*\bregulation_rule\b/i);
  });

  it('seeds reviewed content as approved-with-provenance, never active', () => {
    // Seeded for every existing tenant, explicitly approved (a manager still
    // activates), permanently flagged as requiring professional validation.
    expect(sql).toMatch(/from tenant t\s+cross join/);
    expect(sql).toContain("'approved'");
    expect(sql).toContain('requires_professional_validation');
    for (const ruleKey of [
      'weekly_rest_day',
      'medical_insurance_obligation',
      'written_employment_contract',
      'visa_validity_tracking',
    ]) {
      expect(sql).toContain(`'${ruleKey}'`);
    }
    // Source citations are present for every seeded statement.
    expect(sql).toContain('חוק שעות עבודה ומנוחה');
    expect(sql).toContain('חוק עובדים זרים');
    expect(sql).toContain('חוק הכניסה לישראל');
    // The seed never activates content directly.
    expect(sql).not.toMatch(/insert into regulation_rule[\s\S]*?'active'/);
  });

  it('records itself in schema_migrations', () => {
    expect(sql).toContain(
      "insert into schema_migrations (version) values ('0032_regulation_rule_lifecycle')",
    );
  });
});
