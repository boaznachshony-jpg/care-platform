import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * R5-09, stage 1 (migration 0049). The live guarantees run against a real
 * database in CI's postgres-rls job (rls-check.ts); this pins what the
 * migration text promises, so a later edit cannot quietly weaken it.
 */
const raw = readFileSync(
  new URL('../../../database/migrations/0049_national_insurance_report.sql', import.meta.url),
  'utf8',
);
/** Statements only: the comments explain at length what is deliberately absent. */
const sql = raw.replace(/--[^\n]*/g, '');

const TABLES = ['national_insurance_report', 'national_insurance_report_month'] as const;

describe('migration 0049 - National Insurance report tables', () => {
  it('creates exactly the two tables of the approved design and nothing else', () => {
    const created = [...sql.matchAll(/create table (\w+)/g)].map((match) => match[1]);
    expect(created).toEqual([...TABLES]);
  });

  it('is additive: it alters, drops or deletes nothing that already exists', () => {
    expect(sql).not.toMatch(/\balter table (?!national_insurance_report)/i);
    expect(sql).not.toMatch(/\b(drop|truncate)\b/i);
    expect(sql).not.toMatch(/\bdelete from\b/i);
    expect(sql).not.toMatch(/\bupdate \w+ set\b/i);
  });

  it.each(TABLES)('forces tenant RLS on %s with a USING and WITH CHECK policy', (table) => {
    expect(sql).toContain(`alter table ${table} enable row level security`);
    expect(sql).toContain(`alter table ${table} force row level security`);
    expect(sql).toMatch(
      new RegExp(
        `create policy ${table}_tenant_isolation on ${table}\\s+` +
          `using \\(tenant_id = current_setting\\('app\\.tenant_id', true\\)::uuid\\)\\s+` +
          `with check \\(tenant_id = current_setting\\('app\\.tenant_id', true\\)::uuid\\)`,
      ),
    );
  });

  it.each(TABLES)('grants %s select, insert and update - never delete', (table) => {
    expect(sql).toContain(`grant select, insert, update on ${table} to caredesk_app`);
    expect(sql).not.toMatch(new RegExp(`grant[^;]*\\bdelete\\b[^;]*\\b${table}\\b`, 'i'));
  });

  it('keeps a report in its case tenant, and a line in its report tenant', () => {
    expect(sql).toMatch(
      /foreign key \(tenant_id, employment_case_id\)\s+references employment_case \(tenant_id, id\)/,
    );
    expect(sql).toMatch(
      /foreign key \(tenant_id, report_id\)\s+references national_insurance_report \(tenant_id, id\)/,
    );
  });

  it('makes a repeated copy of one payment idempotent per case', () => {
    expect(sql).toMatch(
      /create unique index national_insurance_report_legacy_expense_unique\s+on national_insurance_report \(tenant_id, employment_case_id, legacy_expense_id\)\s+where legacy_expense_id is not null/,
    );
  });

  it('holds one line per month, in whole shekels, carrying nothing in a month not employed', () => {
    expect(sql).toContain('unique (report_id, month)');
    expect(sql).toContain('wage integer not null check (wage between 0 and 10000000)');
    expect(sql).toContain(
      'rate_percent numeric(5, 2) not null check (rate_percent between 0 and 100)',
    );
    expect(sql).toContain('check (employed or (wage = 0 and amount = 0))');
  });

  it('records itself in the migration ledger', () => {
    expect(sql).toContain(
      "insert into schema_migrations (version) values ('0049_national_insurance_report');",
    );
  });
});
