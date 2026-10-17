import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildServer } from '../create-server.js';
import { loadEnv } from '../env.js';

/**
 * K (work plan 16.10.2026). `/ready` used to return `ready: true` outside
 * production before asking any dependency anything, so a staging or local API
 * with a rotated key or a deleted bucket reported itself healthy. These tests
 * pin the new rule: a configured dependency is probed in every environment,
 * and an unconfigured one is never probed (and is a fault only in production).
 */

const SUPABASE_URL = 'https://synthetic-project.supabase.co';

function developmentWithSupabase(): Record<string, string> {
  return {
    NODE_ENV: 'development',
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: 'publishable-key-for-tests',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-for-tests',
    SUPABASE_STORAGE_BUCKET: 'private-documents',
  };
}

function stubFetch(statusFor: (url: string) => { status: number; body: string }) {
  const urls: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    urls.push(url);
    const { status, body } = statusFor(url);
    return { ok: status >= 200 && status < 300, status, text: async () => body };
  });
  return urls;
}

type ReadyBody = {
  status: string;
  reasons?: string[];
  checks: Record<string, string>;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('/ready probes configured dependencies in every environment', () => {
  it('reports a development API with a rejected key and a missing bucket as not ready', async () => {
    const urls = stubFetch((url) =>
      url.includes('/auth/v1/')
        ? { status: 401, body: '{"message":"Invalid API key"}' }
        : { status: 404, body: '{"message":"Bucket not found"}' },
    );
    const app = buildServer(loadEnv(developmentWithSupabase()));

    const response = await app.inject({ method: 'GET', url: '/ready' });

    expect(response.statusCode).toBe(503);
    const body = response.json<ReadyBody>();
    expect(body.checks.authentication).toBe('unreachable');
    expect(body.checks.privateStorage).toBe('unreachable');
    expect(body.reasons?.join('\n')).toMatch(/Supabase authentication is unreachable/);
    expect(body.reasons?.join('\n')).toMatch(/bucket private-documents/);
    // Configuration that is absent outside production is still not a fault.
    expect(body.reasons?.join('\n')).not.toMatch(/not configured/);
    expect(urls.some((url) => url.startsWith(`${SUPABASE_URL}/auth/v1/`))).toBe(true);
    expect(urls.some((url) => url.startsWith(`${SUPABASE_URL}/storage/v1/bucket/`))).toBe(true);
  });

  it('reports a development API whose upstreams answer as ready, having asked them', async () => {
    const urls = stubFetch(() => ({ status: 200, body: '{}' }));
    const app = buildServer(loadEnv(developmentWithSupabase()));

    const response = await app.inject({ method: 'GET', url: '/ready' });

    expect(response.statusCode).toBe(200);
    const body = response.json<ReadyBody>();
    expect(body.checks).toMatchObject({ authentication: 'ok', privateStorage: 'ok' });
    expect(urls).toHaveLength(2);
  });

  it('never probes a dependency that is not configured', async () => {
    const urls = stubFetch(() => ({ status: 500, body: '' }));
    const app = buildServer(loadEnv({}));

    const response = await app.inject({ method: 'GET', url: '/ready' });

    expect(response.statusCode).toBe(200);
    expect(response.json<ReadyBody>().checks).toMatchObject({
      database: 'unconfigured',
      authentication: 'unconfigured',
      privateStorage: 'unconfigured',
    });
    expect(urls).toHaveLength(0);
  });
});
