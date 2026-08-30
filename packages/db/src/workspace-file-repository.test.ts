import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { PgWorkspaceFileRepository } from './workspace-file-repository.js';

const TENANT_ID = '10000000-0000-4000-8000-000000000001';
const CLIENT_ID = '30000000-0000-4000-8000-000000000001';
const DOCUMENT_ID = '40000000-0000-4000-8000-000000000001';
const USER_ID = '20000000-0000-4000-8000-000000000001';
const STORAGE_KEY = `${TENANT_ID}/workspaces/${CLIENT_ID}/documents/${DOCUMENT_ID}/object-1`;

function fileRow() {
  return {
    tenant_id: TENANT_ID,
    client_id: CLIENT_ID,
    document_id: DOCUMENT_ID,
    storage_key: STORAGE_KEY,
    media_type: 'application/pdf',
    size_bytes: '1024',
    version: 1,
    updated_at: new Date('2026-08-30T09:00:00.000Z'),
  };
}

function fakePool() {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('workspace_file')) return { rows: [fileRow()] };
    return { rows: [] };
  });
  const connect = vi.fn(async () => ({ query, release: vi.fn() }));
  return { pool: { connect } as unknown as Pool, query };
}

function statementsAgainst(query: ReturnType<typeof fakePool>['query']): string[] {
  return query.mock.calls
    .map((call) => String(call[0]))
    .filter((sql) => sql.includes('workspace_file'));
}

/**
 * DB-20. `workspace_file` is the only record that a private storage object
 * exists at all: the bytes live in a bucket and this row holds the key. The
 * caller deletes the object immediately after the row is removed, and between
 * those two statements sit a network, a permission check and a process that can
 * die. A hard delete that wins the race against a failed object delete leaves a
 * passport scan in the bucket with nothing naming its tenant - unfindable,
 * un-erasable, unreconcilable.
 */
describe('PgWorkspaceFileRepository.delete', () => {
  it('tombstones the row instead of destroying the only record of the storage key', async () => {
    const db = fakePool();
    const repository = new PgWorkspaceFileRepository(db.pool);

    const removed = await repository.delete(TENANT_ID, CLIENT_ID, DOCUMENT_ID);

    const sql = statementsAgainst(db.query)[0] ?? '';
    expect(sql).toContain('update workspace_file');
    expect(sql).toContain("set status = 'deleted'");
    expect(sql).toContain('deleted_at = now()');
    expect(sql).not.toContain('delete from workspace_file');
    // The caller still needs the key back so it can remove the object.
    expect(removed?.storageKey).toBe(STORAGE_KEY);
  });

  it('does not re-tombstone a row that is already deleted', async () => {
    const db = fakePool();
    await new PgWorkspaceFileRepository(db.pool).delete(TENANT_ID, CLIENT_ID, DOCUMENT_ID);
    expect(statementsAgainst(db.query)[0]).toContain("and status = 'active'");
  });
});

describe('PgWorkspaceFileRepository.find', () => {
  it('ignores tombstones, so a deleted document does not come back', async () => {
    const db = fakePool();
    await new PgWorkspaceFileRepository(db.pool).find(TENANT_ID, CLIENT_ID, DOCUMENT_ID);
    expect(statementsAgainst(db.query)[0]).toContain("status = 'active'");
  });
});

describe('PgWorkspaceFileRepository.upsert', () => {
  it('revives a tombstoned row when the same document id is uploaded again', async () => {
    const db = fakePool();
    await new PgWorkspaceFileRepository(db.pool).upsert({
      tenantId: TENANT_ID,
      clientId: CLIENT_ID,
      documentId: DOCUMENT_ID,
      storageKey: STORAGE_KEY,
      mediaType: 'application/pdf',
      sizeBytes: 1024,
      updatedBy: USER_ID,
      updatedAt: '2026-08-30T09:00:00.000Z',
    });

    const sql = statementsAgainst(db.query)[0] ?? '';
    // Without this the primary key is occupied by a tombstone and the new
    // upload is invisible to `find`.
    expect(sql).toContain("status = 'active'");
    expect(sql).toContain('deleted_at = null');
  });
});
