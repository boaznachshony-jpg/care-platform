import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';
import { buildCorsOrigin } from './create-server.js';

function decide(env: ReturnType<typeof loadEnv>, origin: string | undefined): boolean {
  const result = buildCorsOrigin(env);
  if (typeof result !== 'function') {
    throw new Error('Expected a callback-based origin check outside production.');
  }
  let allowed = false;
  result(origin, (_err, value) => {
    allowed = value;
  });
  return allowed;
}

describe('CORS origin policy', () => {
  it('uses the explicit allowlist and nothing else in production', () => {
    const env = loadEnv({ NODE_ENV: 'production', CORS_ORIGINS: 'https://app.example.com' });
    expect(buildCorsOrigin(env)).toEqual(['https://app.example.com']);
  });

  it('allows private-network origins in development so a phone can reach the API', () => {
    const env = loadEnv({});
    expect(decide(env, 'http://192.168.68.113:5173')).toBe(true);
    expect(decide(env, 'http://10.0.0.42:5173')).toBe(true);
    expect(decide(env, 'http://172.16.5.9:5173')).toBe(true);
    expect(decide(env, 'http://localhost:5173')).toBe(true);
  });

  it('still refuses a public origin in development', () => {
    const env = loadEnv({});
    expect(decide(env, 'https://evil.example.com')).toBe(false);
    // 172.32 is outside the private 172.16–172.31 range.
    expect(decide(env, 'http://172.32.0.1:5173')).toBe(false);
  });

  it('allows a request with no Origin header (curl, same-origin)', () => {
    expect(decide(loadEnv({}), undefined)).toBe(true);
  });

  it('refuses a malformed origin rather than throwing', () => {
    expect(decide(loadEnv({}), 'not a url')).toBe(false);
  });
});
