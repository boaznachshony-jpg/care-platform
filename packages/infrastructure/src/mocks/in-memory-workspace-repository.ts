import type {
  SaveWorkspaceRecord,
  WorkspaceRecord,
  WorkspaceRepository,
} from '@caredesk/application';

export class InMemoryWorkspaceRepository implements WorkspaceRepository {
  private readonly rows = new Map<string, WorkspaceRecord>();

  async find(tenantId: string): Promise<WorkspaceRecord | null> {
    return this.rows.get(tenantId) ?? null;
  }

  async save(input: SaveWorkspaceRecord): Promise<WorkspaceRecord | null> {
    const current = this.rows.get(input.tenantId);
    if ((current?.version ?? 0) !== input.expectedVersion) return null;
    const saved: WorkspaceRecord = {
      tenantId: input.tenantId,
      schemaVersion: input.schemaVersion,
      payload: { ...input.payload },
      version: input.expectedVersion + 1,
      updatedAt: input.updatedAt,
    };
    this.rows.set(input.tenantId, saved);
    return saved;
  }
}
