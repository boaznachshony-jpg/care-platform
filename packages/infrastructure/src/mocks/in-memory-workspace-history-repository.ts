import type {
  ArchivedWorkspaceVersion,
  WorkspaceHistoryRepository,
  WorkspaceVersionSummary,
} from '@caredesk/application';

interface SeededVersion {
  tenantId: string;
  version: number;
  schemaVersion: number;
  payload: Record<string, string>;
  updatedAt: string;
  archivedAt: string;
}

/**
 * Stands in for the 0035 archive outside production.
 *
 * It does not archive automatically. In Postgres that job belongs to a trigger,
 * deliberately, so that writes bypassing the application are captured too; a
 * mock that archived in TypeScript would be modelling a mechanism that does not
 * exist and would hide the day someone drops the trigger. Tests seed the
 * versions they mean to restore.
 */
export class InMemoryWorkspaceHistoryRepository implements WorkspaceHistoryRepository {
  private readonly versions: SeededVersion[] = [];

  seed(version: SeededVersion): void {
    this.versions.push(version);
  }

  async listVersions(tenantId: string, limit: number): Promise<WorkspaceVersionSummary[]> {
    return this.versions
      .filter((row) => row.tenantId === tenantId)
      .sort((left, right) => right.version - left.version)
      .slice(0, limit)
      .map((row) => ({
        version: row.version,
        schemaVersion: row.schemaVersion,
        updatedAt: row.updatedAt,
        archivedAt: row.archivedAt,
        populatedEntries: Object.values(row.payload).filter((value) => value.trim() !== '').length,
        payloadBytes: Buffer.byteLength(JSON.stringify(row.payload), 'utf8'),
      }));
  }

  async findVersion(tenantId: string, version: number): Promise<ArchivedWorkspaceVersion | null> {
    const row = this.versions.find(
      (candidate) => candidate.tenantId === tenantId && candidate.version === version,
    );
    if (!row) return null;
    return {
      version: row.version,
      schemaVersion: row.schemaVersion,
      payload: { ...row.payload },
    };
  }
}
