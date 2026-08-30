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
import type { Pool } from 'pg';
import { withTenant } from './pool.js';
// The envelope moved to its own module once the version-history read path and
// the nightly census also had to open it. Same format, one definition.
import {
  decryptPayload,
  encryptPayload,
  isEncryptedEnvelope,
} from './workspace-payload-crypto.js';

interface WorkspaceRow {
  tenant_id: string;
  schema_version: number;
  payload: Record<string, string>;
  version: number;
  updated_at: Date;
}

function toRecord(row: WorkspaceRow, encodedKey?: string): WorkspaceRecord {
  return {
    tenantId: row.tenant_id,
    schemaVersion: row.schema_version,
    payload: decryptPayload(row.payload, row.tenant_id, encodedKey),
    version: row.version,
    updatedAt: row.updated_at.toISOString(),
  };
}

export class PgWorkspaceRepository implements WorkspaceRepository {
  constructor(
    private readonly pool: Pool,
    private readonly encryptionKey?: string,
  ) {}

  async find(tenantId: string): Promise<WorkspaceRecord | null> {
    return withTenant(this.pool, tenantId, async (client) => {
      const result = await client.query<WorkspaceRow>(
        `select tenant_id, schema_version, payload, version, updated_at
           from tenant_workspace
          where tenant_id = $1`,
        [tenantId],
      );
      const row = result.rows[0];
      if (row && this.encryptionKey && !isEncryptedEnvelope(row.payload)) {
        const encrypted = encryptPayload(row.payload, row.tenant_id, this.encryptionKey);
        await client.query(
          `update tenant_workspace
              set payload = $2::jsonb
            where tenant_id = $1 and payload = $3::jsonb`,
          [row.tenant_id, JSON.stringify(encrypted), JSON.stringify(row.payload)],
        );
      }
      return row ? toRecord(row, this.encryptionKey) : null;
    });
  }

  async save(input: SaveWorkspaceRecord): Promise<WorkspaceRecord | null> {
    return withTenant(this.pool, input.tenantId, async (client) => {
      // Read the stored row inside the same transaction as the write, so the
      // comparison cannot be made against a version that has since moved.
      // `for update` holds the row for the duration, which also serialises two
      // concurrent tabs attempting the same destructive save.
      // expectedVersion 0 is the create path: it is an `on conflict do nothing`
      // insert, so it cannot overwrite anything and needs no guard.
      if (!input.allowShrink && input.expectedVersion > 0) {
        const existing = await client.query<WorkspaceRow>(
          `select tenant_id, schema_version, payload, version, updated_at
             from tenant_workspace
            where tenant_id = $1
              for update`,
          [input.tenantId],
        );
        const current = existing.rows[0];
        if (current) {
          const stored = decryptPayload(current.payload, current.tenant_id, this.encryptionKey);
          if (isDestructiveShrink(stored, input.payload)) {
            throw new WorkspaceShrinkRejectedError(
              populatedEntryCount(stored),
              populatedEntryCount(input.payload),
            );
          }
        }
      }

      const result =
        input.expectedVersion === 0
          ? await client.query<WorkspaceRow>(
              `insert into tenant_workspace
                 (tenant_id, schema_version, payload, version, updated_by, updated_at)
               values ($1, $2, $3::jsonb, 1, $4, $5::timestamptz)
               on conflict (tenant_id) do nothing
               returning tenant_id, schema_version, payload, version, updated_at`,
              [
                input.tenantId,
                input.schemaVersion,
                JSON.stringify(encryptPayload(input.payload, input.tenantId, this.encryptionKey)),
                input.updatedBy,
                input.updatedAt,
              ],
            )
          : await client.query<WorkspaceRow>(
              `update tenant_workspace
                  set schema_version = $2,
                      payload = $3::jsonb,
                      version = version + 1,
                      updated_by = $5,
                      updated_at = $6::timestamptz
                where tenant_id = $1 and version = $4
               returning tenant_id, schema_version, payload, version, updated_at`,
              [
                input.tenantId,
                input.schemaVersion,
                JSON.stringify(encryptPayload(input.payload, input.tenantId, this.encryptionKey)),
                input.expectedVersion,
                input.updatedBy,
                input.updatedAt,
              ],
            );
      const row = result.rows[0];
      return row ? toRecord(row, this.encryptionKey) : null;
    });
  }
}
