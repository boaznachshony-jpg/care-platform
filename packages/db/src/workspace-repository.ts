import type {
  SaveWorkspaceRecord,
  WorkspaceRecord,
  WorkspaceRepository,
} from '@caredesk/application';
import type { Pool } from 'pg';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { withTenant } from './pool.js';

const ENCRYPTED_MARKER = '__caredesk_encrypted_workspace_v1';

interface EncryptedWorkspaceEnvelope extends Record<string, string> {
  [ENCRYPTED_MARKER]: 'aes-256-gcm';
  iv: string;
  ciphertext: string;
  authTag: string;
}

function isEncryptedEnvelope(
  payload: Record<string, string>,
): payload is EncryptedWorkspaceEnvelope {
  return payload[ENCRYPTED_MARKER] === 'aes-256-gcm';
}

function decodeKey(encodedKey: string): Buffer {
  const key = Buffer.from(encodedKey, 'base64');
  if (key.length !== 32) throw new Error('Workspace encryption key must contain 32 bytes');
  return key;
}

function encryptPayload(
  payload: Record<string, string>,
  tenantId: string,
  encodedKey?: string,
): Record<string, string> {
  if (!encodedKey) return payload;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', decodeKey(encodedKey), iv);
  cipher.setAAD(Buffer.from(tenantId, 'utf8'));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  return {
    [ENCRYPTED_MARKER]: 'aes-256-gcm',
    iv: iv.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  };
}

function decryptPayload(
  payload: Record<string, string>,
  tenantId: string,
  encodedKey?: string,
): Record<string, string> {
  if (!isEncryptedEnvelope(payload)) return payload;
  if (!encodedKey) throw new Error('Encrypted workspace cannot be read without its encryption key');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    decodeKey(encodedKey),
    Buffer.from(payload.iv, 'base64'),
  );
  decipher.setAAD(Buffer.from(tenantId, 'utf8'));
  decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
  return JSON.parse(plaintext) as Record<string, string>;
}

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
      return row ? toRecord(row, this.encryptionKey) : null;
    });
  }

  async save(input: SaveWorkspaceRecord): Promise<WorkspaceRecord | null> {
    return withTenant(this.pool, input.tenantId, async (client) => {
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
