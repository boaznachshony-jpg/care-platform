import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { AuthorizationError } from '@caredesk/application';
import { buildContainer, DEV_TOKEN } from '../container.js';
import { buildServer } from '../create-server.js';
import { loadEnv } from '../env.js';

const AUTH = { authorization: `Bearer ${DEV_TOKEN}` };
const KEYED = { ...AUTH, 'idempotency-key': 'payroll-route-key-0001' };

const CASE_BODY = {
  careRecipient: { fullName: 'Synthetic Care Recipient' },
  employer: { fullName: 'Synthetic Employer', relationshipToRecipient: 'child' },
  caregiver: { legalName: 'Synthetic Caregiver', nationality: 'Philippines' },
  startDate: '2026-02-01',
};

// Synthetic amounts only — no real person's salary appears in fixtures.
const ENTRY_BODY = {
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
  total: 7350,
  status: 'draft',
};

interface RecordedQuery {
  text: string;
  values?: unknown[];
}

/**
 * The payroll routes register only when the container is Postgres-backed, so
 * these tests attach a pg-shaped stateful stub (the audit-persistence.test.ts
 * pattern) to the otherwise in-memory container: case creation/authorization
 * run in memory while the payroll aggregate exercises its real SQL against the
 * stub, which answers the service's own statements and fails loudly on any
 * statement it does not recognise.
 */
function stubPool(knownCaseIds: Set<string>) {
  const queries: RecordedQuery[] = [];
  const state = { manager: true };
  const receipts = new Map<string, { hash: string; response: unknown }>();
  const entries = new Map<
    string,
    {
      id: string;
      caseId: string;
      month: string;
      version: number;
      status: string;
      row: Record<string, unknown>;
    }
  >();
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
  return { pool, queries, state };
}

async function buildApp() {
  const knownCaseIds = new Set<string>();
  const { pool, queries, state } = stubPool(knownCaseIds);
  const container = buildContainer(loadEnv({}));
  container.pool = pool;
  const app = buildServer(loadEnv({}), container);
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

const payrollInserts = (queries: RecordedQuery[]) =>
  queries.filter((query) => query.text.toLowerCase().startsWith('insert into payroll_entry'));

describe('payroll entry routes', () => {
  it('requires authentication on every payroll route', async () => {
    const { app, caseId } = await buildApp();
    const base = `/cases/${caseId}/payroll-entries`;
    for (const request of [
      { method: 'GET' as const, url: base },
      { method: 'GET' as const, url: `${base}/2026-07` },
      { method: 'PUT' as const, url: `${base}/2026-07`, payload: ENTRY_BODY },
    ]) {
      expect((await app.inject(request)).statusCode).toBe(401);
    }
  });

  it('requires an idempotency key before touching any payroll state', async () => {
    const { app, caseId, queries } = await buildApp();
    const response = await app.inject({
      method: 'PUT',
      url: `/cases/${caseId}/payroll-entries/2026-07`,
      headers: AUTH,
      payload: ENTRY_BODY,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect(queries).toHaveLength(0);
  });

  it('rejects invalid payloads and months with field-level errors before any write', async () => {
    const { app, caseId, queries } = await buildApp();
    const base = `/cases/${caseId}/payroll-entries`;

    const negative = await app.inject({
      method: 'PUT',
      url: `${base}/2026-07`,
      headers: KEYED,
      payload: { ...ENTRY_BODY, baseSalary: -1 },
    });
    expect(negative.statusCode).toBe(400);
    expect(negative.json().fieldErrors).toHaveProperty('baseSalary');

    const unknownField = await app.inject({
      method: 'PUT',
      url: `${base}/2026-07`,
      headers: KEYED,
      payload: { ...ENTRY_BODY, netToWorker: 1 },
    });
    expect(unknownField.statusCode).toBe(400);

    const badMonth = await app.inject({
      method: 'PUT',
      url: `${base}/2026-13`,
      headers: KEYED,
      payload: ENTRY_BODY,
    });
    expect(badMonth.statusCode).toBe(400);
    expect(badMonth.json().fieldErrors).toHaveProperty('month');

    expect(queries).toHaveLength(0);
  });

  it('maps cross-tenant authorization denial to 404 without revealing existence', async () => {
    const { app, container, caseId, queries } = await buildApp();
    vi.spyOn(container.getCase, 'execute').mockRejectedValue(
      new AuthorizationError('cross-tenant'),
    );
    const base = `/cases/${caseId}/payroll-entries`;
    for (const request of [
      { method: 'GET' as const, url: base },
      { method: 'GET' as const, url: `${base}/2026-07` },
      { method: 'PUT' as const, url: `${base}/2026-07`, headers: KEYED, payload: ENTRY_BODY },
    ]) {
      const response = await app.inject({ headers: AUTH, ...request });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ code: 'NOT_FOUND' });
    }
    expect(payrollInserts(queries)).toHaveLength(0);
  });

  it('refuses payroll mutations from a non-manager membership but keeps reads open', async () => {
    const { app, caseId, queries, state } = await buildApp();
    state.manager = false;
    const base = `/cases/${caseId}/payroll-entries`;

    const denied = await app.inject({
      method: 'PUT',
      url: `${base}/2026-07`,
      headers: KEYED,
      payload: ENTRY_BODY,
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().code).toBe('MANAGER_REQUIRED');
    expect(payrollInserts(queries)).toHaveLength(0);

    // Case members without the manager role can still read the worksheet.
    expect((await app.inject({ method: 'GET', url: base, headers: AUTH })).statusCode).toBe(200);
  });

  it('saves an entry, lists it, fetches it by month and records evidence', async () => {
    const { app, caseId, queries } = await buildApp();
    const base = `/cases/${caseId}/payroll-entries`;

    const saved = await app.inject({
      method: 'PUT',
      url: `${base}/2026-07`,
      headers: KEYED,
      payload: ENTRY_BODY,
    });
    expect(saved.statusCode).toBe(201);
    expect(saved.json()).toMatchObject({
      replayed: false,
      entry: { month: '2026-07', version: 1, status: 'draft', total: 7350 },
    });

    const listed = await app.inject({ method: 'GET', url: base, headers: AUTH });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toHaveLength(1);
    expect(listed.json()[0].month).toBe('2026-07');

    const fetched = await app.inject({ method: 'GET', url: `${base}/2026-07`, headers: AUTH });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().baseSalary).toBe(6000);

    const missing = await app.inject({ method: 'GET', url: `${base}/2026-01`, headers: AUTH });
    expect(missing.statusCode).toBe(404);

    expect(queries.some((query) => query.text.includes('insert into audit_event'))).toBe(true);
    expect(queries.some((query) => query.text.includes('insert into timeline_event'))).toBe(true);
    expect(queries.some((query) => query.text.includes('insert into idempotency_record'))).toBe(
      true,
    );
  });

  it('replays the same durable receipt for a repeated idempotency key', async () => {
    const { app, caseId, queries } = await buildApp();
    const url = `/cases/${caseId}/payroll-entries/2026-07`;

    const first = await app.inject({ method: 'PUT', url, headers: KEYED, payload: ENTRY_BODY });
    const second = await app.inject({ method: 'PUT', url, headers: KEYED, payload: ENTRY_BODY });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().replayed).toBe(true);
    expect(second.json().entry).toEqual(first.json().entry);
    expect(payrollInserts(queries)).toHaveLength(1);
  });

  it('refuses a reused idempotency key carrying a different payload', async () => {
    const { app, caseId } = await buildApp();
    const url = `/cases/${caseId}/payroll-entries/2026-07`;

    await app.inject({ method: 'PUT', url, headers: KEYED, payload: ENTRY_BODY });
    const conflicting = await app.inject({
      method: 'PUT',
      url,
      headers: KEYED,
      payload: { ...ENTRY_BODY, total: 9999 },
    });
    expect(conflicting.statusCode).toBe(409);
    expect(conflicting.json().code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('refuses a stale version instead of silently overwriting', async () => {
    const { app, caseId } = await buildApp();
    const url = `/cases/${caseId}/payroll-entries/2026-07`;

    await app.inject({ method: 'PUT', url, headers: KEYED, payload: ENTRY_BODY });
    const stale = await app.inject({
      method: 'PUT',
      url,
      headers: { ...AUTH, 'idempotency-key': 'payroll-route-key-0002' },
      payload: { ...ENTRY_BODY, status: 'final', version: 5 },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe('VERSION_CONFLICT');
  });
});
