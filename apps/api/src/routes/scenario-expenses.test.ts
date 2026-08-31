import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { AuthorizationError } from '@caredesk/application';
import { buildContainer, DEV_TOKEN } from '../container.js';
import { buildServer } from '../create-server.js';
import { loadEnv } from '../env.js';
import { InMemoryRateLimiter } from '../rate-limit.js';
import { registerScenarioExpenseRoutes } from './scenario-expenses.js';

const AUTH = { authorization: `Bearer ${DEV_TOKEN}` };
const KEYED = { ...AUTH, 'idempotency-key': 'scenario-route-key-0001' };

const CASE_BODY = {
  careRecipient: { fullName: 'Synthetic Care Recipient' },
  employer: { fullName: 'Synthetic Employer', relationshipToRecipient: 'child' },
  caregiver: { legalName: 'Synthetic Caregiver', nationality: 'Philippines' },
  startDate: '2026-02-01',
};

// Synthetic amounts only — no real person's expenses appear in fixtures.
const EXPENSE_BODY = {
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

/**
 * The scenario-expense routes register only when the container is
 * Postgres-backed, so these tests attach a pg-shaped stateful stub (the
 * payroll-entries.test.ts pattern): case creation/authorization run in memory
 * while the scenario aggregate exercises its real SQL against the stub, which
 * answers the service's own statements and fails loudly on any statement it
 * does not recognise.
 */
function stubPool(knownCaseIds: Set<string>) {
  const queries: RecordedQuery[] = [];
  const state = { manager: true };
  const receipts = new Map<string, { hash: string; response: unknown }>();
  const expenses = new Map<
    string,
    { id: string; caseId: string; version: number; status: string; row: Record<string, unknown> }
  >();
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
    end_month: values.end === null || values.end === undefined ? null : `${String(values.end)}-01`,
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
        sql.startsWith('set local role') ||
        sql.includes('set_config')
      ) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('from tenant_membership')) {
        return { rows: [], rowCount: state.manager ? 1 : 0 };
      }
      if (sql.includes('select 1 from employment_case')) {
        return { rows: [], rowCount: knownCaseIds.has(String(values?.[0])) ? 1 : 0 };
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
  return { pool, queries, state };
}

async function buildApp() {
  const knownCaseIds = new Set<string>();
  const { pool, queries, state } = stubPool(knownCaseIds);
  const container = buildContainer(loadEnv({}));
  container.pool = pool;
  const app = buildServer(loadEnv({}), container);
  try {
    // Explicit registration keeps this suite valid both before and after
    // create-server.ts gains the registerScenarioExpenseRoutes line — Fastify
    // throws synchronously on a duplicated route, which we then ignore.
    registerScenarioExpenseRoutes(app, container, new InMemoryRateLimiter());
  } catch {
    // Already registered by create-server after the cutover merge.
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

const expenseInserts = (queries: RecordedQuery[]) =>
  queries.filter((query) => query.text.toLowerCase().startsWith('insert into scenario_expense'));

describe('scenario expense routes', () => {
  it('requires authentication on every scenario-expense route', async () => {
    const { app, caseId } = await buildApp();
    const base = `/cases/${caseId}/scenario-expenses`;
    const expenseId = '00000000-0000-4000-8000-000000000021';
    for (const request of [
      { method: 'GET' as const, url: base },
      { method: 'POST' as const, url: base, payload: EXPENSE_BODY },
      { method: 'PUT' as const, url: `${base}/${expenseId}`, payload: EXPENSE_BODY },
      { method: 'DELETE' as const, url: `${base}/${expenseId}`, payload: { version: 1 } },
    ]) {
      expect((await app.inject(request)).statusCode).toBe(401);
    }
  });

  it('requires an idempotency key before touching any scenario state', async () => {
    const { app, caseId, queries } = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: `/cases/${caseId}/scenario-expenses`,
      headers: AUTH,
      payload: EXPENSE_BODY,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect(queries).toHaveLength(0);
  });

  it('rejects invalid payloads with field-level errors before any write', async () => {
    const { app, caseId, queries } = await buildApp();
    const base = `/cases/${caseId}/scenario-expenses`;

    const negative = await app.inject({
      method: 'POST',
      url: base,
      headers: KEYED,
      payload: { ...EXPENSE_BODY, amount: -1 },
    });
    expect(negative.statusCode).toBe(400);
    expect(negative.json().fieldErrors).toHaveProperty('amount');

    const badWindow = await app.inject({
      method: 'POST',
      url: base,
      headers: KEYED,
      payload: { ...EXPENSE_BODY, startMonth: '2027-05', endMonth: '2027-01' },
    });
    expect(badWindow.statusCode).toBe(400);
    expect(badWindow.json().fieldErrors).toHaveProperty('endMonth');

    const oneTimeWindow = await app.inject({
      method: 'POST',
      url: base,
      headers: KEYED,
      payload: { ...EXPENSE_BODY, kind: 'one_time' },
    });
    expect(oneTimeWindow.statusCode).toBe(400);
    expect(oneTimeWindow.json().fieldErrors).toHaveProperty('endMonth');

    const unknownField = await app.inject({
      method: 'POST',
      url: base,
      headers: KEYED,
      payload: { ...EXPENSE_BODY, paid: true },
    });
    expect(unknownField.statusCode).toBe(400);

    expect(queries).toHaveLength(0);
  });

  it('maps cross-tenant authorization denial to 404 without revealing existence', async () => {
    const { app, container, caseId, queries } = await buildApp();
    vi.spyOn(container.getCase, 'execute').mockRejectedValue(
      new AuthorizationError('cross-tenant'),
    );
    const base = `/cases/${caseId}/scenario-expenses`;
    const expenseId = '00000000-0000-4000-8000-000000000022';
    for (const request of [
      { method: 'GET' as const, url: base },
      { method: 'POST' as const, url: base, headers: KEYED, payload: EXPENSE_BODY },
      {
        method: 'PUT' as const,
        url: `${base}/${expenseId}`,
        headers: KEYED,
        // `version` is mandatory on update (API-03), and body validation runs
        // before the authorization check. Without it this case returned 400 for
        // its own malformed payload and never reached the mapping it asserts.
        payload: { ...EXPENSE_BODY, version: 1 },
      },
      {
        method: 'DELETE' as const,
        url: `${base}/${expenseId}`,
        headers: KEYED,
        payload: { version: 1 },
      },
    ]) {
      const response = await app.inject({ headers: AUTH, ...request });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ code: 'NOT_FOUND' });
    }
    expect(expenseInserts(queries)).toHaveLength(0);
  });

  it('refuses scenario mutations from a non-manager membership but keeps reads open', async () => {
    const { app, caseId, queries, state } = await buildApp();
    state.manager = false;
    const base = `/cases/${caseId}/scenario-expenses`;

    const denied = await app.inject({
      method: 'POST',
      url: base,
      headers: KEYED,
      payload: EXPENSE_BODY,
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().code).toBe('MANAGER_REQUIRED');
    expect(expenseInserts(queries)).toHaveLength(0);

    // Case members without the manager role can still read the planning layer.
    expect((await app.inject({ method: 'GET', url: base, headers: AUTH })).statusCode).toBe(200);
  });

  it('creates, lists, updates and soft deletes an expense with evidence', async () => {
    const { app, caseId, queries } = await buildApp();
    const base = `/cases/${caseId}/scenario-expenses`;

    const created = await app.inject({
      method: 'POST',
      url: base,
      headers: KEYED,
      payload: EXPENSE_BODY,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      replayed: false,
      expense: {
        label: EXPENSE_BODY.label,
        amount: 250,
        kind: 'recurring',
        startMonth: '2026-09',
        endMonth: '2027-02',
        version: 1,
      },
    });
    const expenseId = created.json().expense.id as string;

    const listed = await app.inject({ method: 'GET', url: base, headers: AUTH });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toHaveLength(1);

    const updated = await app.inject({
      method: 'PUT',
      url: `${base}/${expenseId}`,
      headers: { ...AUTH, 'idempotency-key': 'scenario-route-key-0002' },
      payload: { ...EXPENSE_BODY, amount: 300, version: 1 },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().expense).toMatchObject({ amount: 300, version: 2 });

    const removed = await app.inject({
      method: 'DELETE',
      url: `${base}/${expenseId}`,
      headers: { ...AUTH, 'idempotency-key': 'scenario-route-key-0003' },
      payload: { version: 2 },
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json().expense.status).toBe('deleted');

    const emptied = await app.inject({ method: 'GET', url: base, headers: AUTH });
    expect(emptied.json()).toHaveLength(0);

    expect(queries.some((query) => query.text.includes('insert into audit_event'))).toBe(true);
    expect(queries.some((query) => query.text.includes('insert into timeline_event'))).toBe(true);
    expect(queries.some((query) => query.text.includes('insert into idempotency_record'))).toBe(
      true,
    );
    // No physical DELETE statement ever reaches the database.
    expect(queries.some((query) => query.text.toLowerCase().startsWith('delete'))).toBe(false);
  });

  it('replays the same durable receipt for a repeated idempotency key', async () => {
    const { app, caseId, queries } = await buildApp();
    const base = `/cases/${caseId}/scenario-expenses`;

    const first = await app.inject({
      method: 'POST',
      url: base,
      headers: KEYED,
      payload: EXPENSE_BODY,
    });
    const second = await app.inject({
      method: 'POST',
      url: base,
      headers: KEYED,
      payload: EXPENSE_BODY,
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().replayed).toBe(true);
    expect(second.json().expense).toEqual(first.json().expense);
    expect(expenseInserts(queries)).toHaveLength(1);
  });

  it('refuses a reused idempotency key carrying a different payload', async () => {
    const { app, caseId } = await buildApp();
    const base = `/cases/${caseId}/scenario-expenses`;

    await app.inject({ method: 'POST', url: base, headers: KEYED, payload: EXPENSE_BODY });
    const conflicting = await app.inject({
      method: 'POST',
      url: base,
      headers: KEYED,
      payload: { ...EXPENSE_BODY, amount: 999 },
    });
    expect(conflicting.statusCode).toBe(409);
    expect(conflicting.json().code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('refuses a stale version instead of silently overwriting', async () => {
    const { app, caseId } = await buildApp();
    const base = `/cases/${caseId}/scenario-expenses`;

    const created = await app.inject({
      method: 'POST',
      url: base,
      headers: KEYED,
      payload: EXPENSE_BODY,
    });
    const expenseId = created.json().expense.id as string;
    const stale = await app.inject({
      method: 'PUT',
      url: `${base}/${expenseId}`,
      headers: { ...AUTH, 'idempotency-key': 'scenario-route-key-0004' },
      payload: { ...EXPENSE_BODY, version: 5 },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe('VERSION_CONFLICT');
  });

  /**
   * Root 4 (API-03). Both of these used to succeed: `version` was
   * `.optional()` in the schema and the service guard read
   * `input.version !== undefined && …`, so omitting the field disabled the
   * check entirely and the last writer won with a 200.
   */
  it('refuses an update that omits version', async () => {
    const { app, caseId } = await buildApp();
    const base = `/cases/${caseId}/scenario-expenses`;

    const created = await app.inject({
      method: 'POST',
      url: base,
      headers: KEYED,
      payload: EXPENSE_BODY,
    });
    const expenseId = created.json().expense.id as string;
    const versionless = await app.inject({
      method: 'PUT',
      url: `${base}/${expenseId}`,
      headers: { ...AUTH, 'idempotency-key': 'scenario-route-key-0005' },
      payload: { ...EXPENSE_BODY, amount: 300 },
    });
    expect(versionless.statusCode).toBe(400);
    expect(versionless.json().code).toBe('VALIDATION_ERROR');
    expect(versionless.json().fieldErrors).toHaveProperty('version');

    // And the row is untouched.
    const listed = await app.inject({ method: 'GET', url: base, headers: AUTH });
    expect(listed.json()[0]).toMatchObject({ amount: 250, version: 1 });
  });

  it('refuses a delete that omits version', async () => {
    const { app, caseId } = await buildApp();
    const base = `/cases/${caseId}/scenario-expenses`;

    const created = await app.inject({
      method: 'POST',
      url: base,
      headers: KEYED,
      payload: EXPENSE_BODY,
    });
    const expenseId = created.json().expense.id as string;
    const versionless = await app.inject({
      method: 'DELETE',
      url: `${base}/${expenseId}`,
      headers: { ...AUTH, 'idempotency-key': 'scenario-route-key-0006' },
      payload: {},
    });
    expect(versionless.statusCode).toBe(400);
    expect(versionless.json().code).toBe('VALIDATION_ERROR');

    const listed = await app.inject({ method: 'GET', url: base, headers: AUTH });
    expect(listed.json()).toHaveLength(1);
  });

  it('returns 404 for mutations against an unknown expense id', async () => {
    const { app, caseId } = await buildApp();
    const missing = await app.inject({
      method: 'DELETE',
      url: `/cases/${caseId}/scenario-expenses/00000000-0000-4000-8000-000000000023`,
      headers: KEYED,
      payload: { version: 1 },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().code).toBe('NOT_FOUND');
  });
});
