import { describe, expect, it } from 'vitest';
import { DEV_TOKEN } from '../container.js';
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
