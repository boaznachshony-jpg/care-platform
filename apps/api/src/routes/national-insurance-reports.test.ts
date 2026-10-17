import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { agorotFromShekels, percentOfAgorot, shekelsOf } from '@caredesk/domain';
import { buildContainer, DEV_TOKEN } from '../container.js';
import { buildServer } from '../create-server.js';
import { loadEnv } from '../env.js';
import { NATIONAL_INSURANCE_REPORT_RATE_LIMITS } from './national-insurance-reports.js';

/**
 * R5-09, stage 1. The routes register only on a Postgres-backed container, so
 * - as in payroll-entries.test.ts - a pg-shaped stateful stub answers the
 * service's own statements and fails loudly on any statement it does not
 * recognise. The real database (constraints, RLS, the partial-index conflict
 * target) is exercised by rls-check.ts in CI's postgres-rls job.
 */

const AUTH = { authorization: `Bearer ${DEV_TOKEN}` };
const CASE_BODY = {
  careRecipient: { fullName: 'Synthetic Care Recipient' },
  employer: { fullName: 'Synthetic Employer', relationshipToRecipient: 'child' },
  caregiver: { legalName: 'Synthetic Caregiver', nationality: 'Philippines' },
  startDate: '2026-02-01',
};
const UNKNOWN_CASE_ID = '00000000-0000-4000-8000-00000000dead';
const RATE = 3.55;

/** wage x rate to the agora - computed with the same domain functions the screen uses. */
const amountFor = (wage: number, rate = RATE) =>
  shekelsOf(percentOfAgorot(agorotFromShekels(wage), rate));

// Synthetic wages only.
const line = (month: string, wage: number, employed = true) => ({
  month,
  employed,
  wage: employed ? wage : 0,
  ratePercent: RATE,
  amount: employed ? amountFor(wage) : 0,
});
const Q3 = {
  legacyExpenseId: 'expense-ni-2026-q3',
  dueDate: '2026-10-15',
  months: [line('2026-07', 6000), line('2026-08', 6123), line('2026-09', 0, false)],
};

interface ReportState {
  id: string;
  caseId: string;
  legacyExpenseId: string | null;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  version: number;
}
interface LineState {
  reportId: string;
  month: string;
  employed: boolean;
  wage: number;
  rate: number;
  amount: number;
  version: number;
}

function stubPool(knownCaseIds: Set<string>) {
  const statements: string[] = [];
  const audits: string[] = [];
  const state = { manager: true };
  const reports = new Map<string, ReportState>();
  const lines: LineState[] = [];
  const now = new Date('2026-10-17T10:00:00.000Z');

  const reportRow = (report: ReportState) => ({
    id: report.id,
    legacy_expense_id: report.legacyExpenseId,
    period_start: report.periodStart,
    period_end: report.periodEnd,
    due_date: report.dueDate,
    version: report.version,
    created_at: now,
    updated_at: now,
  });
  const lineRow = (entry: LineState) => ({
    report_id: entry.reportId,
    month: entry.month,
    employed: entry.employed,
    wage: entry.wage,
    rate_percent: entry.rate.toFixed(2),
    amount: entry.amount.toFixed(2),
  });
  const linesOf = (reportIds: string[]) =>
    lines
      .filter((entry) => reportIds.includes(entry.reportId))
      .sort((left, right) => left.month.localeCompare(right.month))
      .map(lineRow);
  const result = (rows: unknown[]) => ({ rows, rowCount: rows.length });

  const client = {
    query: async (text: string, values: unknown[] = []) => {
      const sql = text.replace(/\s+/g, ' ').trim().toLowerCase();
      statements.push(sql);
      if (
        sql === 'begin' ||
        sql === 'commit' ||
        sql === 'rollback' ||
        sql.startsWith('set local role') ||
        sql.includes('set_config')
      )
        return result([]);
      if (sql.includes('from tenant_membership'))
        return { rows: [], rowCount: state.manager ? 1 : 0 };
      if (sql.startsWith('select 1 from employment_case'))
        return { rows: [], rowCount: knownCaseIds.has(String(values[0])) ? 1 : 0 };
      if (sql.startsWith('insert into national_insurance_report (')) {
        const [id, , caseId, periodStart, periodEnd, dueDate, legacyExpenseId] = values.map(String);
        const exists = [...reports.values()].some(
          (report) => report.caseId === caseId && report.legacyExpenseId === legacyExpenseId,
        );
        if (exists) return result([]);
        reports.set(id!, {
          id: id!,
          caseId: caseId!,
          legacyExpenseId: legacyExpenseId!,
          periodStart: periodStart!,
          periodEnd: periodEnd!,
          dueDate: dueDate!,
          version: 1,
        });
        return result([{ id }]);
      }
      if (sql.startsWith('select') && sql.includes('from national_insurance_report where')) {
        if (sql.includes('and legacy_expense_id = $2')) {
          const found = [...reports.values()].find(
            (report) => report.caseId === values[0] && report.legacyExpenseId === values[1],
          );
          return result(found ? [reportRow(found)] : []);
        }
        if (sql.includes('where id = $1')) {
          const found = reports.get(String(values[0]));
          return result(found ? [reportRow(found)] : []);
        }
        if (sql.includes('where employment_case_id = $1 order by')) {
          return result(
            [...reports.values()]
              .filter((report) => report.caseId === values[0])
              .sort((left, right) => right.periodStart.localeCompare(left.periodStart))
              .map(reportRow),
          );
        }
      }
      if (sql.startsWith('select') && sql.includes('from national_insurance_report_month')) {
        if (sql.includes('report_id = any(')) return result(linesOf(values[0] as string[]));
        if (sql.includes('where report_id = $1')) return result(linesOf([String(values[0])]));
      }
      if (sql.startsWith('insert into national_insurance_report_month')) {
        lines.push({
          reportId: String(values[2]),
          month: String(values[3]),
          employed: Boolean(values[4]),
          wage: Number(values[5]),
          rate: Number(values[6]),
          amount: Number(values[7]),
          version: 1,
        });
        return result([]);
      }
      if (sql.startsWith('update national_insurance_report_month')) {
        const entry = lines.find(
          (candidate) => candidate.reportId === values[0] && candidate.month === values[1],
        );
        if (entry) {
          entry.employed = Boolean(values[2]);
          entry.wage = Number(values[3]);
          entry.rate = Number(values[4]);
          entry.amount = Number(values[5]);
          entry.version += 1;
        }
        return { rows: [], rowCount: entry ? 1 : 0 };
      }
      if (sql.startsWith('update national_insurance_report set')) {
        const report = reports.get(String(values[0]));
        if (report) {
          report.periodStart = String(values[1]);
          report.periodEnd = String(values[2]);
          report.dueDate = String(values[3]);
          report.version += 1;
        }
        return { rows: [], rowCount: report ? 1 : 0 };
      }
      if (sql.startsWith('insert into audit_event')) {
        audits.push(`${String(values[3])}|${sql.includes("'import'") ? 'import' : 'other'}`);
        return result([]);
      }
      throw new Error(`unexpected sql in stub: ${text}`);
    },
    release: () => undefined,
  };
  const pool = { connect: async () => client } as unknown as Pool;
  return { pool, statements, audits, state, lines, reports };
}

async function buildApp() {
  const knownCaseIds = new Set<string>();
  const stub = stubPool(knownCaseIds);
  const container = buildContainer(loadEnv({}));
  container.pool = stub.pool;
  const app = buildServer(loadEnv({}), container);
  const created = await app.inject({
    method: 'POST',
    url: '/cases',
    headers: AUTH,
    payload: CASE_BODY,
  });
  const caseId = created.json<{ id: string }>().id;
  knownCaseIds.add(caseId);
  return { app, caseId, ...stub };
}

/** Every attempted write, including an insert that a conflict turns into a no-op. */
const writes = (statements: string[]) =>
  statements.filter((sql) =>
    /^(insert into national_insurance|update national_insurance)/.test(sql),
  );

/**
 * Writes that change something. A repeated copy still ATTEMPTS the report
 * insert - `on conflict ... do nothing` is how it learns the report exists -
 * and that attempt changes nothing, in the database and in this stub alike.
 */
const changes = (statements: string[]) =>
  statements.filter((sql) =>
    /^(insert into national_insurance_report_month|update national_insurance)/.test(sql),
  );

function importReport(
  app: Awaited<ReturnType<typeof buildApp>>['app'],
  caseId: string,
  payload: unknown,
) {
  return app.inject({
    method: 'POST',
    url: `/cases/${caseId}/national-insurance-reports/import`,
    headers: AUTH,
    payload: payload as Record<string, unknown>,
  });
}

describe('National Insurance report routes (R5-09 stage 1)', () => {
  it('declares bounded rate limits', () => {
    expect(NATIONAL_INSURANCE_REPORT_RATE_LIMITS).toEqual({
      list: { max: 60, timeWindow: 60_000, bucket: 'list' },
      import: { max: 30, timeWindow: 60_000, bucket: 'import' },
    });
  });

  it('requires authentication on both routes', async () => {
    const { app, caseId } = await buildApp();
    const list = await app.inject({
      method: 'GET',
      url: `/cases/${caseId}/national-insurance-reports`,
    });
    const copy = await app.inject({
      method: 'POST',
      url: `/cases/${caseId}/national-insurance-reports/import`,
      payload: Q3,
    });
    expect(list.statusCode).toBe(401);
    expect(copy.statusCode).toBe(401);
  });

  it('answers an unknown or cross-tenant case with the indistinguishable 404, writing nothing', async () => {
    const { app, statements } = await buildApp();
    const response = await importReport(app, UNKNOWN_CASE_ID, Q3);
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: 'NOT_FOUND' });
    expect(writes(statements)).toEqual([]);
  });

  it.each([
    ['a malformed month', { ...Q3, months: [{ ...line('2026-07', 6000), month: '2026-13' }] }],
    [
      'a wage in a month not employed',
      { ...Q3, months: [{ ...line('2026-07', 0, false), wage: 6000 }] },
    ],
    ['the same month twice', { ...Q3, months: [line('2026-07', 6000), line('2026-07', 6000)] }],
    [
      'a rate with three decimals',
      { ...Q3, months: [{ ...line('2026-07', 6000), ratePercent: 3.555 }] },
    ],
    ['a fractional wage', { ...Q3, months: [{ ...line('2026-07', 6000), wage: 6000.5 }] }],
    ['no months at all', { ...Q3, months: [] }],
    ['an unknown field', { ...Q3, total: 1 }],
  ])('refuses %s with 400 before any write', async (_label, payload) => {
    const { app, caseId, statements } = await buildApp();
    const response = await importReport(app, caseId, payload);
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(writes(statements)).toEqual([]);
  });

  it('lets only an owner or manager copy a report, while reading stays open', async () => {
    const { app, caseId, state, statements } = await buildApp();
    state.manager = false;
    const copy = await importReport(app, caseId, Q3);
    expect(copy.statusCode).toBe(403);
    expect(copy.json()).toMatchObject({ code: 'MANAGER_REQUIRED' });
    expect(writes(statements)).toEqual([]);
    const list = await app.inject({
      method: 'GET',
      url: `/cases/${caseId}/national-insurance-reports`,
      headers: AUTH,
    });
    expect(list.statusCode).toBe(200);
  });

  it('copies a saved payment: one report, its lines as filed, an audit entry, inside the tenant envelope', async () => {
    const { app, caseId, statements, audits } = await buildApp();
    const response = await importReport(app, caseId, Q3);
    expect(response.statusCode).toBe(201);
    const body = response.json<{
      outcome: string;
      report: {
        legacyExpenseId: string;
        periodStart: string;
        periodEnd: string;
        dueDate: string;
        version: number;
        months: Array<{ month: string; employed: boolean; wage: number; amount: number }>;
      };
    }>();
    expect(body.outcome).toBe('created');
    expect(body.report).toMatchObject({
      legacyExpenseId: 'expense-ni-2026-q3',
      periodStart: '2026-07',
      periodEnd: '2026-09',
      dueDate: '2026-10-15',
      version: 1,
    });
    expect(body.report.months).toEqual(Q3.months);
    expect(audits).toEqual(['national_insurance_report.imported|import']);
    // Root 6: every statement ran as caredesk_app inside withTenant.
    expect(statements.some((sql) => sql.startsWith('set local role'))).toBe(true);
    expect(statements.some((sql) => sql.startsWith('delete'))).toBe(false);
  });

  it('returns the same report, writing nothing, when the same payment is copied again', async () => {
    const { app, caseId, statements, audits, reports, lines } = await buildApp();
    const first = await importReport(app, caseId, Q3);
    const changesAfterFirst = changes(statements).length;
    const again = await importReport(app, caseId, Q3);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({
      outcome: 'unchanged',
      report: { id: first.json<{ report: { id: string } }>().report.id, version: 1 },
    });
    expect(changes(statements)).toHaveLength(changesAfterFirst);
    expect(reports.size).toBe(1);
    expect(lines).toHaveLength(3);
    expect(audits).toHaveLength(1);
  });

  it('applies a corrected line in place, with a new version and an audit entry', async () => {
    const { app, caseId, audits, lines } = await buildApp();
    await importReport(app, caseId, Q3);
    const corrected = {
      ...Q3,
      months: [line('2026-07', 6000), line('2026-08', 6400), line('2026-09', 0, false)],
    };
    const response = await importReport(app, caseId, corrected);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ outcome: 'updated', report: { version: 2 } });
    expect(response.json<{ report: { months: unknown[] } }>().report.months).toEqual(
      corrected.months,
    );
    expect(lines.find((entry) => entry.month === '2026-08')).toMatchObject({
      wage: 6400,
      version: 2,
    });
    expect(lines.find((entry) => entry.month === '2026-07')).toMatchObject({ version: 1 });
    expect(audits).toEqual([
      'national_insurance_report.imported|import',
      'national_insurance_report.updated|import',
    ]);
  });

  it('adds a month the server did not have yet', async () => {
    const { app, caseId } = await buildApp();
    await importReport(app, caseId, { ...Q3, months: Q3.months.slice(0, 2) });
    const response = await importReport(app, caseId, Q3);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      outcome: 'updated',
      report: { periodEnd: '2026-09', version: 2 },
    });
    expect(response.json<{ report: { months: unknown[] } }>().report.months).toHaveLength(3);
  });

  it('refuses a copy that would drop a month already held, and changes nothing', async () => {
    const { app, caseId, statements, lines, reports } = await buildApp();
    await importReport(app, caseId, Q3);
    const changesBefore = changes(statements).length;
    const response = await importReport(app, caseId, { ...Q3, months: Q3.months.slice(0, 2) });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: 'INVALID_STATE_TRANSITION',
      fieldErrors: { 'months.2026-09': ['month_removed'] },
    });
    expect(changes(statements)).toHaveLength(changesBefore);
    expect(lines).toHaveLength(3);
    expect([...reports.values()][0]).toMatchObject({ version: 1, periodEnd: '2026-09' });
  });

  it('refuses a line whose amount is not wage x rate, before touching the database', async () => {
    const { app, caseId, statements } = await buildApp();
    const wrong = {
      ...Q3,
      months: [{ ...line('2026-07', 6000), amount: amountFor(6000) + 0.01 }],
    };
    const response = await importReport(app, caseId, wrong);
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      code: 'TOTAL_MISMATCH',
      fieldErrors: { 'months.2026-07': ['amount_mismatch'] },
    });
    expect(writes(statements)).toEqual([]);
    expect(statements.some((sql) => sql.startsWith('select 1 from employment_case'))).toBe(false);
  });

  it('lists the case reports with their lines, newest period first', async () => {
    const { app, caseId } = await buildApp();
    await importReport(app, caseId, Q3);
    await importReport(app, caseId, {
      legacyExpenseId: 'expense-ni-2026-q2',
      dueDate: '2026-07-15',
      months: [line('2026-04', 6000), line('2026-05', 6000), line('2026-06', 6000)],
    });
    const response = await app.inject({
      method: 'GET',
      url: `/cases/${caseId}/national-insurance-reports`,
      headers: AUTH,
    });
    expect(response.statusCode).toBe(200);
    const reports = response.json<Array<{ periodStart: string; months: unknown[] }>>();
    expect(reports.map((report) => report.periodStart)).toEqual(['2026-07', '2026-04']);
    expect(reports.map((report) => report.months.length)).toEqual([3, 3]);
  });
});
