/**
 * The read side of `tenant_workspace_history` (migration 0035).
 *
 * 0035 built a write path and no read path. The archive has held every
 * superseded version since it was applied, and the only way to reach one was a
 * human with a database connection, the SQL, and the encryption key - under
 * incident pressure. This port is what turns that into an operation.
 */

/**
 * Enough to choose a version, and nothing more. Deliberately no payload: the
 * listing is shown in a browser and read by whoever is trying to recover, and
 * a list that carried twenty versions of a customer's data would widen the
 * blast radius of the recovery screen far beyond the recovery itself.
 */
export interface WorkspaceVersionSummary {
  version: number;
  schemaVersion: number;
  /** When the version was written, per the application clock at the time. */
  updatedAt: string;
  /** When the trigger superseded it. */
  archivedAt: string;
  /** Null when the archived payload does not decrypt under the current key. */
  populatedEntries: number | null;
  payloadBytes: number;
}

export interface ArchivedWorkspaceVersion {
  version: number;
  schemaVersion: number;
  payload: Record<string, string>;
}

export interface WorkspaceHistoryRepository {
  listVersions(tenantId: string, limit: number): Promise<WorkspaceVersionSummary[]>;
  /** Null when the version was never archived for this tenant. */
  findVersion(tenantId: string, version: number): Promise<ArchivedWorkspaceVersion | null>;
}
