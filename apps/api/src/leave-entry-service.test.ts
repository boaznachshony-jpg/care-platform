import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import {
  LeaveEntryService,
  type LeaveEntryInput,
  type LeaveEntryUpdate,
} from './leave-entry-service.js';

const MIGRATION = readFileSync(
  fileURLToPath(
    new URL('../../../database/migrations/0033_governed_leave_ledger.sql', import.meta.url),
  ),
  'utf8',
);

const TENANT_ID = '00000000-0000-4000-8000-000000000001';
const CASE_ID = '00000000-0000-4000-8000-000000000011';
const CAREGIVER_ID = '00000000-0000-4000-8000-000000000021';
const ACTOR = {
  tenantId: TENANT_ID,
  userId: '00000000-0000-4000-8000-000000000002',
  correlationId: 'corr-leave-1',
};

// Synthetic dates only — no real person's leave appears in fixtures.
const ENTRY: LeaveEntryInput = {
  entryType: 'annual',
  startDate: '2026-09-01',
  endDate: '2026-09-05',
  days: 5,
  note: 'Synthetic annual leave',
};

interface RecordedQuery {
  text: string;
  values?: unknown[];
}

interface StoredEntry {
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
  const entries = new Map<string, StoredEntry>();
  const now = new Date('2026-08-19T10:00:00.000Z');

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
      if (sql.includes('select caregiver_id from employment_case')) {
        return knownCaseIds.includes(String(values?.[0]))
          ? { rows: [{ caregiver_id: CAREGIVER_ID }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (sql.startsWith('select request_hash,response from idempotency_record')) {
        const receipt = receipts.get(`${String(values?.[0])}|${String(values?.[1])}`);
        return receipt
          ? { rows: [{ request_hash: receipt.hash, response: receipt.response }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (sql.startsWith('select version,status from leave_entry')) {
        const found = entries.get(String(values?.[0]));
        return found && found.caseId === String(values?.[1])
          ? { rows: [{ version: found.version, status: found.status }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (sql.startsWith('select') && sql.includes('from leave_entry')) {
        const rows = [...entries.values()]
          .filter((entry) => entry.caseId === String(values?.[0]))
          .sort((a, b) => String(b.row.start_date).localeCompare(String(a.row.start_date)))
          .map((entry) => entry.row);
        return { rows, rowCount: rows.length };
      }
      if (sql.startsWith('insert into leave_entry')) {
        const row: Record<string, unknown> = {
          id: values?.[0],
          caregiver_id: values?.[3],
          entry_type: values?.[4],
          start_date: values?.[5],
          end_date: values?.[6],
          days: String(values?.[7]),
          status: 'recorded',
          note: values?.[8],
          version: 1,
          created_at: now,
          updated_at: now,
        };
        entries.set(String(values?.[0]), {
          id: String(values?.[0]),
          caseId: String(values?.[2]),
          version: 1,
          status: 'recorded',
          row,
        });
        return { rows: [row], rowCount: 1 };
      }
      if (sql.startsWith('update leave_entry')) {
        const found = entries.get(String(values?.[0]));
        if (!found || found.caseId !== String(values?.[1])) return { rows: [], rowCount: 0 };
        found.version += 1;
        found.status = String(values?.[7]);
        found.row = {
          ...found.row,
          entry_type: values?.[2],
          start_date: values?.[3],
          end_date: values?.[4],
          days: String(values?.[5]),
          note: values?.[6],
          status: values?.[7],
          version: found.version,
          updated_at: now,
        };
        return { rows: [found.row], rowCount: 1 };
      }
      if (
        sql.startsWith('insert into audit_event') ||
        sql.startsWith('insert into timeline_event')
      ) {
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith('insert into idempotency_record')) {
        receipts.set(`${String(values?.[1])}|${String(values?.[2])}`, {
          hash: String(values?.[3]),
          response: JSON.parse(String(values?.[4])),
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

const leaveWrites = (queries: RecordedQuery[]) =>
  queries.filter((query) => {
    const sql = query.text.toLowerCase();
    return sql.startsWith('insert into leave_entry') || sql.startsWith('update leave_entry');
  });

describe('LeaveEntryService.create', () => {
  it('records an entry inside a tenant-scoped transaction with audit, timeline and receipt', async () => {
    const { pool, queries } = stubPool([CASE_ID]);
    const service = new LeaveEntryService(pool);

    const result = await service.create(ACTOR, CASE_ID, 'leave-key-0001', ENTRY);

    expect(result.replayed).toBe(false);
    expect(result.entry).toMatchObject({
      entryType: 'annual',
      startDate: '2026-09-01',
      endDate: '2026-09-05',
      days: 5,
      status: 'recorded',
      version: 1,
      caregiverId: CAREGIVER_ID,
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
    expect(audit?.values).toContain('leave.entry_recorded');
    expect(audit?.values).toContain(ACTOR.correlationId);
    expect(audit?.text).toContain("'employment_sensitive'");

    const timeline = queries.find((query) => query.text.includes('insert into timeline_event'));
    expect(timeline?.values).toContain('leave.entry_recorded');
    expect(timeline?.values).toContain(CASE_ID);

    const receipt = queries.find((query) => query.text.includes('insert into idempotency_record'));
    expect(receipt?.values?.[0]).toBe(TENANT_ID);
    expect(receipt?.values?.[1]).toBe('leave_entry.create');
  });

  it('replays the durable receipt for the same key without writing a second row', async () => {
    const { pool, queries } = stubPool([CASE_ID]);
    const service = new LeaveEntryService(pool);

    const first = await service.create(ACTOR, CASE_ID, 'leave-key-0002', ENTRY);
    const second = await service.create(ACTOR, CASE_ID, 'leave-key-0002', ENTRY);

    expect(second.replayed).toBe(true);
    expect(second.entry).toEqual(first.entry);
    expect(leaveWrites(queries)).toHaveLength(1);
  });

  it('rejects a reused idempotency key whose payload differs', async () => {
    const { pool, queries } = stubPool([CASE_ID]);
    const service = new LeaveEntryService(pool);

    await service.create(ACTOR, CASE_ID, 'leave-key-0003', ENTRY);
    await expect(
      service.create(ACTOR, CASE_ID, 'leave-key-0003', { ...ENTRY, days: 9 }),
    ).rejects.toThrow('idempotency_conflict');
    expect(leaveWrites(queries)).toHaveLength(1);
  });

  it('rolls back and reports case_not_found for a case outside the tenant view', async () => {
    const { pool, queries } = stubPool([]);
    const service = new LeaveEntryService(pool);

    await expect(service.create(ACTOR, CASE_ID, 'leave-key-0004', ENTRY)).rejects.toThrow(
      'case_not_found',
    );
    expect(queries.map((query) => query.text.toLowerCase()).at(-1)).toBe('rollback');
    expect(leaveWrites(queries)).toHaveLength(0);
  });
});

describe('LeaveEntryService.update', () => {
  const update = (overrides: Partial<LeaveEntryUpdate> = {}): LeaveEntryUpdate => ({
    ...ENTRY,
    status: 'recorded',
    version: 1,
    ...overrides,
  });

  it('bumps the version, audits the correction and stays out of the timeline', async () => {
    const { pool, queries } = stubPool([CASE_ID]);
    const service = new LeaveEntryService(pool);

    const created = await service.create(ACTOR, CASE_ID, 'leave-key-0005', ENTRY);
    const corrected = await service.update(
      ACTOR,
      CASE_ID,
      created.entry.id,
      'leave-key-0006',
      update({ days: 4, endDate: '2026-09-04' }),
    );

    expect(corrected.entry).toMatchObject({ days: 4, version: 2, status: 'recorded' });
    const audits = queries.filter((query) => query.text.includes('insert into audit_event'));
    expect(audits.at(-1)?.values).toContain('leave.entry_updated');
    const timelines = queries.filter((query) => query.text.includes('insert into timeline_event'));
    expect(timelines).toHaveLength(1); // only the creation event
  });

  it('emits a cancellation timeline event and keeps the row instead of deleting it', async () => {
    const { pool, queries } = stubPool([CASE_ID]);
    const service = new LeaveEntryService(pool);

    const created = await service.create(ACTOR, CASE_ID, 'leave-key-0007', ENTRY);
    const cancelled = await service.update(
      ACTOR,
      CASE_ID,
      created.entry.id,
      'leave-key-0008',
      update({ status: 'cancelled' }),
    );

    expect(cancelled.entry).toMatchObject({ status: 'cancelled', version: 2 });
    const timelines = queries.filter((query) => query.text.includes('insert into timeline_event'));
    expect(timelines.at(-1)?.values).toContain('leave.entry_cancelled');
    expect(queries.some((query) => query.text.toLowerCase().startsWith('delete'))).toBe(false);

    const listed = await service.list(ACTOR, CASE_ID);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ status: 'cancelled' });
  });

  it('rejects a stale version instead of silently overwriting a newer entry', async () => {
    const { pool } = stubPool([CASE_ID]);
    const service = new LeaveEntryService(pool);

    const created = await service.create(ACTOR, CASE_ID, 'leave-key-0009', ENTRY);
    await service.update(ACTOR, CASE_ID, created.entry.id, 'leave-key-0010', update({ days: 3 }));
    await expect(
      service.update(ACTOR, CASE_ID, created.entry.id, 'leave-key-0011', update({ days: 2 })),
    ).rejects.toThrow('version_conflict');
  });

  it('reports entry_not_found for an unknown ledger row', async () => {
    const { pool } = stubPool([CASE_ID]);
    const service = new LeaveEntryService(pool);

    await expect(
      service.update(
        ACTOR,
        CASE_ID,
        '00000000-0000-4000-8000-000000000099',
        'leave-key-0012',
        update(),
      ),
    ).rejects.toThrow('entry_not_found');
  });
});

describe('LeaveEntryService.list', () => {
  it('lists entries for the case newest range first', async () => {
    const { pool } = stubPool([CASE_ID]);
    const service = new LeaveEntryService(pool);

    await service.create(ACTOR, CASE_ID, 'leave-key-0013', ENTRY);
    await service.create(ACTOR, CASE_ID, 'leave-key-0014', {
      entryType: 'sick',
      startDate: '2026-10-02',
      endDate: '2026-10-03',
      days: 2,
    });

    const listed = await service.list(ACTOR, CASE_ID);
    expect(listed.map((entry) => entry.entryType)).toEqual(['sick', 'annual']);
    expect(listed[0]).toMatchObject({ days: 2, note: null });
  });
});

describe('0033_governed_leave_ledger.sql', () => {
  it('grants select, insert and update only — ledger rows are never deleted', () => {
    const grants = MIGRATION.split('\n').filter(
      (line) => line.trimStart().startsWith('grant') && line.includes('leave_entry'),
    );
    expect(grants).toEqual(['grant select, insert, update on leave_entry to caredesk_app;']);
  });

  it('enables and forces RLS with a policy carrying both using and with check', () => {
    expect(MIGRATION).toContain('alter table leave_entry enable row level security;');
    expect(MIGRATION).toContain('alter table leave_entry force row level security;');
    expect(MIGRATION).toContain('create policy leave_entry_tenant_isolation on leave_entry');
    expect(MIGRATION).toContain("using (tenant_id = current_setting('app.tenant_id', true)::uuid)");
    expect(MIGRATION).toContain(
      "with check (tenant_id = current_setting('app.tenant_id', true)::uuid)",
    );
  });

  it('pins case and caregiver references to the same tenant with composite foreign keys', () => {
    expect(MIGRATION).toContain('foreign key (tenant_id, employment_case_id)');
    expect(MIGRATION).toContain('references employment_case (tenant_id, id)');
    expect(MIGRATION).toContain('foreign key (tenant_id, caregiver_id)');
    expect(MIGRATION).toContain('references caregiver (tenant_id, id)');
  });

  it('constrains the type, range and day count of every ledger row', () => {
    expect(MIGRATION).toContain("check (entry_type in ('annual','sick','holiday'))");
    expect(MIGRATION).toContain('check (start_date <= end_date)');
    expect(MIGRATION).toContain('check (days > 0 and days <= 366)');
    expect(MIGRATION).toContain("check (status in ('recorded','cancelled'))");
  });

  it('registers itself in schema_migrations', () => {
    expect(MIGRATION).toContain(
      "insert into schema_migrations (version) values ('0033_governed_leave_ledger')",
    );
  });
});
