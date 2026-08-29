import { describe, expect, it, vi } from 'vitest';
import { createCipheriv } from 'node:crypto';
import type { Pool } from 'pg';
import { PgWorkspaceRepository } from './workspace-repository.js';

const TENANT_ID = '10000000-0000-4000-8000-000000000001';
const USER_ID = '20000000-0000-4000-8000-000000000001';
const UPDATED_AT = '2026-08-04T18:00:00.000Z';
const ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

function fakePool(workspaceRows: Array<Record<string, unknown>>, echoSavedPayload = false) {
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    if (sql.includes('insert into tenant_workspace') || sql.includes('update tenant_workspace')) {
      if (echoSavedPayload && values) {
        return {
          rows: [
            {
              ...workspaceRow(1),
              payload: JSON.parse(String(values[2])) as Record<string, string>,
            },
          ],
        };
      }
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

    // One extra call ahead of the write: the `select ... for update` that reads
    // the stored workspace so a destructive save can be refused.
    const saveSql = db.query.mock.calls[4]?.[0];
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

  it('encrypts sensitive workspace entries before sending them to Postgres', async () => {
    const db = fakePool([workspaceRow(1)], true);
    const repository = new PgWorkspaceRepository(db.pool, ENCRYPTION_KEY);

    const saved = await repository.save({
      tenantId: TENANT_ID,
      schemaVersion: 1,
      payload: { 'caredesk.mvp.clients.v1': '[{"identityNumber":"123456782"}]' },
      expectedVersion: 0,
      updatedBy: USER_ID,
      updatedAt: UPDATED_AT,
    });

    const encoded = String(db.query.mock.calls[3]?.[1]?.[2]);
    const stored = JSON.parse(encoded) as Record<string, string>;
    expect(stored.__caredesk_encrypted_workspace_v1).toBe('aes-256-gcm');
    expect(stored.iv).toBeTruthy();
    expect(stored.authTag).toBeTruthy();
    expect(stored.ciphertext).toBeTruthy();
    expect(encoded).not.toContain('identityNumber');
    expect(encoded).not.toContain('123456782');
    expect(saved?.payload).toEqual({
      'caredesk.mvp.clients.v1': '[{"identityNumber":"123456782"}]',
    });
  });
});

/**
 * The last line of defence for the incident that started this work: a device
 * whose cache key had expired produced a snapshot of 29 keys whose values were
 * all empty strings, and the server committed it because the request was well
 * formed and the version matched.
 *
 * The client no longer builds such a snapshot. These tests cover the case where
 * one nevertheless arrives - an old tab, a stale build, a future regression.
 */
describe('PgWorkspaceRepository.save destructive-write guard', () => {
  const POPULATED = Object.fromEntries(
    Array.from({ length: 12 }, (_, index) => [`caredesk.mvp.key.${index}`, `value ${index}`]),
  );

  /** Mirrors the repository's own envelope so the guard must really decrypt. */
  function encryptForTest(
    payload: Record<string, string>,
    encodedKey: string,
  ): Record<string, string> {
    const iv = Buffer.alloc(12, 3);
    const cipher = createCipheriv('aes-256-gcm', Buffer.from(encodedKey, 'base64'), iv);
    cipher.setAAD(Buffer.from(TENANT_ID, 'utf8'));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(payload), 'utf8'),
      cipher.final(),
    ]);
    return {
      __caredesk_encrypted_workspace_v1: 'aes-256-gcm',
      iv: iv.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
    };
  }

  /** A pool whose stored row holds `payload`, encrypted when a key is given. */
  function poolHolding(payload: Record<string, string>, encodedKey?: string) {
    const storedPayload = encodedKey ? encryptForTest(payload, encodedKey) : payload;
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('for update')) {
        return { rows: [{ ...workspaceRow(1), payload: storedPayload }] };
      }
      if (sql.includes('update tenant_workspace')) return { rows: [workspaceRow(2)] };
      return { rows: [] };
    });
    return {
      pool: { connect: async () => ({ query, release: vi.fn() }) } as unknown as Pool,
      query,
    };
  }

  const executedSql = (query: ReturnType<typeof vi.fn>): string[] =>
    query.mock.calls.map(([sql]) => String(sql));

  const blankedOut = Object.fromEntries(Object.keys(POPULATED).map((key) => [key, '']));

  const attempt = (
    db: { pool: Pool },
    payload: Record<string, string>,
    allowShrink?: boolean,
    encodedKey?: string,
  ) =>
    new PgWorkspaceRepository(db.pool, encodedKey).save({
      tenantId: TENANT_ID,
      schemaVersion: 1,
      payload,
      expectedVersion: 1,
      updatedBy: USER_ID,
      updatedAt: UPDATED_AT,
      ...(allowShrink === undefined ? {} : { allowShrink }),
    });

  it('refuses a save that blanks every value of a populated workspace', async () => {
    const db = poolHolding(POPULATED);
    await expect(attempt(db, blankedOut)).rejects.toThrow(/Refusing to reduce workspace/);
    // The point is not only that it threw, but that nothing was written and the
    // transaction was rolled back.
    expect(executedSql(db.query).some((sql) => sql.includes('update tenant_workspace'))).toBe(
      false,
    );
    expect(executedSql(db.query).at(-1)).toBe('rollback');
  });

  it('reads through the encryption envelope rather than trusting the raw column', async () => {
    const db = poolHolding(POPULATED, ENCRYPTION_KEY);
    await expect(attempt(db, blankedOut, undefined, ENCRYPTION_KEY)).rejects.toThrow(
      /Refusing to reduce workspace/,
    );
  });

  it('permits the same save when the customer explicitly confirmed the deletion', async () => {
    const db = poolHolding(POPULATED);
    await expect(attempt(db, blankedOut, true)).resolves.toMatchObject({ version: 2 });
  });

  it('does not stand in the way of ordinary editing', async () => {
    const db = poolHolding(POPULATED);
    const edited = { ...POPULATED, 'caredesk.mvp.key.0': '', 'caredesk.mvp.key.1': '' };
    await expect(attempt(db, edited)).resolves.toMatchObject({ version: 2 });
  });

  it('holds the row for the duration of the check', async () => {
    const db = poolHolding(POPULATED);
    await attempt(db, POPULATED);
    const guardSql = executedSql(db.query).find((sql) => sql.includes('for update'));
    expect(guardSql).toContain('from tenant_workspace');
  });
});
