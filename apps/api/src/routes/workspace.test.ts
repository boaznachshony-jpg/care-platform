import { describe, expect, it } from 'vitest';
import type { DataLossSignal } from '@caredesk/application';
import { buildContainer, DEV_TOKEN } from '../container.js';
import { loadEnv } from '../env.js';
import { buildServer } from '../create-server.js';

const AUTH = { authorization: `Bearer ${DEV_TOKEN}` };
const snapshot = {
  schemaVersion: 1 as const,
  entries: { 'caredesk.mvp.clients.v1': '[]' },
};

describe('/workspace routes', () => {
  it('starts empty, persists a snapshot and returns it', async () => {
    const app = buildServer(loadEnv({}));
    const empty = await app.inject({ method: 'GET', url: '/workspace', headers: AUTH });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toMatchObject({ version: 0, snapshot: { entries: {} } });

    const saved = await app.inject({
      method: 'PUT',
      url: '/workspace',
      headers: AUTH,
      payload: { expectedVersion: 0, snapshot },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ version: 1, snapshot });

    const read = await app.inject({ method: 'GET', url: '/workspace', headers: AUTH });
    expect(read.json()).toMatchObject({ version: 1, snapshot });
  });

  it('stores workspace documents privately and issues an authorized short-lived link', async () => {
    const app = buildServer(loadEnv({}));
    const clientId = '10000000-0000-4000-8000-000000000001';
    const documentId = '10000000-0000-4000-8000-000000000002';
    const url = `/workspace/files/${clientId}/${documentId}`;
    const uploaded = await app.inject({
      method: 'PUT',
      url,
      headers: AUTH,
      payload: {
        mediaType: 'application/pdf',
        content: Buffer.from('pilot-file').toString('base64'),
      },
    });
    expect(uploaded.statusCode).toBe(200);
    expect(uploaded.json()).toMatchObject({ version: 1, sizeBytes: 10 });

    const link = await app.inject({ method: 'GET', url, headers: AUTH });
    expect(link.statusCode).toBe(200);
    expect(link.json().url).toMatch(/^mock:\/\/signed\//);
    expect(link.json().expiresInSeconds).toBe(900);

    const removed = await app.inject({ method: 'DELETE', url, headers: AUTH });
    expect(removed.statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url, headers: AUTH })).statusCode).toBe(404);
  });

  it('rejects stale writes instead of silently overwriting newer data', async () => {
    const app = buildServer(loadEnv({}));
    await app.inject({
      method: 'PUT',
      url: '/workspace',
      headers: AUTH,
      payload: { expectedVersion: 0, snapshot },
    });
    const stale = await app.inject({
      method: 'PUT',
      url: '/workspace',
      headers: AUTH,
      payload: { expectedVersion: 0, snapshot },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: 'VERSION_CONFLICT' });
  });

  it('accepts only CareDesk MVP storage keys', async () => {
    const app = buildServer(loadEnv({}));
    const invalid = await app.inject({
      method: 'PUT',
      url: '/workspace',
      headers: AUTH,
      payload: {
        expectedVersion: 0,
        snapshot: { schemaVersion: 1, entries: { unrelated: 'value' } },
      },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

/**
 * The guard has always refused a destructive save correctly, and has always
 * refused it silently. That refusal is the 2026-08-29 incident being caught in
 * the act - and because the write never lands, the nightly census cannot see it
 * afterwards. If nobody is told at this moment, nobody is told at all.
 */
describe('a refused destructive save is reported, not only refused', () => {
  const populated = (count: number): Record<string, string> =>
    Object.fromEntries(
      Array.from({ length: count }, (_, index) => [`caredesk.mvp.key.${index}`, `value ${index}`]),
    );

  it('raises a data-loss alert alongside the 409', async () => {
    const env = loadEnv({});
    const container = buildContainer(env);
    const raised: DataLossSignal[] = [];
    container.dataLossAlerts = {
      async raise(signal) {
        raised.push(signal);
      },
    };
    const app = buildServer(env, container);

    await app.inject({
      method: 'PUT',
      url: '/workspace',
      headers: AUTH,
      payload: { expectedVersion: 0, snapshot: { schemaVersion: 1, entries: populated(29) } },
    });
    const blanked = await app.inject({
      method: 'PUT',
      url: '/workspace',
      headers: AUTH,
      payload: {
        expectedVersion: 1,
        snapshot: {
          schemaVersion: 1,
          entries: Object.fromEntries(Object.keys(populated(29)).map((key) => [key, ''])),
        },
      },
    });

    expect(blanked.statusCode).toBe(409);
    expect(blanked.json().code).toBe('WORKSPACE_SHRINK_REJECTED');
    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({
      code: 'WORKSPACE_BLANKED',
      measure: 'workspace_populated_entries_rejected',
      before: 29,
      after: 0,
    });
  });

  it('still returns 409 when the alert transport itself fails', async () => {
    const env = loadEnv({});
    const container = buildContainer(env);
    container.dataLossAlerts = {
      async raise() {
        throw new Error('no alert transport configured');
      },
    };
    const app = buildServer(env, container);

    await app.inject({
      method: 'PUT',
      url: '/workspace',
      headers: AUTH,
      payload: { expectedVersion: 0, snapshot: { schemaVersion: 1, entries: populated(29) } },
    });
    const blanked = await app.inject({
      method: 'PUT',
      url: '/workspace',
      headers: AUTH,
      payload: {
        expectedVersion: 1,
        snapshot: {
          schemaVersion: 1,
          entries: Object.fromEntries(Object.keys(populated(29)).map((key) => [key, ''])),
        },
      },
    });

    expect(blanked.statusCode).toBe(409);
  });
});
