/**
 * One night's measurement of one tenant. Counts and byte sizes only.
 *
 * Nothing in this record can identify a person or reconstruct content, because
 * the detector runs unattended across every tenant and its output ends up in
 * logs. A census that carried names would turn the safety control into a
 * privacy incident of its own.
 */
export interface TenantCensus {
  tenantId: string;
  observedAt: string;
  /** Null when `tenant_workspace` holds no row for this tenant at all. */
  workspaceVersion: number | null;
  /** Size of the stored jsonb. Encrypted payloads preserve plaintext length. */
  workspacePayloadBytes: number | null;
  /**
   * Null means the payload could not be decrypted under the current key, which
   * is a finding rather than a missing measurement - see `workspaceReadable`.
   */
  workspacePopulatedEntries: number | null;
  /**
   * False only when a payload exists and did not decrypt. A tenant with no
   * workspace row at all is `true`: there was nothing to fail to read.
   */
  workspaceReadable: boolean;
  workspaceHistoryVersions: number;
  workspaceFileRows: number;
  documentRows: number;
  taskRows: number;
  employmentCaseRows: number;
  payrollEntryRows: number;
}

export interface TenantCensusRepository {
  /**
   * Measures every open tenant in one pass. Crosses tenant boundaries by
   * design: a tenant whose rows have all disappeared cannot be found by
   * iterating the tenants you already know are populated.
   */
  collect(): Promise<TenantCensus[]>;
  /** The most recent stored census for a tenant, or null on the first run. */
  findPrevious(tenantId: string): Promise<TenantCensus | null>;
  record(census: TenantCensus): Promise<void>;
}
