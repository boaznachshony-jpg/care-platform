import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { AuthorizationError } from '@caredesk/application';
import { buildContainer, DEV_TOKEN } from '../container.js';
import { buildServer } from '../create-server.js';
import { loadEnv } from '../env.js';
import { InMemoryRateLimiter } from '../rate-limit.js';
import { registerLeaveEntryRoutes } from './leave-entries.js';

const AUTH = { authorization: `Bearer ${DEV_TOKEN}` };
const KEYED = { ...AUTH, 'idempotency-key': 'leave-route-key-0001' };

const CASE_BODY = {
  careRecipient: { fullName: 'Synthetic Care Recipient' },
  employer: { fullName: 'Synthetic Employer', relationshipToRecipient: 'child' },
  caregiver: { legalName: 'Synthetic Caregiver', nationality: 'Philippines' },
  startDate: '2026-02-01',
};

// Synthetic dates only — no real person's leave appears in fixtures.
const ENTRY_BODY = {
  entryType: 'annual',
  startDate: '2026-09-01',
  endDate: '2026-09-05',
  days: 5,
  note: 'Synthetic annual leave',
};

const CAREGIVER_ID = '00000000-0000-4000-8000-000000000021';

interface RecordedQuery {
  text: string;
  values?: unknown[];
}

/**
 * The leave-entry routes register only when the container is Postgres-backed,
 * so these tests attach a pg-shaped stateful stub (the payroll-entries.test.ts
 * pattern) to the otherwise in-memory container: case creation/authorization
 * run in memory while the leave ledger exercises its real SQL against the
 * stub, which answers the service's own statements and fails loudly on any
 * statement it does not recognise.
 */
function stubPool(knownCaseIds: Set<string>) {
  const queries: RecordedQuery[] = [];
  const state = { manager: true };
  const receipts = new Map<string, { hash: string; response: unknown }>();
  const entries = new Map<
    string,
    { caseId: string; version: number; status: string; row: Record<string, unknown> }
  >();
  const now = new Date('2026-08-19T10:00:00.000Z');

  const client = {
    query: async (text: string, values?: unknown[]) => {
      queries.push({ text, values });
      const sql = text.toLowerCase();
      if (
        sql === 'begin' ||
        sql === 'commit' ||
        sql === 'rollback' ||
        sql.startsWith('set local role') ||
        sql.includes('set_config')
      ) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('from tenant_membership')) {
        return { rows: [], rowCount: state.manager ? 1 : 0 };
      }
      if (sql.includes('select caregiver_id from employment_case')) {
        return knownCaseIds.has(String(values?.[0]))
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
  return { pool, queries, state };
}

async function buildApp() {
  const knownCaseIds = new Set<string>();
  const { pool, queries, state } = stubPool(knownCaseIds);
  const container = buildContainer(loadEnv({}));
  container.pool = pool;
  const app = buildServer(loadEnv({}), container);
  // create-server.ts registration is pending merge; keep the test valid both
  // before and after that line lands.
  if (!app.hasRoute({ method: 'GET', url: '/cases/:caseId/leave-entries' })) {
    registerLeaveEntryRoutes(app, container, new InMemoryRateLimiter());
  }
  const created = await app.inject({
    method: 'POST',
    url: '/cases',
    headers: AUTH,
    payload: CASE_BODY,
  });
  const caseId = created.json().id as string;
  knownCaseIds.add(caseId);
  return { app, container, caseId, queries, state };
}

const leaveWrites = (queries: RecordedQuery[]) =>
  queries.filter((query) => {
    const sql = query.text.toLowerCase();
    return sql.startsWith('insert into leave_entry') || sql.startsWith('update leave_entry');
  });

describe('leave entry routes', () => {
  it('requires authentication on every leave-ledger route', async () => {
    const { app, caseId } = await buildApp();
    const base = `/cases/${caseId}/leave-entries`;
    for (const request of [
      { method: 'GET' as const, url: base },
      { method: 'POST' as const, url: base, payload: ENTRY_BODY },
      {
        method: 'PUT' as const,
        url: `${base}/00000000-0000-4000-8000-000000000031`,
        payload: { ...ENTRY_BODY, status: 'recorded', version: 1 },
      },
    ]) {
      expect((await app.inject(request)).statusCode).toBe(401);
    }
  });

  it('requires an idempotency key before touching any ledger state', async () => {
    const { app, caseId, queries } = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: `/cases/${caseId}/leave-entries`,
      headers: AUTH,
      payload: ENTRY_BODY,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect(leaveWrites(queries)).toHaveLength(0);
  });

  it('rejects invalid types, inverted ranges and unknown fields before any write', async () => {
    const { app, caseId, queries } = await buildApp();
    const base = `/cases/${caseId}/leave-entries`;

    const badType = await app.inject({
      method: 'POST',
      url: base,
      headers: KEYED,
      payload: { ...ENTRY_BODY, entryType: 'sabbatical' },
    });
    expect(badType.statusCode).toBe(400);
    expect(badType.json().fieldErrors).toHaveProperty('entryType');

    const inverted = await app.inject({
      method: 'POST',
      url: base,
      headers: KEYED,
      payload: { ...ENTRY_BODY, startDate: '2026-09-09', endDate: '2026-09-01' },
    });
    expect(inverted.statusCode).toBe(400);
    expect(inverted.json().fieldErrors).toHaveProperty('endDate');

    const unknownField = await app.inject({
      method: 'POST',
      url: base,
      headers: KEYED,
      payload: { ...ENTRY_BODY, approvedBalance: 12 },
    });
    expect(unknownField.statusCode).toBe(400);

    const zeroDays = await app.inject({
      method: 'POST',
      url: base,
      headers: KEYED,
      payload: { ...ENTRY_BODY, days: 0 },
    });
    expect(zeroDays.statusCode).toBe(400);
    expect(zeroDays.json().fieldErrors).toHaveProperty('days');

    expect(leaveWrites(queries)).toHaveLength(0);
  });

  it('maps cross-tenant authorization denial to 404 without revealing existence', async () => {
    const { app, container, caseId, queries } = await buildApp();
    vi.spyOn(container.getCase, 'execute').mockRejectedValue(
      new AuthorizationError('cross-tenant'),
    );
    const base = `/cases/${caseId}/leave-entries`;
    for (const request of [
      { method: 'GET' as const, url: base },
      { method: 'POST' as const, url: base, headers: KEYED, payload: ENTRY_BODY },
      {
        method: 'PUT' as const,
        url: `${base}/00000000-0000-4000-8000-000000000031`,
        headers: KEYED,
        payload: { ...ENTRY_BODY, status: 'recorded', version: 1 },
      },
    ]) {
      const response = await app.inject({ headers: AUTH, ...request });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ code: 'NOT_FOUND' });
    }
    expect(leaveWrites(queries)).toHaveLength(0);
  });

  it('refuses ledger mutations from a non-manager membership but keeps reads open', async () => {
    const { app, caseId, queries, state } = await buildApp();
    state.manager = false;
    const base = `/cases/${caseId}/leave-entries`;

    const denied = await app.inject({
      method: 'POST',
      url: base,
      headers: KEYED,
      payload: ENTRY_BODY,
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().code).toBe('MANAGER_REQUIRED');
    expect(leaveWrites(queries)).toHaveLength(0);

    // Case members without the manager role can still read the ledger.
    expect((await app.inject({ method: 'GET', url: base, headers: AUTH })).statusCode).toBe(200);
  });

  it('records an entry, lists it and stores audit/timeline/receipt evidence', async () => {
    const { app, caseId, queries } = await buildApp();
    const base = `/cases/${caseId}/leave-entries`;

    const created = await app.inject({
      method: 'POST',
      url: base,
      headers: KEYED,
      payload: ENTRY_BODY,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      replayed: false,
      entry: { entryType: 'annual', days: 5, status: 'recorded', version: 1 },
    });

    const listed = await app.inject({ method: 'GET', url: base, headers: AUTH });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toHaveLength(1);
    expect(listed.json()[0].startDate).toBe('2026-09-01');

    expect(queries.some((query) => query.text.includes('insert into audit_event'))).toBe(true);
    expect(queries.some((query) => query.text.includes('insert into timeline_event'))).toBe(true);
    expect(queries.some((query) => query.text.includes('insert into idempotency_record'))).toBe(
      true,
    );
  });

  it('replays the same durable receipt for a repeated idempotency key', async () => {
    const { app, caseId, queries } = await buildApp();
    const url = `/cases/${caseId}/leave-entries`;

    const first = await app.inject({ method: 'POST', url, headers: KEYED, payload: ENTRY_BODY });
    const second = await app.inject({ method: 'POST', url, headers: KEYED, payload: ENTRY_BODY });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().replayed).toBe(true);
    expect(second.json().entry).toEqual(first.json().entry);
    expect(leaveWrites(queries)).toHaveLength(1);
  });

  it('refuses a reused idempotency key carrying a different payload', async () => {
    const { app, caseId } = await buildApp();
    const url = `/cases/${caseId}/leave-entries`;

    await app.inject({ method: 'POST', url, headers: KEYED, payload: ENTRY_BODY });
    const conflicting = await app.inject({
      method: 'POST',
      url,
      headers: KEYED,
      payload: { ...ENTRY_BODY, days: 9 },
    });
    expect(conflicting.statusCode).toBe(409);
    expect(conflicting.json().code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('cancels an entry through a versioned update instead of a delete', async () => {
    const { app, caseId } = await buildApp();
    const base = `/cases/${caseId}/leave-entries`;

    const created = await app.inject({
      method: 'POST',
      url: base,
      headers: KEYED,
      payload: ENTRY_BODY,
    });
    const entryId = created.json().entry.id as string;

    const cancelled = await app.inject({
      method: 'PUT',
      url: `${base}/${entryId}`,
      headers: { ...AUTH, 'idempotency-key': 'leave-route-key-0002' },
      payload: { ...ENTRY_BODY, status: 'cancelled', version: 1 },
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().entry).toMatchObject({ status: 'cancelled', version: 2 });

    const stale = await app.inject({
      method: 'PUT',
      url: `${base}/${entryId}`,
      headers: { ...AUTH, 'idempotency-key': 'leave-route-key-0003' },
      payload: { ...ENTRY_BODY, status: 'recorded', version: 1 },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe('VERSION_CONFLICT');

    const listed = await app.inject({ method: 'GET', url: base, headers: AUTH });
    expect(listed.json()).toHaveLength(1);
    expect(listed.json()[0].status).toBe('cancelled');
  });

  it('returns 404 for an update against an unknown ledger row', async () => {
    const { app, caseId } = await buildApp();
    const missing = await app.inject({
      method: 'PUT',
      url: `/cases/${caseId}/leave-entries/00000000-0000-4000-8000-000000000031`,
      headers: KEYED,
      payload: { ...ENTRY_BODY, status: 'recorded', version: 1 },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().code).toBe('NOT_FOUND');
  });
});
