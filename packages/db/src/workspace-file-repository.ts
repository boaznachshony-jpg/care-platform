import type { WorkspaceFileRecord, WorkspaceFileRepository } from '@caredesk/application';
import type { Pool } from 'pg';
import { withTenant } from './pool.js';

interface FileRow {
  tenant_id: string;
  client_id: string;
  document_id: string;
  storage_key: string;
  media_type: string;
  size_bytes: string;
  version: number;
  updated_at: Date;
}

function toRecord(row: FileRow): WorkspaceFileRecord {
  return {
    tenantId: row.tenant_id,
    clientId: row.client_id,
    documentId: row.document_id,
    storageKey: row.storage_key,
    mediaType: row.media_type,
    sizeBytes: Number(row.size_bytes),
    version: row.version,
    updatedAt: row.updated_at.toISOString(),
  };
}

const COLUMNS =
  'tenant_id, client_id, document_id, storage_key, media_type, size_bytes, version, updated_at';

export class PgWorkspaceFileRepository implements WorkspaceFileRepository {
  constructor(private readonly pool: Pool) {}

  async find(tenantId: string, clientId: string, documentId: string) {
    return withTenant(this.pool, tenantId, async (client) => {
      const result = await client.query<FileRow>(
        `select ${COLUMNS} from workspace_file
          where tenant_id = $1 and client_id = $2 and document_id = $3
            and status = 'active'`,
        [tenantId, clientId, documentId],
      );
      return result.rows[0] ? toRecord(result.rows[0]) : null;
    });
  }

  async upsert(
    input: Omit<WorkspaceFileRecord, 'version'> & { updatedBy: string },
  ): Promise<WorkspaceFileRecord> {
    return withTenant(this.pool, input.tenantId, async (client) => {
      const result = await client.query<FileRow>(
        `insert into workspace_file
           (tenant_id, client_id, document_id, storage_key, media_type, size_bytes,
            version, updated_by, updated_at)
         values ($1, $2, $3, $4, $5, $6, 1, $7, $8::timestamptz)
         on conflict (tenant_id, client_id, document_id) do update
           set storage_key = excluded.storage_key,
               media_type = excluded.media_type,
               size_bytes = excluded.size_bytes,
               version = workspace_file.version + 1,
               updated_by = excluded.updated_by,
               updated_at = excluded.updated_at,
               -- Re-uploading to a document id that was soft-deleted revives
               -- the row rather than leaving a live file behind a tombstone.
               status = 'active',
               deleted_at = null
         returning ${COLUMNS}`,
        [
          input.tenantId,
          input.clientId,
          input.documentId,
          input.storageKey,
          input.mediaType,
          input.sizeBytes,
          input.updatedBy,
          input.updatedAt,
        ],
      );
      const row = result.rows[0];
      if (!row) throw new Error('Workspace file upsert returned no row.');
      return toRecord(row);
    });
  }

  /**
   * Soft delete, because this row is the only record that the object exists.
   *
   * The caller deletes the storage object immediately after this returns. If
   * that call fails - a network error, a permission change, a process that dies
   * between the two - a hard delete would leave the bytes in the private bucket
   * with nothing anywhere naming their tenant: unfindable, un-erasable in
   * response to a privacy request, and invisible to any reconciliation. The
   * tombstone keeps `storage_key`, which is the whole point of keeping it.
   *
   * The row is removed for good only by a reconciliation sweep over
   * `status = 'deleted'` that has confirmed the object is gone. Until that
   * sweep exists, the tombstone accumulating is the correct failure: a record
   * too many is recoverable, a record too few is not.
   */
  async delete(tenantId: string, clientId: string, documentId: string) {
    return withTenant(this.pool, tenantId, async (client) => {
      const result = await client.query<FileRow>(
        `update workspace_file
            set status = 'deleted',
                deleted_at = now()
          where tenant_id = $1 and client_id = $2 and document_id = $3
            and status = 'active'
        returning ${COLUMNS}`,
        [tenantId, clientId, documentId],
      );
      return result.rows[0] ? toRecord(result.rows[0]) : null;
    });
  }
}
