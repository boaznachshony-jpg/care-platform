import type {
  SaveWorkspaceRecord,
  WorkspaceRecord,
  WorkspaceRepository,
} from '@caredesk/application';
import {
  isDestructiveShrink,
  populatedEntryCount,
  WorkspaceShrinkRejectedError,
} from '@caredesk/application';

export class InMemoryWorkspaceRepository implements WorkspaceRepository {
  private readonly rows = new Map<string, WorkspaceRecord>();

  async find(tenantId: string): Promise<WorkspaceRecord | null> {
    return this.rows.get(tenantId) ?? null;
  }

  async save(input: SaveWorkspaceRecord): Promise<WorkspaceRecord | null> {
    const current = this.rows.get(input.tenantId);
    if ((current?.version ?? 0) !== input.expectedVersion) return null;
    // Mirrors PgWorkspaceRepository. A mock that happily accepts a destructive
    // save would let every API-level test pass over the one behaviour that
    // matters most in production.
    if (
      current &&
      !input.allowShrink &&
      input.expectedVersion > 0 &&
      isDestructiveShrink(current.payload, input.payload)
    ) {
      throw new WorkspaceShrinkRejectedError(
        populatedEntryCount(current.payload),
        populatedEntryCount(input.payload),
      );
    }
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
