import { readFileSync } from 'node:fs';
import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import {
  measureNationalInsuranceReports,
  type ReportLine,
  type StoredReport,
} from './national-insurance-reconciliation.js';
import { PgTenantCensusRepository } from './tenant-census-repository.js';

/** R5-09 stage 3: the measurement that gates the cutover (migration 0050). */

// Synthetic figures only.
const LINES: ReportLine[] = [
  { month: '2026-07', employed: true, wage: 6000, ratePercent: 3.55, amount: 213 },
  { month: '2026-08', employed: true, wage: 6000, ratePercent: 3.55, amount: 213 },
  { month: '2026-09', employed: false, wage: 0, ratePercent: 3.55, amount: 0 },
];
const EXPENSES_STORAGE_NAME = 'caredesk.mvp.employment-expenses.v1';
const clientKey = (clientId: string) => `${EXPENSES_STORAGE_NAME}.client.${clientId}`;

const payment = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  category: 'ביטוח לאומי',
  frequency: 'quarterly',
  amount: 426,
  dueDate: '2026-10-15',
  status: 'upcoming',
  note: '',
  savedAt: '2026-10-17T10:00:00.000Z',
  nationalInsuranceMonths: LINES,
  ...overrides,
});
const report = (overrides: Partial<StoredReport> = {}): StoredReport => ({
  legacyClientId: 'client-a',
  legacyExpenseId: 'expense-ni-q3',
  dueDate: '2026-10-15',
  months: LINES,
  ...overrides,
});
const entries = (map: Record<string, unknown[]>) =>
  Object.fromEntries(Object.entries(map).map(([key, list]) => [key, JSON.stringify(list)]));

describe('measureNationalInsuranceReports', () => {
  it('counts only payments that carry report lines, across every client key', () => {
    const result = measureNationalInsuranceReports(
      entries({
        [clientKey('client-a')]: [
          payment('expense-ni-q3'),
          payment('no-lines', { nationalInsuranceMonths: undefined }),
        ],
        [clientKey('client-b')]: [payment('expense-ni-q3')],
        'caredesk.mvp.tasks.v1': [{ id: 'task' }],
      }),
      [],
    );
    expect(result).toEqual({ workspaceReports: 2, unreconciledReports: 2 });
  });

  it('reports zero when every payment has an identical copy', () => {
    expect(
      measureNationalInsuranceReports(
        entries({ [clientKey('client-a')]: [payment('expense-ni-q3')] }),
        [report()],
      ),
    ).toEqual({ workspaceReports: 1, unreconciledReports: 0 });
  });

  it.each([
    ['not copied at all', []],
    [
      'copied before a correction',
      [report({ months: [{ ...LINES[0]!, wage: 5900 }, LINES[1]!, LINES[2]!] })],
    ],
    ['copied with another due date', [report({ dueDate: '2026-10-16' })]],
    ['missing a month', [report({ months: LINES.slice(0, 2) })]],
    [
      'holding an extra month',
      [report({ months: [...LINES, { ...LINES[2]!, month: '2026-10' }] })],
    ],
    [
      'an amount off by one agora',
      [report({ months: [{ ...LINES[0]!, amount: 213.01 }, LINES[1]!, LINES[2]!] })],
    ],
  ])('counts a payment %s as unreconciled', (_label, reports) => {
    expect(
      measureNationalInsuranceReports(
        entries({ [clientKey('client-a')]: [payment('expense-ni-q3')] }),
        reports as StoredReport[],
      ).unreconciledReports,
    ).toBe(1);
  });

  /**
   * The automatic payment's id is built from the quarter alone, so two clients
   * of one account share it. A match on the id alone would count client B as
   * copied on the strength of client A's report - the false zero this
   * measurement exists to never give.
   */
  it('never lets one client report reconcile another client payment with the same id', () => {
    const result = measureNationalInsuranceReports(
      entries({
        [clientKey('client-a')]: [payment('expense-ni-q3')],
        [clientKey('client-b')]: [payment('expense-ni-q3')],
      }),
      [report({ legacyClientId: 'client-a' })],
    );
    expect(result).toEqual({ workspaceReports: 2, unreconciledReports: 1 });
  });

  it('matches an unsuffixed key to the legacy:unscoped client', () => {
    expect(
      measureNationalInsuranceReports(
        entries({ [EXPENSES_STORAGE_NAME]: [payment('expense-ni-q3')] }),
        [report({ legacyClientId: 'legacy:unscoped' })],
      ),
    ).toEqual({ workspaceReports: 1, unreconciledReports: 0 });
  });

  it('keeps a payment with a malformed line unreconciled instead of skipping it', () => {
    const malformed = payment('expense-ni-q3', {
      nationalInsuranceMonths: [LINES[0], { month: '2026-08', wage: 'six thousand' }, LINES[2]],
    });
    expect(
      measureNationalInsuranceReports(entries({ [clientKey('client-a')]: [malformed] }), [
        report(),
      ]),
    ).toEqual({ workspaceReports: 1, unreconciledReports: 1 });
  });

  it('compares a stored numeric text rate and amount by value', () => {
    const fromDatabase = report({
      months: LINES.map((line) => ({
        ...line,
        ratePercent: Number('3.55'),
        amount: Number(line.amount.toFixed(2)),
      })),
    });
    expect(
      measureNationalInsuranceReports(
        entries({ [clientKey('client-a')]: [payment('expense-ni-q3')] }),
        [fromDatabase],
      ).unreconciledReports,
    ).toBe(0);
  });
});

/**
 * The scan's own path: census function -> workspace payload -> report tables
 * -> one census row with the two new columns, every statement inside the
 * role/tenant envelope. A pg-shaped stub, as in payroll-entry-service.test.ts.
 */
describe('PgTenantCensusRepository - National Insurance measurement', () => {
  const TENANT = '00000000-0000-4000-8000-000000000001';

  function stubPool(reportsCopied: boolean, reportQueryFails = false) {
    const statements: Array<{ sql: string; values: unknown[] }> = [];
    const client = {
      query: async (text: string, values: unknown[] = []) => {
        const sql = text.replace(/\s+/g, ' ').trim().toLowerCase();
        statements.push({ sql, values });
        if (
          sql === 'begin' ||
          sql === 'commit' ||
          sql === 'rollback' ||
          sql.startsWith('set local role') ||
          sql.includes('set_config')
        )
          return { rows: [], rowCount: 0 };
        if (sql.startsWith('select * from caredesk_tenant_data_census()'))
          return {
            rows: [
              {
                tenant_id: TENANT,
                workspace_version: 3,
                workspace_payload_bytes: '512',
                workspace_history_versions: 2,
                workspace_file_rows: 0,
                document_rows: 0,
                task_rows: 0,
                employment_case_rows: 1,
                payroll_entry_rows: 0,
              },
            ],
            rowCount: 1,
          };
        if (sql.startsWith('select payload from tenant_workspace'))
          return {
            rows: [
              {
                // Plaintext payload: decryptPayload passes it through unchanged.
                payload: entries({
                  [clientKey('client-a')]: [payment('expense-ni-q3'), payment('expense-ni-q2')],
                }),
              },
            ],
            rowCount: 1,
          };
        if (reportQueryFails && sql.includes('from national_insurance_report'))
          throw new Error('relation does not exist');
        if (sql.includes('from national_insurance_report r join employment_case c'))
          return reportsCopied
            ? {
                rows: [
                  {
                    id: 'r1',
                    legacy_client_id: 'client-a',
                    legacy_expense_id: 'expense-ni-q3',
                    due_date: '2026-10-15',
                  },
                ],
                rowCount: 1,
              }
            : { rows: [], rowCount: 0 };
        if (sql.includes('from national_insurance_report_month'))
          return {
            rows: LINES.map((line) => ({
              report_id: 'r1',
              month: line.month,
              employed: line.employed,
              wage: line.wage,
              rate_percent: line.ratePercent.toFixed(2),
              amount: line.amount.toFixed(2),
            })),
            rowCount: LINES.length,
          };
        if (sql.startsWith('insert into tenant_data_census')) return { rows: [], rowCount: 1 };
        throw new Error(`unexpected sql in stub: ${text}`);
      },
      release: () => undefined,
    };
    return { pool: { connect: async () => client } as unknown as Pool, statements };
  }

  it('measures the tenant and records both new columns', async () => {
    const { pool, statements } = stubPool(true);
    const repository = new PgTenantCensusRepository(pool);
    const [census] = await repository.collect();
    expect(census).toMatchObject({
      tenantId: TENANT,
      nationalInsuranceWorkspaceReports: 2,
      // Q3 is copied identically; Q2 is not copied at all.
      nationalInsuranceUnreconciledReports: 1,
    });

    await repository.record(census!);
    const insert = statements.find((statement) =>
      statement.sql.startsWith('insert into tenant_data_census'),
    );
    expect(insert?.sql).toContain(
      'national_insurance_workspace_reports, national_insurance_unreconciled_reports',
    );
    expect(insert?.values.slice(-2)).toEqual([2, 1]);
    // Every read and write ran inside the role/tenant envelope (Root 6).
    expect(
      statements.filter((statement) => statement.sql.startsWith('set local role')).length,
    ).toBeGreaterThan(0);
  });

  it('never lets a failed measurement stop the data-loss census', async () => {
    const { pool } = stubPool(true, true);
    const [census] = await new PgTenantCensusRepository(pool).collect();
    expect(census).toMatchObject({
      tenantId: TENANT,
      workspacePopulatedEntries: 1,
      nationalInsuranceWorkspaceReports: null,
      nationalInsuranceUnreconciledReports: null,
    });
  });

  it('records zero copied when the table is still empty', async () => {
    const { pool } = stubPool(false);
    const [census] = await new PgTenantCensusRepository(pool).collect();
    expect(census).toMatchObject({
      nationalInsuranceWorkspaceReports: 2,
      nationalInsuranceUnreconciledReports: 2,
    });
  });
});

describe('migration 0050', () => {
  const sql = readFileSync(
    new URL(
      '../../../database/migrations/0050_census_national_insurance_reconciliation.sql',
      import.meta.url,
    ),
    'utf8',
  ).replace(/--[^\n]*/g, '');

  it('only adds two nullable, non-negative count columns to the census', () => {
    const statements = sql
      .split(';')
      .map((statement) => statement.trim())
      .filter(Boolean);
    expect(statements.filter((statement) => statement.startsWith('alter table'))).toHaveLength(2);
    expect(sql).not.toMatch(/\b(drop|truncate|delete from|rename|not null|set default)\b/i);
    expect(sql).toMatch(/add column national_insurance_workspace_reports integer/);
    expect(sql).toMatch(/add column national_insurance_unreconciled_reports integer/);
    expect(sql).toContain(
      "insert into schema_migrations (version) values ('0050_census_national_insurance_reconciliation')",
    );
  });
});
