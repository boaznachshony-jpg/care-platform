import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { withTenant } from '@caredesk/db';
import {
  agorotEqual,
  agorotFromShekels,
  MoneyError,
  percentOfAgorot,
  ZERO_AGOROT,
  type Agorot,
} from '@caredesk/domain';
import type {
  ImportNationalInsuranceReportRequest,
  NationalInsuranceReportMonth,
  NationalInsuranceReportResponse,
} from '@caredesk/schemas';

/**
 * R5-09, stage 1 - the National Insurance report as filed, in its canonical
 * home (migration 0049). Design approved by the owner on 17.10.2026:
 * docs/governance/R5-09-NATIONAL-INSURANCE-REPORT-TABLE.md.
 *
 * In stage 1 nothing in the product calls this. Stage 2 copies each saved
 * payment's lines here from the workspace; until stage 3 the workspace stays
 * the only write authority, and this table is a copy of it.
 *
 * Two rules carry the "no data is lost" requirement:
 *
 *   - Nothing is deleted. There is no delete grant (0049), and this service
 *     has no path that removes a report or a line. A copy that would drop a
 *     month the server already holds is refused, not applied: the workspace
 *     still has the data, the refusal is visible, and the measured
 *     reconciliation of stage 3 counts it.
 *
 *   - The amount is the server's. Each line's amount is recomputed as
 *     wage x rate in agorot, exactly as the payroll screen computes it
 *     (`nationalInsuranceAmount`, PayrollPage.tsx); a line that does not
 *     match is refused rather than stored.
 */

type Actor = { tenantId: string; userId: string; correlationId: string };

export type NationalInsuranceReportFailure = 'case_not_found' | 'amount_mismatch' | 'month_removed';

export class NationalInsuranceReportError extends Error {
  constructor(
    readonly failure: NationalInsuranceReportFailure,
    /** The wage month the failure is about, when there is one. */
    readonly month?: string,
  ) {
    super(failure);
  }
}

export type NationalInsuranceImportOutcome = 'created' | 'updated' | 'unchanged';

interface ReportRow {
  id: string;
  legacy_expense_id: string | null;
  period_start: string;
  period_end: string;
  due_date: string;
  version: number;
  created_at: Date;
  updated_at: Date;
}

interface MonthRow {
  report_id: string;
  month: string;
  employed: boolean;
  wage: number;
  rate_percent: string;
  amount: string;
}

const REPORT_COLUMNS = `id, legacy_expense_id, to_char(period_start, 'YYYY-MM') as period_start,
  to_char(period_end, 'YYYY-MM') as period_end, due_date::text as due_date, version,
  created_at, updated_at`;
const MONTH_COLUMNS = `report_id, to_char(month, 'YYYY-MM') as month, employed, wage,
  rate_percent::text as rate_percent, amount::text as amount`;

const toLine = (row: MonthRow): NationalInsuranceReportMonth => ({
  month: row.month,
  employed: row.employed,
  wage: Number(row.wage),
  ratePercent: Number(row.rate_percent),
  amount: Number(row.amount),
});

const toReport = (row: ReportRow, lines: MonthRow[]): NationalInsuranceReportResponse => ({
  id: row.id,
  legacyExpenseId: row.legacy_expense_id,
  periodStart: row.period_start,
  periodEnd: row.period_end,
  dueDate: row.due_date,
  version: Number(row.version),
  months: lines.filter((line) => line.report_id === row.id).map(toLine),
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

/** wage x rate, to the agora - the same arithmetic as the payroll screen. */
function expectedAmount(line: NationalInsuranceReportMonth): Agorot {
  if (!line.employed || line.wage <= 0 || line.ratePercent <= 0) return ZERO_AGOROT;
  return percentOfAgorot(agorotFromShekels(line.wage), line.ratePercent);
}

function amountMatches(line: NationalInsuranceReportMonth): boolean {
  try {
    return agorotEqual(agorotFromShekels(line.amount), expectedAmount(line));
  } catch (error) {
    // More precision than an agora is not an amount the screen produces.
    if (error instanceof MoneyError) return false;
    throw error;
  }
}

function sameLine(stored: NationalInsuranceReportMonth, incoming: NationalInsuranceReportMonth) {
  return (
    stored.employed === incoming.employed &&
    stored.wage === incoming.wage &&
    stored.ratePercent === incoming.ratePercent &&
    agorotEqual(agorotFromShekels(stored.amount), agorotFromShekels(incoming.amount))
  );
}

export class NationalInsuranceReportService {
  constructor(private readonly pool: Pool) {}

  /** Every tenant-scoped statement goes through withTenant (Root 6, check-tenant-db-path.mjs). */
  private tx<T>(tenantId: string, work: (client: PoolClient) => Promise<T>): Promise<T> {
    return withTenant(this.pool, tenantId, work);
  }

  list(actor: Actor, caseId: string): Promise<NationalInsuranceReportResponse[]> {
    return this.tx(actor.tenantId, async (client) => {
      const reports = await client.query<ReportRow>(
        `select ${REPORT_COLUMNS} from national_insurance_report
          where employment_case_id = $1 order by period_start desc, created_at desc`,
        [caseId],
      );
      if (!reports.rows.length) return [];
      const lines = await client.query<MonthRow>(
        `select ${MONTH_COLUMNS} from national_insurance_report_month
          where report_id = any($1::uuid[]) order by month`,
        [reports.rows.map((row) => row.id)],
      );
      return reports.rows.map((row) => toReport(row, lines.rows));
    });
  }

  /**
   * Stage 2's copy of one saved payment. Idempotent on `legacyExpenseId`:
   * a first copy creates the report, a repeat with the same lines changes
   * nothing, and a repeat with corrected lines updates them in place (version
   * + audit). It never removes a month.
   */
  importReport(
    actor: Actor,
    caseId: string,
    input: ImportNationalInsuranceReportRequest,
  ): Promise<{ report: NationalInsuranceReportResponse; outcome: NationalInsuranceImportOutcome }> {
    return this.tx(actor.tenantId, async (client) => {
      // Recomputed before the case lookup on purpose (the DOM-02 rule): a
      // report that does not reconcile must not reach any write.
      const mismatch = input.months.find((line) => !amountMatches(line));
      if (mismatch) throw new NationalInsuranceReportError('amount_mismatch', mismatch.month);

      const exists = await client.query('select 1 from employment_case where id = $1', [caseId]);
      if (!exists.rowCount) throw new NationalInsuranceReportError('case_not_found');

      const months = input.months.map((line) => line.month).sort();
      const periodStart = months[0]!;
      const periodEnd = months[months.length - 1]!;

      const inserted = await client.query<{ id: string }>(
        `insert into national_insurance_report
           (id, tenant_id, employment_case_id, period_start, period_end, due_date,
            legacy_expense_id, created_by, updated_by)
         values ($1, $2, $3, ($4 || '-01')::date, ($5 || '-01')::date, $6::date, $7, $8, $8)
         on conflict (tenant_id, employment_case_id, legacy_expense_id)
           where legacy_expense_id is not null do nothing
         returning id`,
        [
          randomUUID(),
          actor.tenantId,
          caseId,
          periodStart,
          periodEnd,
          input.dueDate,
          input.legacyExpenseId,
          actor.userId,
        ],
      );

      if (inserted.rows[0]) {
        const reportId = inserted.rows[0].id;
        for (const line of input.months) await this.insertLine(client, actor, reportId, line);
        await this.audit(
          client,
          actor,
          reportId,
          'national_insurance_report.imported',
          `National Insurance report copied with ${input.months.length} month line(s).`,
        );
        return { report: await this.read(client, reportId), outcome: 'created' };
      }

      // A report already exists for this payment: lock it and compare.
      const existing = await client.query<ReportRow>(
        `select ${REPORT_COLUMNS} from national_insurance_report
          where employment_case_id = $1 and legacy_expense_id = $2 for update`,
        [caseId, input.legacyExpenseId],
      );
      const report = existing.rows[0];
      if (!report) throw new NationalInsuranceReportError('case_not_found');
      const storedLines = await client.query<MonthRow>(
        `select ${MONTH_COLUMNS} from national_insurance_report_month
          where report_id = $1 order by month for update`,
        [report.id],
      );
      const stored = new Map(storedLines.rows.map((row) => [row.month, toLine(row)]));
      const incoming = new Map(input.months.map((line) => [line.month, line]));

      const removed = [...stored.keys()].find((month) => !incoming.has(month));
      if (removed) throw new NationalInsuranceReportError('month_removed', removed);

      const changed = input.months.filter((line) => {
        const previous = stored.get(line.month);
        return previous !== undefined && !sameLine(previous, line);
      });
      const added = input.months.filter((line) => !stored.has(line.month));
      const periodChanged = report.period_start !== periodStart || report.period_end !== periodEnd;
      const dueDateChanged = report.due_date !== input.dueDate;

      if (!changed.length && !added.length && !periodChanged && !dueDateChanged) {
        return { report: toReport(report, storedLines.rows), outcome: 'unchanged' };
      }

      for (const line of changed) {
        await client.query(
          `update national_insurance_report_month
              set employed = $3, wage = $4, rate_percent = $5, amount = $6,
                  updated_at = now(), updated_by = $7, version = version + 1
            where report_id = $1 and month = ($2 || '-01')::date`,
          [
            report.id,
            line.month,
            line.employed,
            line.wage,
            line.ratePercent,
            line.amount,
            actor.userId,
          ],
        );
      }
      for (const line of added) await this.insertLine(client, actor, report.id, line);
      await client.query(
        `update national_insurance_report
            set period_start = ($2 || '-01')::date, period_end = ($3 || '-01')::date,
                due_date = $4::date, updated_at = now(), updated_by = $5, version = version + 1
          where id = $1`,
        [report.id, periodStart, periodEnd, input.dueDate, actor.userId],
      );
      await this.audit(
        client,
        actor,
        report.id,
        'national_insurance_report.updated',
        `National Insurance report re-copied: ${changed.length} line(s) corrected, ` +
          `${added.length} added${dueDateChanged ? ', due date changed' : ''}.`,
      );
      return { report: await this.read(client, report.id), outcome: 'updated' };
    });
  }

  private insertLine(
    client: PoolClient,
    actor: Actor,
    reportId: string,
    line: NationalInsuranceReportMonth,
  ) {
    return client.query(
      `insert into national_insurance_report_month
         (id, tenant_id, report_id, month, employed, wage, rate_percent, amount, created_by, updated_by)
       values ($1, $2, $3, ($4 || '-01')::date, $5, $6, $7, $8, $9, $9)`,
      [
        randomUUID(),
        actor.tenantId,
        reportId,
        line.month,
        line.employed,
        line.wage,
        line.ratePercent,
        line.amount,
        actor.userId,
      ],
    );
  }

  /** Never the wages or amounts themselves - the audit names the change, not its contents. */
  private audit(
    client: PoolClient,
    actor: Actor,
    reportId: string,
    action: string,
    summary: string,
  ) {
    return client.query(
      `insert into audit_event
         (id, tenant_id, actor_id, action, resource_type, resource_id, occurred_at,
          correlation_id, source_channel, purpose, change_summary, sensitivity)
       values ($1, $2, $3, $4, 'national_insurance_report', $5, now(), $6, 'import',
               'national_insurance_report', $7, 'financial_sensitive')`,
      [randomUUID(), actor.tenantId, actor.userId, action, reportId, actor.correlationId, summary],
    );
  }

  private async read(
    client: PoolClient,
    reportId: string,
  ): Promise<NationalInsuranceReportResponse> {
    const report = await client.query<ReportRow>(
      `select ${REPORT_COLUMNS} from national_insurance_report where id = $1`,
      [reportId],
    );
    const lines = await client.query<MonthRow>(
      `select ${MONTH_COLUMNS} from national_insurance_report_month
        where report_id = $1 order by month`,
      [reportId],
    );
    return toReport(report.rows[0]!, lines.rows);
  }
}
