import type { TenantCensus } from './ports/tenant-census-repository.js';

/**
 * The comparison, kept pure and away from the database.
 *
 * These thresholds are deliberately more sensitive than the write-time guard
 * in `workspace-repository.ts`. That guard refuses a customer's save, so it has
 * to be certain and it only fires at a two-thirds collapse. This one raises an
 * alert, so the cost of being wrong is a human glancing at a number. Detection
 * that waits for certainty is detection that arrives after the seven-day
 * backup window has closed.
 */

export type DataLossSignalCode =
  /** A tenant that has history but no live workspace row. */
  | 'WORKSPACE_ROW_MISSING'
  /** The row is there and the key no longer opens it. */
  | 'WORKSPACE_UNREADABLE'
  /** Keys present, every value blank - the 2026-08-29 incident exactly. */
  | 'WORKSPACE_BLANKED'
  /** Populated entries or stored bytes fell materially since the last census. */
  | 'WORKSPACE_SHRANK'
  /** A canonical table lost a material share of a tenant's rows. */
  | 'TENANT_ROWS_COLLAPSED';

export interface DataLossSignal {
  tenantId: string;
  code: DataLossSignalCode;
  /** What was measured, e.g. `document_rows`. Never a value from the data. */
  measure: string;
  before: number | null;
  after: number | null;
}

/**
 * A drop worth waking someone for: everything gone, or more than a quarter of
 * it gone. Deleting one task out of twelve is ordinary use and stays silent;
 * losing a third of a tenant's documents overnight is not.
 */
export function isMaterialDrop(before: number, after: number): boolean {
  if (after >= before) return false;
  if (before === 0) return false;
  if (after === 0) return true;
  return after * 4 < before * 3;
}

const COUNTED_TABLES = [
  'workspaceFileRows',
  'documentRows',
  'taskRows',
  'employmentCaseRows',
  'payrollEntryRows',
] as const satisfies readonly (keyof TenantCensus)[];

export function detectDataLoss(
  previous: TenantCensus | null,
  current: TenantCensus,
): DataLossSignal[] {
  const signals: DataLossSignal[] = [];
  const at = (
    code: DataLossSignalCode,
    measure: string,
    before: number | null,
    after: number | null,
  ) => signals.push({ tenantId: current.tenantId, code, measure, before, after });

  // Checked without reference to the previous census: history proves the
  // workspace existed, so its absence is loss even on the very first run.
  if (current.workspaceVersion === null && current.workspaceHistoryVersions > 0) {
    at('WORKSPACE_ROW_MISSING', 'workspace_version', previous?.workspaceVersion ?? null, null);
  }

  // Also independent of history: the key either opens the payload or it does
  // not, and a nightly job is the only thing that will ever ask.
  if (!current.workspaceReadable) {
    at('WORKSPACE_UNREADABLE', 'workspace_payload_bytes', null, current.workspacePayloadBytes);
  }

  if (
    current.workspacePopulatedEntries === 0 &&
    (current.workspaceHistoryVersions > 0 || (previous?.workspacePopulatedEntries ?? 0) > 0)
  ) {
    at(
      'WORKSPACE_BLANKED',
      'workspace_populated_entries',
      previous?.workspacePopulatedEntries ?? null,
      0,
    );
  }

  if (previous) {
    if (
      previous.workspacePopulatedEntries !== null &&
      current.workspacePopulatedEntries !== null &&
      current.workspacePopulatedEntries > 0 &&
      isMaterialDrop(previous.workspacePopulatedEntries, current.workspacePopulatedEntries)
    ) {
      at(
        'WORKSPACE_SHRANK',
        'workspace_populated_entries',
        previous.workspacePopulatedEntries,
        current.workspacePopulatedEntries,
      );
    }

    // The byte measure is kept even though the entry count usually moves with
    // it: bytes are read off the ciphertext, so this is the one workspace
    // signal that still fires when the encryption key is gone.
    if (
      previous.workspacePayloadBytes !== null &&
      current.workspacePayloadBytes !== null &&
      isMaterialDrop(previous.workspacePayloadBytes, current.workspacePayloadBytes)
    ) {
      at(
        'WORKSPACE_SHRANK',
        'workspace_payload_bytes',
        previous.workspacePayloadBytes,
        current.workspacePayloadBytes,
      );
    }

    for (const measure of COUNTED_TABLES) {
      const before = previous[measure] as number;
      const after = current[measure] as number;
      if (isMaterialDrop(before, after)) {
        at('TENANT_ROWS_COLLAPSED', snakeCase(measure), before, after);
      }
    }
  }

  return signals;
}

function snakeCase(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}
