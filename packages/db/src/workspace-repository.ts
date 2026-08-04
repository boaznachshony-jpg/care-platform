import type {
  SaveWorkspaceRecord,
  WorkspaceRecord,
  WorkspaceRepository,
} from '@caredesk/application';
import type { Pool } from 'pg';
import { withTenant } from './pool.js';

interface WorkspaceRow {
  tenant_id: string;
  schema_version: number;
  payload: Record<string, string>;
  version: number;
  updated_at: Date;
}

function toRecord(row: WorkspaceRow): WorkspaceRecord {
  return {
    tenantId: row.tenant_id,
    schemaVersion: row.schema_version,
    payload: row.payload,
    version: row.version,
    updatedAt: row.updated_at.toISOString(),
  };
}

export class PgWorkspaceRepository implements WorkspaceRepository {
  constructor(private readonly pool: Pool) {}

  async find(tenantId: string): Promise<WorkspaceRecord | null> {
    return withTenant(this.pool, tenantId, async (client) => {
      const result = await client.query<WorkspaceRow>(
        `select tenant_id, schema_version, payload, version, updated_at
           from tenant_workspace
          where tenant_id = $1`,
        [tenantId],
      );
      const row = result.rows[0];
      return row ? toRecord(row) : null;
    });
  }

  async save(input: SaveWorkspaceRecord): Promise<WorkspaceRecord | null> {
    return withTenant(this.pool, input.tenantId, async (client) => {
      const result = await client.query<WorkspaceRow>(
        `insert into tenant_workspace
           (tenant_id, schema_version, payload, version, updated_by, updated_at)
         select $1, $2, $3::jsonb, 1, $5, $6::timestamptz
          where $4 = 0
         on conflict (tenant_id) do update
           set schema_version = excluded.schema_version,
               payload = excluded.payload,
               version = tenant_workspace.version + 1,
               updated_by = excluded.updated_by,
               updated_at = excluded.updated_at
         where tenant_workspace.version = $4
         returning tenant_id, schema_version, payload, version, updated_at`,
        [
          input.tenantId,
          input.schemaVersion,
          JSON.stringify(input.payload),
          input.expectedVersion,
          input.updatedBy,
          input.updatedAt,
        ],
      );
      const row = result.rows[0];
      return row ? toRecord(row) : null;
    });
  }
}
