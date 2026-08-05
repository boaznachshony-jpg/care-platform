import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { PgWorkspaceRepository } from './workspace-repository.js';

const TENANT_ID = '10000000-0000-4000-8000-000000000001';
const USER_ID = '20000000-0000-4000-8000-000000000001';
const UPDATED_AT = '2026-08-04T18:00:00.000Z';

function fakePool(workspaceRows: Array<Record<string, unknown>>) {
  const query = vi.fn(async (sql: string, _values?: unknown[]) => {
    if (sql.includes('insert into tenant_workspace') || sql.includes('update tenant_workspace')) {
      return { rows: workspaceRows };
    }
    return { rows: [] };
  });
  const release = vi.fn();
  const connect = vi.fn(async () => ({ query, release }));
  return { pool: { connect } as unknown as Pool, query, release };
}

function workspaceRow(version: number) {
  return {
    tenant_id: TENANT_ID,
    schema_version: 1,
    payload: { 'caredesk.mvp.clients.v1': '[]' },
    version,
    updated_at: new Date(UPDATED_AT),
  };
}

describe('PgWorkspaceRepository.save', () => {
  it('inserts only when the caller expects an empty workspace', async () => {
    const db = fakePool([workspaceRow(1)]);
    const repository = new PgWorkspaceRepository(db.pool);

    await expect(
      repository.save({
        tenantId: TENANT_ID,
        schemaVersion: 1,
        payload: { 'caredesk.mvp.clients.v1': '[]' },
        expectedVersion: 0,
        updatedBy: USER_ID,
        updatedAt: UPDATED_AT,
      }),
    ).resolves.toMatchObject({ tenantId: TENANT_ID, version: 1 });

    const saveSql = db.query.mock.calls[3]?.[0];
    const saveValues = db.query.mock.calls[3]?.[1];
    expect(saveSql).toContain('insert into tenant_workspace');
    expect(saveSql).toContain('values ($1, $2, $3::jsonb, 1, $4, $5::timestamptz)');
    expect(saveSql).toContain('on conflict (tenant_id) do nothing');
    expect(saveSql).not.toContain('where $4 = 0');
    expect(saveSql).not.toContain('$6');
    expect(saveValues).toEqual([
      TENANT_ID,
      1,
      JSON.stringify({ 'caredesk.mvp.clients.v1': '[]' }),
      USER_ID,
      UPDATED_AT,
    ]);
    expect(db.query.mock.calls.at(-1)?.[0]).toBe('commit');
    expect(db.release).toHaveBeenCalledOnce();
  });

  it('updates a matching workspace version and increments it', async () => {
    const db = fakePool([workspaceRow(2)]);
    const repository = new PgWorkspaceRepository(db.pool);

    await expect(
      repository.save({
        tenantId: TENANT_ID,
        schemaVersion: 1,
        payload: { 'caredesk.mvp.clients.v1': '[]' },
        expectedVersion: 1,
        updatedBy: USER_ID,
        updatedAt: UPDATED_AT,
      }),
    ).resolves.toMatchObject({ tenantId: TENANT_ID, version: 2 });

    const saveSql = db.query.mock.calls[3]?.[0];
    expect(saveSql).toContain('update tenant_workspace');
    expect(saveSql).toContain('version = version + 1');
    expect(saveSql).toContain('where tenant_id = $1 and version = $4');
    expect(db.query.mock.calls.at(-1)?.[0]).toBe('commit');
    expect(db.release).toHaveBeenCalledOnce();
  });

  it('returns null when optimistic concurrency detects a stale version', async () => {
    const db = fakePool([]);
    const repository = new PgWorkspaceRepository(db.pool);

    await expect(
      repository.save({
        tenantId: TENANT_ID,
        schemaVersion: 1,
        payload: { 'caredesk.mvp.clients.v1': '[]' },
        expectedVersion: 1,
        updatedBy: USER_ID,
        updatedAt: UPDATED_AT,
      }),
    ).resolves.toBeNull();
    expect(db.query.mock.calls.at(-1)?.[0]).toBe('commit');
  });
});
