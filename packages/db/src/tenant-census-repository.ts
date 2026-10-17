import type { TenantCensus, TenantCensusRepository } from '@caredesk/application';
import type { Pool } from 'pg';
import { withAppRole, withTenant } from './pool.js';
import {
  measureNationalInsuranceReports,
  type NationalInsuranceMeasurement,
  type StoredReport,
} from './national-insurance-reconciliation.js';
import {
  countPopulatedEntries,
  decryptPayload,
  isEncryptedEnvelope,
} from './workspace-payload-crypto.js';

interface CensusRow {
  tenant_id: string;
  workspace_version: number | null;
  workspace_payload_bytes: string | null;
  workspace_history_versions: number;
  workspace_file_rows: number;
  document_rows: number;
  task_rows: number;
  employment_case_rows: number;
  payroll_entry_rows: number;
}

interface StoredCensusRow extends CensusRow {
  observed_at: Date;
  workspace_populated_entries: number | null;
}

/**
 * Reads and writes `tenant_data_census` (0038).
 *
 * The two halves use different connections on purpose. `collect()` runs under
 * `withAppRole` because it must see every tenant before it knows which tenants
 * are still there; it reaches that data only through the SECURITY DEFINER
 * function, which returns counts. `findPrevious()` and `record()` run under
 * `withTenant` like everything else, so the stored census obeys RLS.
 */
export class PgTenantCensusRepository implements TenantCensusRepository {
  constructor(
    private readonly pool: Pool,
    private readonly encryptionKeys?: string | readonly string[],
  ) {}

  async collect(): Promise<TenantCensus[]> {
    const rows = await withAppRole(this.pool, async (client) => {
      const result = await client.query<CensusRow>('select * from caredesk_tenant_data_census()');
      return result.rows;
    });

    const observations: TenantCensus[] = [];
    for (const row of rows) {
      // The populated-entry count needs the plaintext, and the plaintext needs
      // a tenant-scoped read. The census function deliberately does not return
      // the payload, so this is a second, narrow read per tenant rather than a
      // wider elevated one.
      const entries = await this.countEntries(row.tenant_id, row.workspace_version !== null);
      // R5-09 is a measurement riding on a safety control, never a reason for
      // that control to stop. Whatever goes wrong here - a query, an
      // unexpected payload shape - this tenant's row records "not measured"
      // (null) and the data-loss census carries on for every tenant.
      const nationalInsurance = entries.payload
        ? await this.measureNationalInsurance(row.tenant_id, entries.payload).catch(() => null)
        : null;
      observations.push({
        tenantId: row.tenant_id,
        observedAt: new Date().toISOString(),
        workspaceVersion: row.workspace_version,
        workspacePayloadBytes:
          row.workspace_payload_bytes === null ? null : Number(row.workspace_payload_bytes),
        workspacePopulatedEntries: entries.count,
        workspaceReadable: entries.readable,
        workspaceHistoryVersions: row.workspace_history_versions,
        workspaceFileRows: row.workspace_file_rows,
        documentRows: row.document_rows,
        taskRows: row.task_rows,
        employmentCaseRows: row.employment_case_rows,
        payrollEntryRows: row.payroll_entry_rows,
        nationalInsuranceWorkspaceReports: nationalInsurance?.workspaceReports ?? null,
        nationalInsuranceUnreconciledReports: nationalInsurance?.unreconciledReports ?? null,
      });
    }
    return observations;
  }

  /**
   * R5-09 stage 3: compares the workspace's National Insurance report lines
   * with the canonical table, for one tenant. Counts only - nothing from the
   * payload or the table leaves this method. Null when the payload will not
   * open, which the populated-entry count already reports as a finding.
   */
  private async measureNationalInsurance(
    tenantId: string,
    payload: Record<string, string>,
  ): Promise<NationalInsuranceMeasurement | null> {
    let entries: Record<string, string>;
    try {
      entries = decryptPayload(payload, tenantId, this.encryptionKeys);
    } catch {
      return null;
    }
    const reports = await withTenant(this.pool, tenantId, async (client) => {
      // The case's legacy client id: a payment is matched on client AND id
      // (see measureNationalInsuranceReports).
      const header = await client.query<{
        id: string;
        legacy_client_id: string | null;
        legacy_expense_id: string | null;
        due_date: string;
      }>(
        `select r.id, c.legacy_client_id, r.legacy_expense_id, r.due_date::text as due_date
           from national_insurance_report r
           join employment_case c on c.id = r.employment_case_id`,
      );
      if (!header.rows.length) return [];
      const lines = await client.query<{
        report_id: string;
        month: string;
        employed: boolean;
        wage: number;
        rate_percent: string;
        amount: string;
      }>(
        `select report_id, to_char(month, 'YYYY-MM') as month, employed, wage,
                rate_percent::text as rate_percent, amount::text as amount
           from national_insurance_report_month`,
      );
      return header.rows.map((report): StoredReport => ({
        legacyClientId: report.legacy_client_id,
        legacyExpenseId: report.legacy_expense_id,
        dueDate: report.due_date,
        months: lines.rows
          .filter((line) => line.report_id === report.id)
          .map((line) => ({
            month: line.month,
            employed: line.employed,
            wage: Number(line.wage),
            ratePercent: Number(line.rate_percent),
            amount: Number(line.amount),
          })),
      }));
    });
    return measureNationalInsuranceReports(entries, reports);
  }

  private async countEntries(
    tenantId: string,
    hasWorkspace: boolean,
  ): Promise<{ count: number | null; readable: boolean; payload?: Record<string, string> }> {
    // No row means nothing failed to decrypt. Reporting `readable: false` here
    // would raise a key alarm for a tenant that simply has not saved yet.
    if (!hasWorkspace) return { count: null, readable: true };
    const payload = await withTenant(this.pool, tenantId, async (client) => {
      const result = await client.query<{ payload: Record<string, string> }>(
        'select payload from tenant_workspace where tenant_id = $1',
        [tenantId],
      );
      return result.rows[0]?.payload ?? null;
    });
    if (!payload) return { count: null, readable: true };
    const count = countPopulatedEntries(payload, tenantId, this.encryptionKeys);
    // A plaintext row without a configured key is legitimate (the repository
    // re-encrypts it on the next read); an envelope that will not open is not.
    const readable = count !== null || !isEncryptedEnvelope(payload);
    return { count, readable, payload };
  }

  async findPrevious(tenantId: string): Promise<TenantCensus | null> {
    return withTenant(this.pool, tenantId, async (client) => {
      const result = await client.query<StoredCensusRow>(
        `select tenant_id, observed_at, workspace_version, workspace_payload_bytes,
                workspace_populated_entries, workspace_history_versions, workspace_file_rows,
                document_rows, task_rows, employment_case_rows, payroll_entry_rows
           from tenant_data_census
          where tenant_id = $1
          order by observed_at desc
          limit 1`,
        [tenantId],
      );
      const row = result.rows[0];
      if (!row) return null;
      return {
        tenantId: row.tenant_id,
        observedAt: row.observed_at.toISOString(),
        workspaceVersion: row.workspace_version,
        workspacePayloadBytes:
          row.workspace_payload_bytes === null ? null : Number(row.workspace_payload_bytes),
        workspacePopulatedEntries: row.workspace_populated_entries,
        // Not stored: readability is a property of today's key against today's
        // payload, and a stale "it opened yesterday" is not evidence about now.
        workspaceReadable: true,
        workspaceHistoryVersions: row.workspace_history_versions,
        workspaceFileRows: row.workspace_file_rows,
        documentRows: row.document_rows,
        taskRows: row.task_rows,
        employmentCaseRows: row.employment_case_rows,
        payrollEntryRows: row.payroll_entry_rows,
      };
    });
  }

  async record(census: TenantCensus): Promise<void> {
    await withTenant(this.pool, census.tenantId, async (client) => {
      await client.query(
        `insert into tenant_data_census
           (tenant_id, observed_at, workspace_version, workspace_payload_bytes,
            workspace_populated_entries, workspace_history_versions, workspace_file_rows,
            document_rows, task_rows, employment_case_rows, payroll_entry_rows,
            national_insurance_workspace_reports, national_insurance_unreconciled_reports)
         values ($1, $2::timestamptz, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          census.tenantId,
          census.observedAt,
          census.workspaceVersion,
          census.workspacePayloadBytes,
          census.workspacePopulatedEntries,
          census.workspaceHistoryVersions,
          census.workspaceFileRows,
          census.documentRows,
          census.taskRows,
          census.employmentCaseRows,
          census.payrollEntryRows,
          census.nationalInsuranceWorkspaceReports ?? null,
          census.nationalInsuranceUnreconciledReports ?? null,
        ],
      );
    });
  }
}
