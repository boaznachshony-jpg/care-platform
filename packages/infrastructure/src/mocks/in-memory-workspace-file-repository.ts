import type { WorkspaceFileRecord, WorkspaceFileRepository } from '@caredesk/application';

const keyOf = (tenantId: string, clientId: string, documentId: string) =>
  `${tenantId}:${clientId}:${documentId}`;

export class InMemoryWorkspaceFileRepository implements WorkspaceFileRepository {
  private readonly rows = new Map<string, WorkspaceFileRecord>();

  async find(tenantId: string, clientId: string, documentId: string) {
    return this.rows.get(keyOf(tenantId, clientId, documentId)) ?? null;
  }

  async upsert(input: Omit<WorkspaceFileRecord, 'version'>): Promise<WorkspaceFileRecord> {
    const key = keyOf(input.tenantId, input.clientId, input.documentId);
    const saved = { ...input, version: (this.rows.get(key)?.version ?? 0) + 1 };
    this.rows.set(key, saved);
    return saved;
  }

  async delete(tenantId: string, clientId: string, documentId: string) {
    const key = keyOf(tenantId, clientId, documentId);
    const row = this.rows.get(key) ?? null;
    this.rows.delete(key);
    return row;
  }
}
