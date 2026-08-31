import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { PayrollEntryService, type PayrollEntryInput } from './payroll-entry-service.js';

const MIGRATION = readFileSync(
  fileURLToPath(
    new URL('../../../database/migrations/0028_canonical_payroll_entry.sql', import.meta.url),
  ),
  'utf8',
);
const RECONCILE_MIGRATION = readFileSync(
  fileURLToPath(
    new URL('../../../database/migrations/0041_payroll_total_reconciles.sql', import.meta.url),
  ),
  'utf8',
);

/**
 * The migration with its `--` comments stripped.
 *
 * A guard that forbids a phrase has to read the statements, not the prose: 0041
 * explains at length why its trigger is deliberately *not* security definer, so
 * scanning the raw file finds the very phrase the guard exists to forbid and
 * fails on the explanation instead of on the code.
 */
const RECONCILE_MIGRATION_SQL = RECONCILE_MIGRATION.replace(/--[^\n]*/g, '');

const TENANT_ID = '00000000-0000-4000-8000-000000000001';
const CASE_ID = '00000000-0000-4000-8000-000000000011';
const ACTOR = {
  tenantId: TENANT_ID,
  userId: '00000000-0000-4000-8000-000000000002',
  correlationId: 'corr-payroll-1',
};

// Synthetic amounts only — no real person's salary appears in fixtures.
const ENTRY: PayrollEntryInput = {
  baseSalary: 6000,
  workDays: 22,
  paidRestDays: 4,
  restDayRate: 300,
  paidHolidays: 1,
  holidayPay: 250,
  vacationDays: 0,
  vacationPay: 0,
  sickDays: 0,
  sickPay: 0,
  otherAbsenceDays: 0,
  employerContributions: 500,
  additionalPayments: [{ description: 'Synthetic transport allowance', amount: 200 }],
  pocketMoney: 100,
  deductions: 0,
  advances: 0,
  agreedDeductions: 0,
  // Root 4 (DOM-02): 6000 + (4 x 300 + 250 + 500 + 200) - 100. The fixture used
  // to say 7350, a number no combination of these components produces, and
  // every assertion below passed anyway - which is precisely the finding.
  total: 8050,
  status: 'draft',
};

interface RecordedQuery {
  text: string;
  values?: unknown[];
}

interface StoredEntry {
  id: string;
  caseId: string;
  month: string;
  version: number;
  status: string;
  row: Record<string, unknown>;
}

/**
 * A pg-shaped stateful stub, in the same spirit as audit-persistence.test.ts:
 * the value under test is the SQL the service emits, its transaction envelope
 * and its durable-receipt behaviour, none of which a live database would show
 * more clearly. The stub answers the service's own statements and fails loudly
 * on any statement it does not recognise.
 */
function stubPool(knownCaseIds: string[], closedMonths: string[] = []) {
  const queries: RecordedQuery[] = [];
  const receipts = new Map<string, { hash: string; response: unknown }>();
  const entries = new Map<string, StoredEntry>();
  const now = new Date('2026-08-19T10:00:00.000Z');

  const rowFromInsert = (values: unknown[], version: number): Record<string, unknown> => ({
    id: values[0],
    payroll_month: `${String(values[3])}-01`,
    base_salary: String(values[4]),
    work_days: String(values[5]),
    paid_rest_days: String(values[6]),
    rest_day_rate: String(values[7]),
    paid_holidays: String(values[8]),
    holiday_pay: String(values[9]),
    vacation_days: String(values[10]),
    vacation_pay: String(values[11]),
    sick_days: String(values[12]),
    sick_pay: String(values[13]),
    other_absence_days: String(values[14]),
    employer_contributions: String(values[15]),
    additional_payments: JSON.parse(String(values[16])),
    pocket_money: String(values[17]),
    deductions: String(values[18]),
    advances: String(values[19]),
    agreed_deductions: String(values[20]),
    total: String(values[21]),
    status: values[22],
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
      // Root 4 (DOM-01): the closed-month lookup the write path did not have.
      if (sql.includes('select 1 from payroll_month_close')) {
        const closed = closedMonths.includes(String(values?.[1]));
        return { rows: [], rowCount: closed ? 1 : 0 };
      }
      if (sql.startsWith('select request_hash,response from idempotency_record')) {
        const receipt = receipts.get(String(values?.[0]));
        return receipt
          ? { rows: [{ request_hash: receipt.hash, response: receipt.response }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (sql.startsWith('select id,version,status from payroll_entry')) {
        const found = entries.get(`${String(values?.[0])}|${String(values?.[1])}`);
        return found
          ? { rows: [{ id: found.id, version: found.version, status: found.status }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (sql.startsWith('select') && sql.includes('from payroll_entry')) {
        const rows = [...entries.values()]
          .filter((entry) => entry.caseId === String(values?.[0]))
          .filter((entry) => (values?.[1] === undefined ? true : entry.month === values[1]))
          .sort((a, b) => b.month.localeCompare(a.month))
          .map((entry) => entry.row);
        return { rows, rowCount: rows.length };
      }
      if (sql.startsWith('insert into payroll_entry')) {
        const caseId = String(values?.[2]);
        const month = String(values?.[3]);
        const previous = entries.get(`${caseId}|${month}`);
        const version = previous ? previous.version + 1 : 1;
        const row = rowFromInsert(values!, version);
        entries.set(`${caseId}|${month}`, {
          id: String(values?.[0]),
          caseId,
          month,
          version,
          status: String(values?.[22]),
          row,
        });
        return { rows: [row], rowCount: 1 };
      }
      if (
        sql.startsWith('insert into audit_event') ||
        sql.startsWith('insert into timeline_event')
      ) {
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith('insert into idempotency_record')) {
        receipts.set(String(values?.[1]), {
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

const payrollInserts = (queries: RecordedQuery[]) =>
  queries.filter((query) => query.text.toLowerCase().startsWith('insert into payroll_entry'));

describe('PayrollEntryService.save', () => {
  it('creates the entry inside a tenant-scoped transaction with audit, timeline and receipt', async () => {
    const { pool, queries } = stubPool([CASE_ID]);
    const service = new PayrollEntryService(pool);

    const result = await service.save(ACTOR, CASE_ID, '2026-07', 'payroll-key-0001', ENTRY);

    expect(result.replayed).toBe(false);
    expect(result.entry).toMatchObject({ month: '2026-07', version: 1, status: 'draft' });

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
    expect(audit?.values).toContain('payroll.entry_created');
    expect(audit?.values).toContain(ACTOR.correlationId);
    expect(audit?.text).toContain("'financial_sensitive'");

    const timeline = queries.find((query) => query.text.includes('insert into timeline_event'));
    expect(timeline?.values).toContain('payroll.entry_created');

    const receipt = queries.find((query) => query.text.includes('insert into idempotency_record'));
    expect(receipt?.text).toContain("'payroll_entry.save'");
    expect(receipt?.values?.[0]).toBe(TENANT_ID);
  });

  it('replays the durable receipt for the same key without writing a second time', async () => {
    const { pool, queries } = stubPool([CASE_ID]);
    const service = new PayrollEntryService(pool);

    const first = await service.save(ACTOR, CASE_ID, '2026-07', 'payroll-key-0002', ENTRY);
    const second = await service.save(ACTOR, CASE_ID, '2026-07', 'payroll-key-0002', ENTRY);

    expect(second.replayed).toBe(true);
    expect(second.entry).toEqual(first.entry);
    expect(payrollInserts(queries)).toHaveLength(1);
  });

  it('rejects a reused idempotency key whose payload differs', async () => {
    const { pool, queries } = stubPool([CASE_ID]);
    const service = new PayrollEntryService(pool);

    await service.save(ACTOR, CASE_ID, '2026-07', 'payroll-key-0003', ENTRY);
    await expect(
      service.save(ACTOR, CASE_ID, '2026-07', 'payroll-key-0003', {
        ...ENTRY,
        advances: 200,
        total: 7850,
      }),
    ).rejects.toThrow('idempotency_conflict');
    expect(payrollInserts(queries)).toHaveLength(1);
  });

  it('rejects a stale version instead of silently overwriting a newer entry', async () => {
    const { pool } = stubPool([CASE_ID]);
    const service = new PayrollEntryService(pool);

    await service.save(ACTOR, CASE_ID, '2026-07', 'payroll-key-0004', ENTRY);
    await expect(
      service.save(ACTOR, CASE_ID, '2026-07', 'payroll-key-0005', { ...ENTRY, version: 5 }),
    ).rejects.toThrow('version_conflict');
  });

  it('bumps the version on update and emits a finalization timeline event', async () => {
    const { pool, queries } = stubPool([CASE_ID]);
    const service = new PayrollEntryService(pool);

    await service.save(ACTOR, CASE_ID, '2026-07', 'payroll-key-0006', ENTRY);
    const finalized = await service.save(ACTOR, CASE_ID, '2026-07', 'payroll-key-0007', {
      ...ENTRY,
      status: 'final',
      version: 1,
    });

    expect(finalized.entry).toMatchObject({ version: 2, status: 'final' });
    const audit = queries.filter((query) => query.text.includes('insert into audit_event'));
    expect(audit.at(-1)?.values).toContain('payroll.entry_updated');
    const timeline = queries.filter((query) => query.text.includes('insert into timeline_event'));
    expect(timeline.at(-1)?.values).toContain('payroll.entry_finalized');
  });

  it('suppresses timeline noise when a same-status correction changes nothing meaningful', async () => {
    const { pool, queries } = stubPool([CASE_ID]);
    const service = new PayrollEntryService(pool);

    await service.save(ACTOR, CASE_ID, '2026-07', 'payroll-key-0008', ENTRY);
    await service.save(ACTOR, CASE_ID, '2026-07', 'payroll-key-0009', {
      ...ENTRY,
      advances: 200,
      total: 7850,
      version: 1,
    });

    const timeline = queries.filter((query) => query.text.includes('insert into timeline_event'));
    expect(timeline).toHaveLength(1);
    // The correction itself is still fully audited even without a timeline event.
    const audit = queries.filter((query) => query.text.includes('insert into audit_event'));
    expect(audit).toHaveLength(2);
  });

  it('rolls back and reports case_not_found for a case outside the tenant view', async () => {
    const { pool, queries } = stubPool([]);
    const service = new PayrollEntryService(pool);

    await expect(
      service.save(ACTOR, CASE_ID, '2026-07', 'payroll-key-0010', ENTRY),
    ).rejects.toThrow('case_not_found');
    expect(queries.map((query) => query.text.toLowerCase()).at(-1)).toBe('rollback');
    expect(payrollInserts(queries)).toHaveLength(0);
  });
});

describe('PayrollEntryService.save — root 4, the server does not trust the browser', () => {
  it('rejects a total the submitted components do not produce (DOM-02)', async () => {
    const { pool, queries } = stubPool([CASE_ID]);
    const service = new PayrollEntryService(pool);

    // The finding verbatim: baseSalary 6000, advances 5000, total 6000. Before
    // this change the row, the audit event and the evidence binder all said
    // 6,000 was owed while the components said 1,000, and nothing objected.
    await expect(
      service.save(ACTOR, CASE_ID, '2026-07', 'payroll-key-0100', {
        ...ENTRY,
        paidRestDays: 0,
        restDayRate: 0,
        holidayPay: 0,
        employerContributions: 0,
        additionalPayments: [],
        pocketMoney: 0,
        advances: 5000,
        total: 6000,
      }),
    ).rejects.toThrow('total_mismatch');

    expect(payrollInserts(queries)).toHaveLength(0);
    expect(queries.map((query) => query.text.toLowerCase()).at(-1)).toBe('rollback');
    // Nothing is written at all — not the audit event, not the receipt. A
    // rejected payload must not leave a durable idempotency record behind, or a
    // corrected retry with the same key would replay the rejection.
    expect(queries.some((query) => query.text.includes('insert into audit_event'))).toBe(false);
    expect(queries.some((query) => query.text.includes('insert into idempotency_record'))).toBe(
      false,
    );
  });

  it('persists its own computed total, not the number it was handed', async () => {
    const { pool, queries } = stubPool([CASE_ID]);
    const service = new PayrollEntryService(pool);

    // 4.5 rest days at 372.15 = 1674.675, which numeric(12,2) stores as
    // 1674.68. The client is allowed to assert the rounded figure; what lands
    // in the column is what the server derived.
    const result = await service.save(ACTOR, CASE_ID, '2026-07', 'payroll-key-0101', {
      ...ENTRY,
      paidRestDays: 4.5,
      restDayRate: 372.15,
      holidayPay: 0,
      employerContributions: 0,
      additionalPayments: [],
      pocketMoney: 0,
      total: 7674.68,
    });

    expect(result.entry.total).toBe(7674.68);
    const insert = payrollInserts(queries)[0];
    expect(insert?.values?.[21]).toBe(7674.68);
  });

  it('rejects a write against a closed month (DOM-01)', async () => {
    const { pool, queries } = stubPool([CASE_ID], ['2026-07']);
    const service = new PayrollEntryService(pool);

    await expect(
      service.save(ACTOR, CASE_ID, '2026-07', 'payroll-key-0102', ENTRY),
    ).rejects.toThrow('payroll_month_closed');
    expect(payrollInserts(queries)).toHaveLength(0);

    // A month without a close receipt is still fully writable.
    const open = await service.save(ACTOR, CASE_ID, '2026-06', 'payroll-key-0103', ENTRY);
    expect(open.entry.month).toBe('2026-06');
  });

  it('rejects an update that omits version instead of silently overwriting (API-03)', async () => {
    const { pool, queries } = stubPool([CASE_ID]);
    const service = new PayrollEntryService(pool);

    // Manager A saves March.
    await service.save(ACTOR, CASE_ID, '2026-03', 'payroll-key-0104', ENTRY);
    // Manager B's client omits `version`. This used to win, silently.
    await expect(
      service.save(ACTOR, CASE_ID, '2026-03', 'payroll-key-0105', {
        ...ENTRY,
        advances: 200,
        total: 7850,
      }),
    ).rejects.toThrow('version_required');
    expect(payrollInserts(queries)).toHaveLength(1);
  });

  it('still accepts a create without a version — there is nothing to be stale against', async () => {
    const { pool } = stubPool([CASE_ID]);
    const service = new PayrollEntryService(pool);

    const created = await service.save(ACTOR, CASE_ID, '2026-05', 'payroll-key-0106', ENTRY);
    expect(created.entry).toMatchObject({ version: 1, total: 8050 });
  });
});

describe('PayrollEntryService reads', () => {
  it('lists saved entries newest month first and fetches a single month', async () => {
    const { pool } = stubPool([CASE_ID]);
    const service = new PayrollEntryService(pool);

    await service.save(ACTOR, CASE_ID, '2026-06', 'payroll-key-0011', ENTRY);
    await service.save(ACTOR, CASE_ID, '2026-07', 'payroll-key-0012', {
      ...ENTRY,
      advances: 200,
      total: 7850,
    });

    const listed = await service.list(ACTOR, CASE_ID);
    expect(listed.map((entry) => entry.month)).toEqual(['2026-07', '2026-06']);
    expect(listed[0]).toMatchObject({ total: 7850, baseSalary: 6000, version: 1 });

    expect(await service.get(ACTOR, CASE_ID, '2026-06')).toMatchObject({ month: '2026-06' });
    expect(await service.get(ACTOR, CASE_ID, '2026-01')).toBeNull();
  });
});

describe('0028_canonical_payroll_entry.sql', () => {
  it('grants select, insert and update only — payroll history is never deleted', () => {
    const grants = MIGRATION.split('\n').filter(
      (line) => line.trimStart().startsWith('grant') && line.includes('payroll_entry'),
    );
    expect(grants).toEqual(['grant select, insert, update on payroll_entry to caredesk_app;']);
  });

  it('enables and forces RLS with a policy carrying both using and with check', () => {
    expect(MIGRATION).toContain('alter table payroll_entry enable row level security;');
    expect(MIGRATION).toContain('alter table payroll_entry force row level security;');
    expect(MIGRATION).toContain('create policy payroll_entry_tenant_isolation on payroll_entry');
    expect(MIGRATION).toContain("using (tenant_id = current_setting('app.tenant_id', true)::uuid)");
    expect(MIGRATION).toContain(
      "with check (tenant_id = current_setting('app.tenant_id', true)::uuid)",
    );
  });

  it('pins the case reference to the same tenant with a composite foreign key', () => {
    expect(MIGRATION).toContain('foreign key (tenant_id, employment_case_id)');
    expect(MIGRATION).toContain('references employment_case (tenant_id, id)');
  });

  it('constrains amounts to non-negative bounded values and normalizes the month', () => {
    expect(MIGRATION).toContain('check (base_salary between 0 and 10000000)');
    expect(MIGRATION).toContain("payroll_month = date_trunc('month', payroll_month)::date");
    expect(MIGRATION).toContain('unique (tenant_id, employment_case_id, payroll_month)');
  });

  it('registers itself in schema_migrations', () => {
    expect(MIGRATION).toContain(
      "insert into schema_migrations (version) values ('0028_canonical_payroll_entry')",
    );
  });
});

describe('0041_payroll_total_reconciles.sql', () => {
  /**
   * The database half of root 4. These assertions are on the migration text
   * because no Postgres is reachable from the test environment; they are not a
   * substitute for applying it, and the migration has NOT been run anywhere.
   */
  it('reconciles the stored total against its own components (DOM-02/DB-06)', () => {
    expect(RECONCILE_MIGRATION).toContain('add constraint payroll_entry_total_reconciles');
    expect(RECONCILE_MIGRATION).toContain('check (total = caredesk_payroll_expected_total(');
  });

  it('adds both constraints NOT VALID so no existing row is touched', () => {
    const constraints = RECONCILE_MIGRATION.split('alter table payroll_entry').slice(1);
    expect(constraints).toHaveLength(2);
    for (const clause of constraints) expect(clause).toContain('not valid');
  });

  it('is additive — no drop of a column, no delete, no update of stored data', () => {
    const sql = RECONCILE_MIGRATION.toLowerCase();
    expect(sql).not.toContain('drop column');
    expect(sql).not.toContain('drop table');
    expect(sql).not.toMatch(/\bdelete from\b/);
    expect(sql).not.toMatch(/^\s*update\s+\w/m);
    // The single `drop constraint` is the DOM-24 widening, and it is guarded.
    expect(sql.match(/drop constraint/g)).toHaveLength(1);
    expect(sql).toContain('drop constraint if exists payroll_month_close_total_amount_check');
  });

  it('freezes a closed month with a trigger, not only with application code (DOM-01)', () => {
    expect(RECONCILE_MIGRATION).toContain('create trigger payroll_entry_month_not_closed');
    expect(RECONCILE_MIGRATION).toContain('before insert or update on payroll_entry');
    expect(RECONCILE_MIGRATION).toContain("raise exception 'payroll_month_closed'");
    // A definer-rights trigger would decide the write under BYPASSRLS.
    expect(RECONCILE_MIGRATION_SQL.toLowerCase()).not.toContain('security definer');
  });

  it('lets a zero or negative month be closed (DOM-24)', () => {
    expect(RECONCILE_MIGRATION).toContain(
      'check (total_amount is null or total_amount between -10000000 and 10000000)',
    );
  });

  it('revokes PUBLIC execute on every function it creates', () => {
    // Postgres grants EXECUTE to PUBLIC by default. This repository has been
    // bitten by that three times; the guard is an assertion, not a habit.
    const created = [...RECONCILE_MIGRATION.matchAll(/^create function (\w+)\(/gm)].map(
      (match) => match[1]!,
    );
    expect(created.length).toBeGreaterThan(0);
    for (const name of created) {
      expect(RECONCILE_MIGRATION).toContain(`revoke all privileges on function ${name}(`);
      expect(RECONCILE_MIGRATION).toContain(`grant execute on function ${name}(`);
    }
  });

  it('registers itself in schema_migrations', () => {
    expect(
      RECONCILE_MIGRATION.trimEnd().endsWith(
        "insert into schema_migrations (version) values ('0041_payroll_total_reconciles');",
      ),
    ).toBe(true);
  });
});
