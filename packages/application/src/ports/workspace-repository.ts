export interface WorkspaceRecord {
  tenantId: string;
  schemaVersion: number;
  payload: Record<string, string>;
  version: number;
  updatedAt: string;
}

export interface SaveWorkspaceRecord {
  tenantId: string;
  schemaVersion: number;
  payload: Record<string, string>;
  expectedVersion: number;
  updatedBy: string;
  updatedAt: string;
}

export interface WorkspaceRepository {
  find(tenantId: string): Promise<WorkspaceRecord | null>;
  /** Returns null when optimistic concurrency detects a stale version. */
  save(input: SaveWorkspaceRecord): Promise<WorkspaceRecord | null>;
}
