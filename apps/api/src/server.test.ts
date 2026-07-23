import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';
import { buildServer } from './server.js';

describe('apps/api server', () => {
  it('GET /health returns a schema-shaped 200', async () => {
    const app = buildServer(loadEnv({}));
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok', service: '@caredesk/api' });
  });

  it('echoes a client-supplied correlation id and generates one otherwise', async () => {
    const app = buildServer(loadEnv({}));

    const withId = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-correlation-id': 'client-supplied-1' },
    });
    expect(withId.headers['x-correlation-id']).toBe('client-supplied-1');

    const withoutId = await app.inject({ method: 'GET', url: '/health' });
    expect(typeof withoutId.headers['x-correlation-id']).toBe('string');
    expect((withoutId.headers['x-correlation-id'] as string).length).toBeGreaterThan(0);
  });

  it('GET /protected/ping is denied by default — no auth wiring means fail closed', async () => {
    const app = buildServer(loadEnv({}));
    const response = await app.inject({ method: 'GET', url: '/protected/ping' });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'AUTHORIZATION_NOT_CONFIGURED' });
  });

  it('an unknown route returns the standard error envelope, never a raw 404 page', async () => {
    const app = buildServer(loadEnv({}));
    const response = await app.inject({ method: 'GET', url: '/does-not-exist' });
    expect(response.statusCode).toBe(404);
    const body = response.json();
    expect(body).toHaveProperty('code', 'NOT_FOUND');
    expect(body).toHaveProperty('correlationId');
    expect(body).not.toHaveProperty('stack');
  });
});
