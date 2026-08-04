export interface WorkspaceFileRecord {
  tenantId: string;
  clientId: string;
  documentId: string;
  storageKey: string;
  mediaType: string;
  sizeBytes: number;
  version: number;
  updatedAt: string;
}

export interface WorkspaceFileRepository {
  find(tenantId: string, clientId: string, documentId: string): Promise<WorkspaceFileRecord | null>;
  upsert(
    input: Omit<WorkspaceFileRecord, 'version'> & { updatedBy: string },
  ): Promise<WorkspaceFileRecord>;
  delete(
    tenantId: string,
    clientId: string,
    documentId: string,
  ): Promise<WorkspaceFileRecord | null>;
}
