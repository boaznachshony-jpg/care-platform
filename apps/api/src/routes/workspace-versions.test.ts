import { describe, expect, it } from 'vitest';
import {
  ListWorkspaceVersions,
  RestoreWorkspaceVersion,
  type AuthorizationService,
} from '@caredesk/application';
import {
  InMemoryWorkspaceHistoryRepository,
  InMemoryWorkspaceRepository,
  SystemClock,
} from '@caredesk/infrastructure';
import { buildContainer, DEV_TOKEN } from '../container.js';
import { buildServer } from '../create-server.js';
import { loadEnv, type Env } from '../env.js';

const AUTH = { authorization: `Bearer ${DEV_TOKEN}` };
const TENANT_ID = '00000000-0000-4000-8000-000000000001';
const USER_ID = '00000000-0000-4000-8000-000000000002';

const populated = (count: number): Record<string, string> =>
  Object.fromEntries(
    Array.from({ length: count }, (_, index) => [`caredesk.mvp.key.${index}`, `value ${index}`]),
  );

/**
 * Permission is decided by the role map and is covered where that decision
 * lives (`restore-workspace-version.test.ts`). What is under test here is the
 * HTTP surface: routing, validation, MFA gating and the status code each
 * failure maps to.
 */
const allowEverything: AuthorizationService = {
  async check() {
    return { allowed: true, reason: 'route test' };
  },
};

function buildRestoreApp(overrides: Partial<Env> = {}) {
  const env = loadEnv({ ...overrides } as Record<string, string>);
  const container = buildContainer(env);
  const workspaces = new InMemoryWorkspaceRepository();
  const history = new InMemoryWorkspaceHistoryRepository();
  history.seed({
    tenantId: TENANT_ID,
    version: 12,
    schemaVersion: 1,
    payload: populated(29),
    updatedAt: '2026-08-29T10:00:00.000Z',
    archivedAt: '2026-08-29T11:00:00.000Z',
  });
  const deps = {
    authorization: allowEverything,
    workspaces,
    history,
    audit: container.audit,
    clock: new SystemClock(),
  };
  container.listWorkspaceVersions = new ListWorkspaceVersions(deps);
  container.restoreWorkspaceVersion = new RestoreWorkspaceVersion(deps);
  return { app: buildServer(env, container), workspaces };
}

async function seedBlankedLiveWorkspace(workspaces: InMemoryWorkspaceRepository) {
  // The 2026-08-29 shape: the version the customer had, then a save of blanks.
  await workspaces.save({
    tenantId: TENANT_ID,
    schemaVersion: 1,
    payload: populated(29),
    expectedVersion: 0,
    updatedBy: USER_ID,
    updatedAt: '2026-08-29T10:00:00.000Z',
  });
  await workspaces.save({
    tenantId: TENANT_ID,
    schemaVersion: 1,
    payload: Object.fromEntries(Object.keys(populated(29)).map((key) => [key, ''])),
    expectedVersion: 1,
    updatedBy: USER_ID,
    updatedAt: '2026-08-30T09:00:00.000Z',
    allowShrink: true,
  });
}

describe('GET /workspace/versions', () => {
  it('lists archived versions as metadata, never as payloads', async () => {
    const { app } = buildRestoreApp();
    const response = await app.inject({ method: 'GET', url: '/workspace/versions', headers: AUTH });

    expect(response.statusCode).toBe(200);
    expect(response.json().versions).toHaveLength(1);
    expect(response.json().versions[0]).toMatchObject({ version: 12, populatedEntries: 29 });
    expect(response.payload).not.toContain('value 0');
  });

  it('requires a session', async () => {
    const { app } = buildRestoreApp();
    expect((await app.inject({ method: 'GET', url: '/workspace/versions' })).statusCode).toBe(401);
  });
});

describe('POST /workspace/versions/:version/restore', () => {
  it('restores the archived version over the blanked live workspace', async () => {
    const { app, workspaces } = buildRestoreApp();
    await seedBlankedLiveWorkspace(workspaces);

    const response = await app.inject({
      method: 'POST',
      url: '/workspace/versions/12/restore',
      headers: AUTH,
      payload: { confirmVersion: 12 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().snapshot.entries['caredesk.mvp.key.0']).toBe('value 0');
    // Version 3, not 12: the restore is a new write, so nothing in the archive
    // is rewritten and the restore itself is undoable.
    expect(response.json().version).toBe(3);
  });

  it('rejects a body that does not confirm the version in the path', async () => {
    const { app, workspaces } = buildRestoreApp();
    await seedBlankedLiveWorkspace(workspaces);

    const response = await app.inject({
      method: 'POST',
      url: '/workspace/versions/12/restore',
      headers: AUTH,
      payload: { confirmVersion: 11 },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('WORKSPACE_RESTORE_NOT_CONFIRMED');
  });

  it('rejects a request with no confirmation at all', async () => {
    const { app } = buildRestoreApp();
    const response = await app.inject({
      method: 'POST',
      url: '/workspace/versions/12/restore',
      headers: AUTH,
      payload: {},
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 for a version that was never archived', async () => {
    const { app, workspaces } = buildRestoreApp();
    await seedBlankedLiveWorkspace(workspaces);

    const response = await app.inject({
      method: 'POST',
      url: '/workspace/versions/99/restore',
      headers: AUTH,
      payload: { confirmVersion: 99 },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe('WORKSPACE_VERSION_NOT_FOUND');
  });

  it('is refused without MFA when sensitive operations are enforced', async () => {
    // Same treatment as billing and membership changes: this is the write that
    // reaches furthest back, so it sits behind the same second factor.
    const { app, workspaces } = buildRestoreApp({
      SENSITIVE_OPERATION_MFA_MODE: 'enforce',
    } as Partial<Env>);
    await seedBlankedLiveWorkspace(workspaces);

    const response = await app.inject({
      method: 'POST',
      url: '/workspace/versions/12/restore',
      headers: AUTH,
      payload: { confirmVersion: 12 },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('MFA_REQUIRED');
  });

  it('requires a session', async () => {
    const { app } = buildRestoreApp();
    const response = await app.inject({
      method: 'POST',
      url: '/workspace/versions/12/restore',
      payload: { confirmVersion: 12 },
    });
    expect(response.statusCode).toBe(401);
  });
});
