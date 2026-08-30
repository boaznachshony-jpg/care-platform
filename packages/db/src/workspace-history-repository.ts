import type {
  ArchivedWorkspaceVersion,
  WorkspaceHistoryRepository,
  WorkspaceVersionSummary,
} from '@caredesk/application';
import type { Pool } from 'pg';
import { withTenant } from './pool.js';
import { countPopulatedEntries, decryptPayload } from './workspace-payload-crypto.js';

interface HistoryRow {
  tenant_id: string;
  version: number;
  schema_version: number;
  payload: Record<string, string>;
  updated_at: Date;
  archived_at: Date;
}

/**
 * Reads `tenant_workspace_history` (0035). Read-only by grant as well as by
 * shape: `caredesk_app` holds `select, insert` on the table and nothing else,
 * so there is no method here that could rewrite the archive even if one were
 * written.
 *
 * Every query runs inside `withTenant`, so the archive is scoped by the same
 * RLS policy as the live workspace. A tenant cannot list or restore another
 * tenant's versions, and neither can a bug in the route layer.
 */
export class PgWorkspaceHistoryRepository implements WorkspaceHistoryRepository {
  constructor(
    private readonly pool: Pool,
    private readonly encryptionKey?: string,
  ) {}

  async listVersions(tenantId: string, limit: number): Promise<WorkspaceVersionSummary[]> {
    return withTenant(this.pool, tenantId, async (client) => {
      const result = await client.query<HistoryRow>(
        `select tenant_id, version, schema_version, payload, updated_at, archived_at
           from tenant_workspace_history
          where tenant_id = $1
          order by version desc
          limit $2`,
        [tenantId, limit],
      );
      return result.rows.map((row) => ({
        version: row.version,
        schemaVersion: row.schema_version,
        updatedAt: row.updated_at.toISOString(),
        archivedAt: row.archived_at.toISOString(),
        // Null rather than an exception when a version does not decrypt: one
        // unreadable archived version must not make the whole list - and with
        // it every recoverable version - unreachable.
        populatedEntries: countPopulatedEntries(row.payload, row.tenant_id, this.encryptionKey),
        payloadBytes: Buffer.byteLength(JSON.stringify(row.payload), 'utf8'),
      }));
    });
  }

  async findVersion(tenantId: string, version: number): Promise<ArchivedWorkspaceVersion | null> {
    return withTenant(this.pool, tenantId, async (client) => {
      const result = await client.query<HistoryRow>(
        `select tenant_id, version, schema_version, payload, updated_at, archived_at
           from tenant_workspace_history
          where tenant_id = $1 and version = $2`,
        [tenantId, version],
      );
      const row = result.rows[0];
      if (!row) return null;
      // Decryption failure throws here on purpose, unlike in the listing. A
      // restore that cannot read what it is about to write would otherwise
      // overwrite live data with an unreadable envelope.
      return {
        version: row.version,
        schemaVersion: row.schema_version,
        payload: decryptPayload(row.payload, row.tenant_id, this.encryptionKey),
      };
    });
  }
}
