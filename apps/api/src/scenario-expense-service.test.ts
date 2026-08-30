import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { ScenarioExpenseService, type ScenarioExpenseInput } from './scenario-expense-service.js';

const MIGRATION = readFileSync(
  fileURLToPath(new URL('../../../database/migrations/0034_scenario_expense.sql', import.meta.url)),
  'utf8',
);

const TENANT_ID = '00000000-0000-4000-8000-000000000001';
const CASE_ID = '00000000-0000-4000-8000-000000000011';
const ACTOR = {
  tenantId: TENANT_ID,
  userId: '00000000-0000-4000-8000-000000000002',
  correlationId: 'corr-scenario-1',
};

// Synthetic amounts only — no real person's expenses appear in fixtures.
const EXPENSE: ScenarioExpenseInput = {
  label: 'Synthetic insurance renewal',
  amount: 250,
  kind: 'recurring',
  startMonth: '2026-09',
  endMonth: '2027-02',
};

interface RecordedQuery {
  text: string;
  values?: unknown[];
}

interface StoredExpense {
  id: string;
  caseId: string;
  version: number;
  status: string;
  row: Record<string, unknown>;
}

/**
 * A pg-shaped stateful stub, in the same spirit as payroll-entry-service.test.ts:
 * the value under test is the SQL the service emits, its transaction envelope
 * and its durable-receipt behaviour. The stub answers the service's own
 * statements and fails loudly on any statement it does not recognise.
 */
function stubPool(knownCaseIds: string[]) {
  const queries: RecordedQuery[] = [];
  const receipts = new Map<string, { hash: string; response: unknown }>();
  const expenses = new Map<string, StoredExpense>();
  const now = new Date('2026-08-19T10:00:00.000Z');

  const rowFrom = (
    id: unknown,
    values: { label: unknown; amount: unknown; kind: unknown; start: unknown; end: unknown },
    version: number,
    status: string,
  ): Record<string, unknown> => ({
    id,
    label: values.label,
    amount: String(values.amount),
    kind: values.kind,
    start_month: `${String(values.start)}-01`,
    end_month: values.end === null ? null : `${String(values.end)}-01`,
    status,
    version,
    created_at: now,
    updated_at: now,
  });

  const client = {
    query: async (text: string, values?: unknown[]) => {
      queries.push({ text, values });
      const sql = text.toLowerCase();
      if (
        sql === 'begin' ||
        sql === 'commit' ||
        sql === 'rollback' ||
        // Root 6 (API-01): withTenant() switches to caredesk_app before it sets
        // the tenant. The stub must let it through, and the assertions below
        // require it to have happened.
        sql.startsWith('set local role') ||
        sql.includes('set_config')
      ) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('select 1 from employment_case')) {
        return { rows: [], rowCount: knownCaseIds.includes(String(values?.[0])) ? 1 : 0 };
      }
      if (sql.startsWith('select request_hash,response from idempotency_record')) {
        const operation = sql.includes("operation='scenario_expense.delete'") ? 'delete' : 'save';
        const receipt = receipts.get(`${operation}|${String(values?.[0])}`);
        return receipt
          ? { rows: [{ request_hash: receipt.hash, response: receipt.response }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (sql.startsWith('select version from scenario_expense')) {
        const found = expenses.get(String(values?.[0]));
        return found && found.status === 'active' && found.caseId === String(values?.[1])
          ? { rows: [{ version: found.version }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (sql.startsWith('select') && sql.includes('from scenario_expense')) {
        const rows = [...expenses.values()]
          .filter(
            (expense) => expense.caseId === String(values?.[0]) && expense.status === 'active',
          )
          .map((expense) => expense.row);
        return { rows, rowCount: rows.length };
      }
      if (sql.startsWith('insert into scenario_expense')) {
        const row = rowFrom(
          values?.[0],
          {
            label: values?.[3],
            amount: values?.[4],
            kind: values?.[5],
            start: values?.[6],
            end: values?.[7] ?? null,
          },
          1,
          'active',
        );
        expenses.set(String(values?.[0]), {
          id: String(values?.[0]),
          caseId: String(values?.[2]),
          version: 1,
          status: 'active',
          row,
        });
        return { rows: [row], rowCount: 1 };
      }
      if (sql.startsWith("update scenario_expense set status='deleted'")) {
        const found = expenses.get(String(values?.[0]))!;
        found.status = 'deleted';
        found.version += 1;
        found.row = { ...found.row, status: 'deleted', version: found.version };
        return { rows: [found.row], rowCount: 1 };
      }
      if (sql.startsWith('update scenario_expense set label=')) {
        const found = expenses.get(String(values?.[0]))!;
        found.version += 1;
        found.row = rowFrom(
          values?.[0],
          {
            label: values?.[2],
            amount: values?.[3],
            kind: values?.[4],
            start: values?.[5],
            end: values?.[6] ?? null,
          },
          found.version,
          'active',
        );
        return { rows: [found.row], rowCount: 1 };
      }
      if (
        sql.startsWith('insert into audit_event') ||
        sql.startsWith('insert into timeline_event')
      ) {
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith('insert into idempotency_record')) {
        const operation = sql.includes("'scenario_expense.delete'") ? 'delete' : 'save';
        receipts.set(`${operation}|${String(values?.[1])}`, {
          hash: String(values?.[2]),
          response: JSON.parse(String(values?.[3])),
        });
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`unexpected sql in stub: ${text}`);
    },
    release: () => undefined,
  };
  const pool = { connect: async () => client } as unknown as Pool;
  return { pool, queries };
}

const expenseInserts = (queries: RecordedQuery[]) =>
  queries.filter((query) => query.text.toLowerCase().startsWith('insert into scenario_expense'));

describe('ScenarioExpenseService.save', () => {
  it('creates the expense inside a tenant-scoped transaction with audit, timeline and receipt', async () => {
    const { pool, queries } = stubPool([CASE_ID]);
    const service = new ScenarioExpenseService(pool);

    const result = await service.save(ACTOR, CASE_ID, 'scenario-key-0001', EXPENSE);

    expect(result.replayed).toBe(false);
    expect(result.expense).toMatchObject({
      label: EXPENSE.label,
      amount: 250,
      kind: 'recurring',
      startMonth: '2026-09',
      endMonth: '2027-02',
      version: 1,
      status: 'active',
    });

    const statements = queries.map((query) => query.text.toLowerCase());
    // Root 6 (API-01): the role assertion is the one that was missing. This
    // test previously checked `begin` then `set_config` and passed against a
    // private transaction helper that never switched off whatever role the
    // pooled connection carried - which under an administrative DATABASE_URL
    // means BYPASSRLS and no tenant policy at all. Asserting the exact prologue
    // pins the service to withTenant() rather than to a lookalike.
    expect(statements[0]).toBe('begin');
    expect(statements[1]).toBe('set local role caredesk_app');
    expect(statements[2]).toContain('set_config');
    expect(queries[2]?.values).toEqual([TENANT_ID]);
    expect(statements.at(-1)).toBe('commit');

    const audit = queries.find((query) => query.text.includes('insert into audit_event'));
    expect(audit?.values).toContain('payroll.scenario_expense_created');
    expect(audit?.values).toContain(ACTOR.correlationId);
    expect(audit?.text).toContain("'financial_sensitive'");

    const timeline = queries.find((query) => query.text.includes('insert into timeline_event'));
    expect(timeline?.values).toContain('payroll.scenario_expense_created');

    const receipt = queries.find((query) => query.text.includes('insert into idempotency_record'));
    expect(receipt?.text).toContain("'scenario_expense.save'");
    expect(receipt?.values?.[0]).toBe(TENANT_ID);
  });

  it('replays the durable receipt for the same key without writing a second time', async () => {
    const { pool, queries } = stubPool([CASE_ID]);
    const service = new ScenarioExpenseService(pool);

    const first = await service.save(ACTOR, CASE_ID, 'scenario-key-0002', EXPENSE);
    const second = await service.save(ACTOR, CASE_ID, 'scenario-key-0002', EXPENSE);

    expect(second.replayed).toBe(true);
    expect(second.expense).toEqual(first.expense);
    expect(expenseInserts(queries)).toHaveLength(1);
  });

  it('rejects a reused idempotency key whose payload differs', async () => {
    const { pool, queries } = stubPool([CASE_ID]);
    const service = new ScenarioExpenseService(pool);

    await service.save(ACTOR, CASE_ID, 'scenario-key-0003', EXPENSE);
    await expect(
      service.save(ACTOR, CASE_ID, 'scenario-key-0003', { ...EXPENSE, amount: 999 }),
    ).rejects.toThrow('idempotency_conflict');
    expect(expenseInserts(queries)).toHaveLength(1);
  });

  it('updates an expense with optimistic locking and audits without timeline noise', async () => {
    const { pool, queries } = stubPool([CASE_ID]);
    const service = new ScenarioExpenseService(pool);

    const created = await service.save(ACTOR, CASE_ID, 'scenario-key-0004', EXPENSE);
    const updated = await service.save(
      ACTOR,
      CASE_ID,
      'scenario-key-0005',
      { ...EXPENSE, amount: 300, version: 1 },
      created.expense.id,
    );

    expect(updated.expense).toMatchObject({ amount: 300, version: 2 });
    const audit = queries.filter((query) => query.text.includes('insert into audit_event'));
    expect(audit.at(-1)?.values).toContain('payroll.scenario_expense_updated');
    // Corrections are audit-only: only the creation produced a timeline event.
    const timeline = queries.filter((query) => query.text.includes('insert into timeline_event'));
    expect(timeline).toHaveLength(1);
  });

  it('rejects a stale version instead of silently overwriting a newer expense', async () => {
    const { pool } = stubPool([CASE_ID]);
    const service = new ScenarioExpenseService(pool);

    const created = await service.save(ACTOR, CASE_ID, 'scenario-key-0006', EXPENSE);
    await expect(
      service.save(
        ACTOR,
        CASE_ID,
        'scenario-key-0007',
        { ...EXPENSE, version: 5 },
        created.expense.id,
      ),
    ).rejects.toThrow('version_conflict');
  });

  it('reports expense_not_found when updating a missing expense', async () => {
    const { pool } = stubPool([CASE_ID]);
    const service = new ScenarioExpenseService(pool);

    await expect(
      service.save(
        ACTOR,
        CASE_ID,
        'scenario-key-0008',
        EXPENSE,
        '00000000-0000-4000-8000-000000000099',
      ),
    ).rejects.toThrow('expense_not_found');
  });

  it('rolls back and reports case_not_found for a case outside the tenant view', async () => {
    const { pool, queries } = stubPool([]);
    const service = new ScenarioExpenseService(pool);

    await expect(service.save(ACTOR, CASE_ID, 'scenario-key-0009', EXPENSE)).rejects.toThrow(
      'case_not_found',
    );
    expect(queries.map((query) => query.text.toLowerCase()).at(-1)).toBe('rollback');
    expect(expenseInserts(queries)).toHaveLength(0);
  });
});

describe('ScenarioExpenseService.remove', () => {
  it('soft deletes with audit, timeline and a durable delete receipt', async () => {
    const { pool, queries } = stubPool([CASE_ID]);
    const service = new ScenarioExpenseService(pool);

    const created = await service.save(ACTOR, CASE_ID, 'scenario-key-0010', EXPENSE);
    const removed = await service.remove(
      ACTOR,
      CASE_ID,
      created.expense.id,
      'scenario-del-0001',
      1,
    );

    expect(removed.expense).toMatchObject({ status: 'deleted', version: 2 });
    // Physical DELETE is never issued — planning history stays auditable.
    expect(queries.some((query) => query.text.toLowerCase().startsWith('delete'))).toBe(false);
    const audit = queries.filter((query) => query.text.includes('insert into audit_event'));
    expect(audit.at(-1)?.values).toContain('payroll.scenario_expense_deleted');
    const timeline = queries.filter((query) => query.text.includes('insert into timeline_event'));
    expect(timeline.at(-1)?.values).toContain('payroll.scenario_expense_deleted');
    const receipt = queries.at(-2);
    expect(receipt?.text).toContain("'scenario_expense.delete'");

    // The deleted expense disappears from the planning list.
    expect(await service.list(ACTOR, CASE_ID)).toHaveLength(0);
  });

  it('replays the delete receipt and rejects stale versions', async () => {
    const { pool } = stubPool([CASE_ID]);
    const service = new ScenarioExpenseService(pool);

    const created = await service.save(ACTOR, CASE_ID, 'scenario-key-0011', EXPENSE);
    await expect(
      service.remove(ACTOR, CASE_ID, created.expense.id, 'scenario-del-0002', 9),
    ).rejects.toThrow('version_conflict');

    const first = await service.remove(ACTOR, CASE_ID, created.expense.id, 'scenario-del-0003', 1);
    const replay = await service.remove(ACTOR, CASE_ID, created.expense.id, 'scenario-del-0003', 1);
    expect(replay.replayed).toBe(true);
    expect(replay.expense).toEqual(first.expense);
  });
});

describe('ScenarioExpenseService.list', () => {
  it('returns only active expenses for the requested case', async () => {
    const { pool } = stubPool([CASE_ID]);
    const service = new ScenarioExpenseService(pool);

    await service.save(ACTOR, CASE_ID, 'scenario-key-0012', EXPENSE);
    await service.save(ACTOR, CASE_ID, 'scenario-key-0013', {
      label: 'Synthetic one-time fee',
      amount: 80,
      kind: 'one_time',
      startMonth: '2026-11',
    });

    const listed = await service.list(ACTOR, CASE_ID);
    expect(listed).toHaveLength(2);
    expect(listed.every((expense) => expense.status === 'active')).toBe(true);
    expect(listed.find((expense) => expense.kind === 'one_time')).toMatchObject({
      startMonth: '2026-11',
      endMonth: null,
    });
  });
});

describe('0034_scenario_expense.sql', () => {
  it('grants select, insert and update only — planning history is never deleted', () => {
    const grants = MIGRATION.split('\n').filter(
      (line) => line.trimStart().startsWith('grant') && line.includes('scenario_expense'),
    );
    expect(grants).toEqual(['grant select, insert, update on scenario_expense to caredesk_app;']);
  });

  it('enables and forces RLS with a policy carrying both using and with check', () => {
    expect(MIGRATION).toContain('alter table scenario_expense enable row level security;');
    expect(MIGRATION).toContain('alter table scenario_expense force row level security;');
    expect(MIGRATION).toContain(
      'create policy scenario_expense_tenant_isolation on scenario_expense',
    );
    expect(MIGRATION).toContain("using (tenant_id = current_setting('app.tenant_id', true)::uuid)");
    expect(MIGRATION).toContain(
      "with check (tenant_id = current_setting('app.tenant_id', true)::uuid)",
    );
  });

  it('pins the case reference to the same tenant with a composite foreign key', () => {
    expect(MIGRATION).toContain('foreign key (tenant_id, employment_case_id)');
    expect(MIGRATION).toContain('references employment_case (tenant_id, id)');
  });

  it('constrains amounts, months and the recurring/one-time window', () => {
    expect(MIGRATION).toContain('check (amount between 0 and 10000000)');
    expect(MIGRATION).toContain("start_month = date_trunc('month', start_month)::date");
    expect(MIGRATION).toContain('check (end_month is null or end_month >= start_month)');
    expect(MIGRATION).toContain("check (kind = 'recurring' or end_month is null)");
    expect(MIGRATION).toContain("check (kind in ('recurring','one_time'))");
  });

  it('registers itself in schema_migrations', () => {
    expect(MIGRATION).toContain(
      "insert into schema_migrations (version) values ('0034_scenario_expense')",
    );
  });
});
