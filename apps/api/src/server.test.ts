import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';
import { buildServer } from './create-server.js';

/**
 * DB-03 made a production environment refuse to parse unless it is complete, so
 * a case that only needs "some production deployment" has to carry the whole
 * set even when it asserts one header. Keeping that here lets each test pass
 * only the setting it is actually about.
 */
function productionEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgres://caredesk_app@localhost:5432/caredesk',
    WORKSPACE_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
    SUPABASE_URL: 'https://primary.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
    SUPABASE_SERVICE_ROLE_KEY: 'primary-server-only',
    SUPABASE_STORAGE_BUCKET: 'private-documents',
    BACKUP_SUPABASE_URL: 'https://backup.supabase.co',
    BACKUP_SUPABASE_SERVICE_ROLE_KEY: 'backup-server-only',
    BACKUP_SUPABASE_STORAGE_BUCKET: 'private-documents-backup',
    ...overrides,
  };
}

describe('apps/api server', () => {
  it('GET /health returns a schema-shaped 200', async () => {
    const app = buildServer(loadEnv({}));
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok', service: '@caredesk/api' });
  });

  it('sets hardened API response headers without blocking the separate web deployment', async () => {
    const development = buildServer(loadEnv({}));
    const response = await development.inject({ method: 'GET', url: '/health' });
    expect(response.headers).toMatchObject({
      'cache-control': 'no-store',
      'content-security-policy':
        "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; sandbox",
      'cross-origin-opener-policy': 'same-origin',
      'cross-origin-resource-policy': 'cross-origin',
      'permissions-policy': 'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
    });
    expect(response.headers).not.toHaveProperty('strict-transport-security');

    const production = buildServer(loadEnv(productionEnv()));
    const productionResponse = await production.inject({ method: 'GET', url: '/health' });
    expect(productionResponse.headers['strict-transport-security']).toBe(
      'max-age=31536000; includeSubDomains',
    );
  });

  it('reports development ready but fails closed for an unconfigured production deployment', async () => {
    const development = buildServer(loadEnv({}));
    expect((await development.inject({ method: 'GET', url: '/ready' })).statusCode).toBe(200);

    // DB-03 moved this guarantee to an earlier boundary. An unconfigured
    // production deployment used to build a server that reported itself
    // unhealthy on /ready; it now refuses to parse at all, and index.ts renders
    // the refusal as a 503-everything app carrying this message. Asserting the
    // throw is asserting the same fail-closed behaviour where it now lives -
    // and each setting is named individually, because the point of the rule is
    // that the operator is told which one is missing rather than that something
    // somewhere is wrong.
    const parseUnconfiguredProduction = () => loadEnv({ NODE_ENV: 'production' });
    expect(parseUnconfiguredProduction).toThrow(/Invalid environment configuration/);
    for (const setting of [
      'DATABASE_URL',
      'SUPABASE_URL',
      'SUPABASE_PUBLISHABLE_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
      'SUPABASE_STORAGE_BUCKET',
    ]) {
      expect(parseUnconfiguredProduction).toThrow(`${setting} is required in production`);
    }
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

  it('allows production browser preflights for every mutating API method', async () => {
    const origin = 'https://care-platform-web.vercel.app';
    const app = buildServer(loadEnv(productionEnv({ CORS_ORIGINS: origin })));

    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      const response = await app.inject({
        method: 'OPTIONS',
        url: '/workspace',
        headers: {
          origin,
          'access-control-request-method': method,
          'access-control-request-headers': 'authorization,content-type',
        },
      });
      expect(response.statusCode).toBe(204);
      expect(response.headers['access-control-allow-origin']).toBe(origin);
      expect(response.headers['access-control-allow-methods']).toContain(method);
    }
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
